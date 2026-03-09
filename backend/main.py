import os
import base64
import re
import json
import time
import shutil
import sqlite3
import threading
import urllib.request
import gdown
from io import BytesIO
from collections import defaultdict
from pathlib import Path
from typing import List, Optional

import torch
import torchvision.transforms as transforms
from torchvision import models
from torch import nn
from PIL import Image
from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

# ── Rutas ──────────────────────────────────────────────────────────────────────
MODEL_DIR      = Path(__file__).parent / "model"
MODEL_PATH     = MODEL_DIR / "resnet50_plantas.pt"
CLASSES_PATH   = MODEL_DIR / "class_names.json"
CACHE_PATH     = MODEL_DIR / "embeddings_cache.pt"
FEEDBACK_DIR   = Path(__file__).parent / "feedback"
TRAINING_DIR   = Path(__file__).parent.parent / "data" / "3 - copia"
DB_PATH        = Path(__file__).parent / "records.db"
DIST_DIR       = Path(__file__).parent.parent / "frontend" / "dist"

model = None
class_names = []


# ── Descarga del modelo (para despliegue en la nube) ──────────────────────────
MODEL_URL = os.environ.get("MODEL_URL", "")

def download_model_if_needed():
    if MODEL_PATH.exists():
        return
    if not MODEL_URL:
        print("[WARN] Modelo no encontrado y MODEL_URL no configurado.")
        return
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    print("[INFO] Descargando modelo desde Google Drive...")
    # MODEL_URL puede ser el ID del archivo o la URL completa de Drive
    file_id = MODEL_URL
    if "drive.google.com" in MODEL_URL:
        # Extraer el ID de URLs tipo: https://drive.google.com/file/d/ID/view
        import re as _re
        m = _re.search(r"/d/([a-zA-Z0-9_-]+)", MODEL_URL)
        if m:
            file_id = m.group(1)
    gdown.download(id=file_id, output=str(MODEL_PATH), quiet=False)
    print("[OK] Modelo descargado.")


# ── Base de datos SQLite ───────────────────────────────────────────────────────
def init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS records (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp         TEXT    NOT NULL,
            departamento      TEXT,
            municipio         TEXT,
            vereda            TEXT,
            latitud           REAL,
            longitud          REAL,
            tree_id           TEXT    NOT NULL,
            predicted_species TEXT,
            confidence        REAL,
            verified_species  TEXT,
            verification      TEXT
        )
    """)
    con.commit()
    con.close()


def save_records(location: dict, results: list):
    ts = time.strftime("%Y-%m-%dT%H:%M:%S")
    con = sqlite3.connect(DB_PATH)
    for r in results:
        con.execute(
            """INSERT INTO records
               (timestamp, departamento, municipio, vereda, latitud, longitud,
                tree_id, predicted_species, confidence)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                ts,
                location.get("departamento", ""),
                location.get("municipio", ""),
                location.get("vereda", ""),
                location.get("latitud"),
                location.get("longitud"),
                r["tree_id"],
                r["predicted_species"],
                r["confidence"],
            ),
        )
    con.commit()
    con.close()


# ── Carga del modelo ───────────────────────────────────────────────────────────
def load_model():
    global model, class_names

    if not MODEL_PATH.exists() or not CLASSES_PATH.exists():
        print("[WARN] Modelo no encontrado en backend/model/.")
        return

    with open(CLASSES_PATH, "r", encoding="utf-8") as f:
        class_names = json.load(f)

    num_classes = len(class_names)
    net = models.resnet50(weights=None)
    net.fc = nn.Sequential(
        nn.Dropout(0.4),
        nn.Linear(net.fc.in_features, num_classes)
    )
    net.load_state_dict(torch.load(MODEL_PATH, map_location="cpu"))
    net.eval()
    model = net
    print(f"[OK] Modelo cargado: {num_classes} clases: {class_names}")


download_model_if_needed()
init_db()
load_model()


# ── FastAPI ────────────────────────────────────────────────────────────────────
app = FastAPI()
api = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

INFER_TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])


# ── Utilidades ─────────────────────────────────────────────────────────────────
def parse_tree_id(filename: str) -> str | None:
    name = filename.rsplit(".", 1)[0]
    match = re.match(r"^(\w+)-\d+$", name)
    return match.group(1) if match else None


def classify_image(image_bytes: bytes) -> dict | None:
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="Modelo no cargado. Coloca resnet50_plantas.pt y class_names.json en backend/model/ y reinicia el servidor."
        )

    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    tensor = INFER_TRANSFORM(img).unsqueeze(0)

    with torch.no_grad():
        output = model(tensor)
        probs  = torch.softmax(output, dim=1)[0]
        pred_idx = probs.argmax().item()

    return {
        "species":    class_names[pred_idx],
        "confidence": probs[pred_idx].item(),
    }


def make_thumbnail(image_bytes: bytes, size: int = 200) -> str:
    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    img.thumbnail((size, size))
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"


# ── Endpoint clasificación ─────────────────────────────────────────────────────
@api.post("/classify")
async def classify(
    files:        List[UploadFile] = File(...),
    departamento: str              = Form(""),
    municipio:    str              = Form(""),
    vereda:       str              = Form(""),
    latitud:      Optional[float]  = Form(None),
    longitud:     Optional[float]  = Form(None),
):
    tree_files: dict[str, list] = defaultdict(list)

    for upload in files:
        filename = upload.filename or ""
        tree_id  = parse_tree_id(filename)
        content  = await upload.read()

        if tree_id is None:
            continue
        tree_files[tree_id].append({"filename": filename, "content": content})

    if not tree_files:
        raise HTTPException(
            status_code=400,
            detail="Ningún archivo tiene el formato correcto (ej: '1-1.jpg', '2-3.png')."
        )

    def sort_key(k):
        try:
            return (0, int(k))
        except ValueError:
            return (1, k)

    results = []
    for tree_id, photos in sorted(tree_files.items(), key=lambda x: sort_key(x[0])):
        best_prediction = None
        best_confidence = -1.0
        thumbnail = None

        for i, photo in enumerate(photos):
            if i == 0:
                thumbnail = make_thumbnail(photo["content"])
            prediction = classify_image(photo["content"])
            if prediction and prediction["confidence"] > best_confidence:
                best_confidence = prediction["confidence"]
                best_prediction = prediction

        results.append({
            "tree_id":           tree_id,
            "predicted_species": best_prediction["species"] if best_prediction else "No identificado",
            "confidence":        round(best_confidence * 100, 1) if best_confidence >= 0 else 0,
            "thumbnail":         thumbnail,
        })

    # Guardar en base de datos
    location = {
        "departamento": departamento,
        "municipio":    municipio,
        "vereda":       vereda,
        "latitud":      latitud,
        "longitud":     longitud,
    }
    save_records(location, results)

    return results


# ── Registros históricos ───────────────────────────────────────────────────────
@api.get("/records")
async def get_records():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    rows = con.execute("SELECT * FROM records ORDER BY timestamp DESC").fetchall()
    con.close()
    return [dict(r) for r in rows]


# ── Feedback ───────────────────────────────────────────────────────────────────
@api.get("/classes")
async def get_classes():
    return class_names


@api.post("/feedback")
async def save_feedback(species: str = Form(...), files: List[UploadFile] = File(...)):
    target = FEEDBACK_DIR / species
    target.mkdir(parents=True, exist_ok=True)
    saved = 0
    for upload in files:
        content = await upload.read()
        fname = f"{int(time.time()*1000)}_{upload.filename}"
        (target / fname).write_bytes(content)
        saved += 1
    return {"saved": saved, "species": species}


@api.get("/feedback/stats")
async def feedback_stats():
    if not FEEDBACK_DIR.exists():
        return {"total": 0, "by_species": {}}
    stats = {}
    total = 0
    for d in FEEDBACK_DIR.iterdir():
        if d.is_dir():
            count = len([f for f in d.glob("*") if f.suffix.lower() in (".jpg", ".jpeg", ".png")])
            if count > 0:
                stats[d.name] = count
                total += count
    return {"total": total, "by_species": stats}


# ── Reentrenamiento ────────────────────────────────────────────────────────────

retrain_state = {"running": False, "message": "idle"}


def extract_embeddings_from_dir(source_dir: Path, species_to_idx: dict, backbone, transform, aug, aug_times: int):
    embeddings, labels = [], []
    for species_dir in source_dir.iterdir():
        if not species_dir.is_dir():
            continue
        sname = species_dir.name
        if sname not in species_to_idx:
            continue
        idx = species_to_idx[sname]
        for img_path in species_dir.glob("*"):
            if img_path.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                continue
            try:
                pil_img = Image.open(img_path).convert("RGB")
                variants = [transform(pil_img)] + [aug(pil_img) for _ in range(aug_times)]
                with torch.no_grad():
                    for t in variants:
                        feat = backbone(t.unsqueeze(0)).squeeze()
                        embeddings.append(feat)
                        labels.append(idx)
            except Exception:
                pass
    return embeddings, labels


def run_finetune():
    global retrain_state, model
    try:
        species_to_idx = {name: i for i, name in enumerate(class_names)}

        base_tf = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        aug_tf = transforms.Compose([
            transforms.RandomResizedCrop(224, scale=(0.65, 1.0)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomVerticalFlip(),
            transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])

        net = models.resnet50(weights=None)
        net.fc = nn.Sequential(nn.Dropout(0.4), nn.Linear(net.fc.in_features, len(class_names)))
        net.load_state_dict(torch.load(MODEL_PATH, map_location="cpu"))
        backbone = nn.Sequential(*list(net.children())[:-1])
        backbone.eval()

        all_embeddings, all_labels = [], []

        if CACHE_PATH.exists():
            retrain_state["message"] = "Cargando caché del dataset original..."
            cache = torch.load(CACHE_PATH, map_location="cpu")
            all_embeddings.extend(cache["embeddings"])
            all_labels.extend(cache["labels"])
            retrain_state["message"] = f"Caché cargado ({len(all_embeddings)} muestras). Procesando correcciones..."
        elif TRAINING_DIR.exists():
            total_species = sum(1 for d in TRAINING_DIR.iterdir() if d.is_dir())
            done = 0
            for species_dir in TRAINING_DIR.iterdir():
                if not species_dir.is_dir():
                    continue
                sname = species_dir.name
                if sname not in species_to_idx:
                    continue
                done += 1
                retrain_state["message"] = f"Calculando caché dataset original ({done}/{total_species}: {sname})..."
                idx = species_to_idx[sname]
                for img_path in species_dir.glob("*"):
                    if img_path.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                        continue
                    try:
                        pil_img = Image.open(img_path).convert("RGB")
                        with torch.no_grad():
                            feat = backbone(base_tf(pil_img).unsqueeze(0)).squeeze()
                        all_embeddings.append(feat)
                        all_labels.append(idx)
                    except Exception:
                        pass
            torch.save({"embeddings": all_embeddings, "labels": all_labels}, CACHE_PATH)
            retrain_state["message"] = f"Caché guardado ({len(all_embeddings)} muestras del dataset original)."
        else:
            retrain_state["message"] = "Dataset original no encontrado, usando solo correcciones..."

        if not FEEDBACK_DIR.exists() or not any(FEEDBACK_DIR.iterdir()):
            raise ValueError("No hay correcciones guardadas aún.")

        retrain_state["message"] = "Extrayendo embeddings de correcciones..."
        fb_embeddings, fb_labels = extract_embeddings_from_dir(
            FEEDBACK_DIR, species_to_idx, backbone, base_tf, aug_tf, aug_times=8
        )
        if len(fb_embeddings) == 0:
            raise ValueError("No se encontraron imágenes válidas en las correcciones.")

        all_embeddings.extend(fb_embeddings)
        all_labels.extend(fb_labels)

        species_present = len(set(all_labels))
        retrain_state["message"] = f"Entrenando con {len(all_embeddings)} muestras ({species_present} especies)..."

        X = torch.stack(all_embeddings)
        y = torch.tensor(all_labels)

        fc = net.fc
        for p in fc.parameters():
            p.requires_grad = True

        dataset   = torch.utils.data.TensorDataset(X, y)
        loader    = torch.utils.data.DataLoader(dataset, batch_size=64, shuffle=True)
        optimizer = torch.optim.Adam(fc.parameters(), lr=5e-4, weight_decay=1e-3)
        criterion = nn.CrossEntropyLoss()

        EPOCHS = 100
        fc.train()
        for epoch in range(EPOCHS):
            retrain_state["message"] = f"Entrenando época {epoch + 1}/{EPOCHS}..."
            for batch_x, batch_y in loader:
                optimizer.zero_grad()
                loss = criterion(fc(batch_x), batch_y)
                loss.backward()
                optimizer.step()

        retrain_state["message"] = "Guardando modelo actualizado..."
        backup = MODEL_PATH.parent / f"resnet50_plantas_backup_{int(time.time())}.pt"
        shutil.copy(MODEL_PATH, backup)
        net.fc = fc
        net.eval()
        torch.save(net.state_dict(), MODEL_PATH)
        model = net

        retrain_state = {
            "running": False,
            "message": f"✓ Modelo actualizado: {len(all_embeddings)} muestras totales, {len(fb_embeddings)} correcciones nuevas."
        }

    except Exception as e:
        retrain_state = {"running": False, "message": f"Error: {str(e)}"}


@api.post("/retrain")
async def start_retrain():
    global retrain_state
    if retrain_state["running"]:
        return {"status": "already_running"}
    retrain_state = {"running": True, "message": "Iniciando reentrenamiento..."}
    t = threading.Thread(target=run_finetune, daemon=True)
    t.start()
    return {"status": "started"}


@api.get("/retrain/status")
async def get_retrain_status():
    return retrain_state


# ── Registrar rutas API y servir frontend ──────────────────────────────────────
app.include_router(api)


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    if not DIST_DIR.exists():
        return {"error": "Frontend no compilado. Ejecuta 'npm run build' en la carpeta frontend/."}
    # Servir archivos estáticos si existen
    file_path = DIST_DIR / full_path
    if file_path.is_file():
        return FileResponse(file_path)
    # SPA fallback: siempre devolver index.html
    return FileResponse(DIST_DIR / "index.html")
