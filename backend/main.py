import os
import base64
import re
import json
import time
import shutil
import threading
import sqlite3
from contextlib import contextmanager
from io import BytesIO
from collections import defaultdict
from pathlib import Path
from typing import List, Optional

import torch
import torchvision.transforms as transforms
from torchvision import models
from torch import nn
from PIL import Image
import urllib.request as _ur
import urllib.parse as _up
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

# ── Rutas ──────────────────────────────────────────────────────────────────────
MODEL_DIR    = Path(__file__).parent / "model"
MODEL_PATH   = MODEL_DIR / "resnet50_plantas.pt"
CLASSES_PATH = MODEL_DIR / "class_names.json"
CACHE_PATH   = MODEL_DIR / "embeddings_cache.pt"
FEEDBACK_DIR = Path(__file__).parent / "feedback"
TRAINING_DIR = Path(__file__).parent.parent / "data" / "3 - copia"
DB_PATH      = Path(os.getenv("DATA_DIR", Path(__file__).parent)) / "records.db"
DATABASE_URL = os.getenv("DATABASE_URL")
MODEL_URL    = os.getenv("MODEL_URL")
SPECIES_INFO_PATH = MODEL_DIR / "species_info.json"
MADS_PATH         = MODEL_DIR / "mads_especies.json"

# ── Descargar modelo ───────────────────────────────────────────────────────────
def download_model_if_needed():
    import urllib.request
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    # Verificar si el modelo existente tiene el número correcto de clases
    if MODEL_PATH.exists() and CLASSES_PATH.exists():
        try:
            with open(CLASSES_PATH) as f:
                existing_classes = json.load(f)
            sd = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
            model_classes = sd["fc.1.weight"].shape[0]
            if model_classes == len(existing_classes):
                print(f"[OK] Modelo ya existe con {model_classes} clases, no se descarga.")
                return
            else:
                print(f"[WARN] Modelo tiene {model_classes} clases pero class_names.json tiene {len(existing_classes)}. Descargando nuevo...")
                MODEL_PATH.unlink()
                CLASSES_PATH.unlink()
        except Exception as e:
            print(f"[WARN] Error verificando modelo: {e}. Descargando de nuevo...")
            MODEL_PATH.unlink(missing_ok=True)
            CLASSES_PATH.unlink(missing_ok=True)

    if not MODEL_URL:
        print("[WARN] MODEL_URL no configurado y modelo no encontrado.")
        return

    print("[INFO] Descargando modelo desde HuggingFace...")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    print("[OK] Modelo descargado.")

    print("[INFO] Descargando class_names.json ...")
    urllib.request.urlretrieve(
        "https://huggingface.co/mabeltrang/happy-tree-friends-model/resolve/main/class_names.json",
        CLASSES_PATH
    )
    print("[OK] class_names.json descargado.")

download_model_if_needed()

# ── Base de datos ──────────────────────────────────────────────────────────────
USE_PG = bool(DATABASE_URL)

@contextmanager
def get_db():
    if USE_PG:
        import psycopg2, psycopg2.extras
        con = psycopg2.connect(DATABASE_URL)
        try:
            yield con, "%s"
            con.commit()
        finally:
            con.close()
    else:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        try:
            yield con, "?"
        finally:
            con.commit()
            con.close()

def init_db():
    if USE_PG:
        import psycopg2
        con = psycopg2.connect(DATABASE_URL)
        con.cursor().execute("""
            CREATE TABLE IF NOT EXISTS classifications (
                id            SERIAL PRIMARY KEY,
                created_at    TEXT   NOT NULL,
                tree_id       TEXT   NOT NULL,
                species       TEXT   NOT NULL,
                confidence    REAL   NOT NULL,
                departamento  TEXT,
                municipio     TEXT,
                vereda        TEXT,
                latitud       REAL,
                longitud      REAL
            )
        """)
        con.commit()
        con.close()
    else:
        con = sqlite3.connect(DB_PATH)
        con.execute("""
            CREATE TABLE IF NOT EXISTS classifications (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at    TEXT    NOT NULL,
                tree_id       TEXT    NOT NULL,
                species       TEXT    NOT NULL,
                confidence    REAL    NOT NULL,
                departamento  TEXT,
                municipio     TEXT,
                vereda        TEXT,
                latitud       REAL,
                longitud      REAL
            )
        """)
        con.commit()
        con.close()

init_db()

def save_records(results, departamento, municipio, vereda, latitud, longitud):
    ts = time.strftime("%Y-%m-%dT%H:%M:%S")
    with get_db() as (con, ph):
        cur = con.cursor()
        for r in results:
            cur.execute(f"""
                INSERT INTO classifications
                  (created_at, tree_id, species, confidence, departamento, municipio, vereda, latitud, longitud)
                VALUES ({ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph})
            """, (ts, r["tree_id"], r["predicted_species"], r["confidence"],
                  departamento, municipio, vereda, latitud, longitud))

# ── Cargar modelo ──────────────────────────────────────────────────────────────
model = None
class_names = []

def load_model():
    global model, class_names
    if not MODEL_PATH.exists() or not CLASSES_PATH.exists():
        print("[WARN] Modelo no encontrado en backend/model/.")
        return
    with open(CLASSES_PATH, "r", encoding="utf-8") as f:
        class_names = json.load(f)
    num_classes = len(class_names)
    net = models.resnet50(weights=None)
    net.fc = nn.Sequential(nn.Dropout(0.4), nn.Linear(net.fc.in_features, num_classes))
    net.load_state_dict(torch.load(MODEL_PATH, map_location="cpu", weights_only=False))
    net.eval()
    model = net
    print(f"[OK] Modelo cargado: {num_classes} clases: {class_names}")

load_model()

# ── FastAPI ────────────────────────────────────────────────────────────────────
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INFER_TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])

CONFIDENCE_THRESHOLD = 0.60

# ── Utilidades ─────────────────────────────────────────────────────────────────
def parse_tree_id(filename: str) -> str | None:
    name = filename.rsplit(".", 1)[0]
    match = re.match(r"^(\w+)-\d+$", name)
    return match.group(1) if match else None

def make_thumbnail(image_bytes: bytes, size: int = 200) -> str:
    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    img.thumbnail((size, size))
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return f"data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode()}"

def _open_tensor(image_bytes: bytes):
    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    return INFER_TRANSFORM(img)

# ── Endpoints ──────────────────────────────────────────────────────────────────
@app.post("/api/classify")
async def classify(
    files: List[UploadFile] = File(...),
    departamento: str = Form(...),
    municipio:    str = Form(...),
    vereda:       str = Form(""),
    latitud:      Optional[float] = Form(None),
    longitud:     Optional[float] = Form(None),
):
    if model is None:
        raise HTTPException(status_code=503, detail="Modelo no cargado.")

    tree_files: dict[str, list] = defaultdict(list)
    for upload in files:
        filename = upload.filename or ""
        tree_id  = parse_tree_id(filename)
        content  = await upload.read()
        if tree_id is None:
            continue
        tree_files[tree_id].append({"filename": filename, "content": content})

    if not tree_files:
        raise HTTPException(status_code=400, detail="Ningún archivo tiene el formato correcto (ej: '1-1.jpg').")

    def sort_key(k):
        try:    return (0, int(k))
        except: return (1, k)

    # Construir lista plana: (tree_id, tensor, content)
    flat: list[tuple] = []
    for tree_id, photos in sorted(tree_files.items(), key=lambda x: sort_key(x[0])):
        for photo in photos:
            try:
                tensor = _open_tensor(photo["content"])
                flat.append((tree_id, tensor, photo["content"]))
            except Exception:
                pass

    # Forward pass en sub-lotes de 16 para no saturar RAM ni superar timeout
    SUB_BATCH = 16
    all_probs: list[torch.Tensor] = []
    with torch.no_grad():
        for start in range(0, len(flat), SUB_BATCH):
            chunk = flat[start:start + SUB_BATCH]
            batch = torch.stack([item[1] for item in chunk])
            probs = torch.softmax(model(batch), dim=1)
            all_probs.append(probs)
    probs_all = torch.cat(all_probs, dim=0)

    # Seleccionar mejor predicción por árbol
    best: dict[str, dict] = {}
    for idx, (tree_id, _, content) in enumerate(flat):
        probs    = probs_all[idx]
        pred_idx = probs.argmax().item()
        conf     = probs[pred_idx].item()
        if tree_id not in best or conf > best[tree_id]["confidence"]:
            best[tree_id] = {
                "species":    class_names[pred_idx],
                "confidence": conf,
                "content":    content,
            }

    results = []
    for tree_id, _ in sorted(tree_files.items(), key=lambda x: sort_key(x[0])):
        b = best.get(tree_id)
        below_threshold = b is None or b["confidence"] < CONFIDENCE_THRESHOLD
        results.append({
            "tree_id":           tree_id,
            "predicted_species": "No determinado" if below_threshold else b["species"],
            "confidence":        round(b["confidence"] * 100, 1) if b else 0,
            "thumbnail":         make_thumbnail(b["content"]) if b else None,
            "departamento":      departamento,
            "municipio":         municipio,
            "vereda":            vereda,
            "latitud":           latitud,
            "longitud":          longitud,
        })

    save_records(results, departamento, municipio, vereda, latitud, longitud)
    return results


@app.get("/api/records")
async def get_records():
    if USE_PG:
        import psycopg2.extras
        con = psycopg2.connect(DATABASE_URL)
        cur = con.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM classifications ORDER BY created_at DESC")
        rows = cur.fetchall()
        con.close()
        return [dict(r) for r in rows]
    else:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        rows = con.execute("SELECT * FROM classifications ORDER BY created_at DESC").fetchall()
        con.close()
        return [dict(r) for r in rows]


@app.get("/api/classes")
async def get_classes():
    return class_names


def _load_species_info() -> dict:
    if SPECIES_INFO_PATH.exists():
        with open(SPECIES_INFO_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def _save_species_info(data: dict):
    with open(SPECIES_INFO_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def _lookup_gbif(species_name: str) -> dict:
    try:
        import urllib.request as _ur
        import urllib.parse as _up
        query = _up.urlencode({"name": species_name, "verbose": "false"})
        with _ur.urlopen(f"https://api.gbif.org/v1/species/match?{query}", timeout=10) as r:
            data = json.loads(r.read())
        family    = data.get("family", "")
        usage_key = data.get("usageKey")
        common_name = ""
        if usage_key:
            with _ur.urlopen(
                f"https://api.gbif.org/v1/species/{usage_key}/vernacularNames?limit=30",
                timeout=10
            ) as r:
                vn = json.loads(r.read()).get("results", [])
            es = [n["vernacularName"] for n in vn if n.get("language") == "spa"]
            en = [n["vernacularName"] for n in vn if n.get("language") == "eng"]
            common_name = es[0] if es else (en[0] if en else "")
        return {"common_name": common_name, "family": family}
    except Exception as e:
        print(f"[WARN] GBIF lookup falló para '{species_name}': {e}")
        return {"common_name": "", "family": ""}

@app.get("/api/species-info")
async def get_species_info():
    info    = _load_species_info()
    updated = False
    for species in class_names:
        if species not in info:
            print(f"[INFO] Consultando GBIF para: {species}")
            info[species] = _lookup_gbif(species)
            updated = True
    if updated:
        _save_species_info(info)
    return info


@app.post("/api/feedback")
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


@app.get("/api/feedback/stats")
async def feedback_stats():
    if not FEEDBACK_DIR.exists():
        return {"total": 0, "by_species": {}}
    stats, total = {}, 0
    for d in FEEDBACK_DIR.iterdir():
        if d.is_dir():
            count = len([f for f in d.glob("*") if f.suffix.lower() in (".jpg", ".jpeg", ".png")])
            if count > 0:
                stats[d.name] = count
                total += count
    return {"total": total, "by_species": stats}


# ── Reentrenamiento ────────────────────────────────────────────────────────────
retrain_state = {"running": False, "message": "idle"}

def extract_embeddings_from_dir(source_dir, species_to_idx, backbone, transform, aug, aug_times):
    embeddings, labels = [], []
    for species_dir in source_dir.iterdir():
        if not species_dir.is_dir(): continue
        sname = species_dir.name
        if sname not in species_to_idx: continue
        idx = species_to_idx[sname]
        for img_path in species_dir.glob("*"):
            if img_path.suffix.lower() not in (".jpg", ".jpeg", ".png"): continue
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
            transforms.Resize((224, 224)), transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        aug_tf = transforms.Compose([
            transforms.RandomResizedCrop(224, scale=(0.65, 1.0)),
            transforms.RandomHorizontalFlip(), transforms.RandomVerticalFlip(),
            transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        net = models.resnet50(weights=None)
        net.fc = nn.Sequential(nn.Dropout(0.4), nn.Linear(net.fc.in_features, len(class_names)))
        net.load_state_dict(torch.load(MODEL_PATH, map_location="cpu", weights_only=False))
        backbone = nn.Sequential(*list(net.children())[:-1])
        backbone.eval()
        all_embeddings, all_labels = [], []

        if CACHE_PATH.exists():
            retrain_state["message"] = "Cargando caché del dataset original..."
            cache = torch.load(CACHE_PATH, map_location="cpu", weights_only=False)
            all_embeddings.extend(cache["embeddings"])
            all_labels.extend(cache["labels"])
        elif TRAINING_DIR.exists():
            total_species = sum(1 for d in TRAINING_DIR.iterdir() if d.is_dir())
            done = 0
            for species_dir in TRAINING_DIR.iterdir():
                if not species_dir.is_dir(): continue
                sname = species_dir.name
                if sname not in species_to_idx: continue
                done += 1
                retrain_state["message"] = f"Calculando caché ({done}/{total_species}: {sname})..."
                idx = species_to_idx[sname]
                for img_path in species_dir.glob("*"):
                    if img_path.suffix.lower() not in (".jpg", ".jpeg", ".png"): continue
                    try:
                        pil_img = Image.open(img_path).convert("RGB")
                        with torch.no_grad():
                            feat = backbone(base_tf(pil_img).unsqueeze(0)).squeeze()
                        all_embeddings.append(feat)
                        all_labels.append(idx)
                    except Exception:
                        pass
            torch.save({"embeddings": all_embeddings, "labels": all_labels}, CACHE_PATH)

        if not FEEDBACK_DIR.exists() or not any(FEEDBACK_DIR.iterdir()):
            raise ValueError("No hay correcciones guardadas aún.")

        retrain_state["message"] = "Extrayendo embeddings de correcciones..."
        fb_embeddings, fb_labels = extract_embeddings_from_dir(
            FEEDBACK_DIR, species_to_idx, backbone, base_tf, aug_tf, aug_times=8
        )
        if not fb_embeddings:
            raise ValueError("No se encontraron imágenes válidas en las correcciones.")

        all_embeddings.extend(fb_embeddings)
        all_labels.extend(fb_labels)
        retrain_state["message"] = f"Entrenando con {len(all_embeddings)} muestras..."

        X = torch.stack(all_embeddings)
        y = torch.tensor(all_labels)
        fc = net.fc
        for p in fc.parameters(): p.requires_grad = True
        loader    = torch.utils.data.DataLoader(torch.utils.data.TensorDataset(X, y), batch_size=64, shuffle=True)
        optimizer = torch.optim.Adam(fc.parameters(), lr=5e-4, weight_decay=1e-3)
        criterion = nn.CrossEntropyLoss()
        fc.train()
        for epoch in range(100):
            retrain_state["message"] = f"Entrenando época {epoch+1}/100..."
            for bx, by in loader:
                optimizer.zero_grad()
                criterion(fc(bx), by).backward()
                optimizer.step()

        retrain_state["message"] = "Guardando modelo actualizado..."
        shutil.copy(MODEL_PATH, MODEL_PATH.parent / f"resnet50_plantas_backup_{int(time.time())}.pt")
        net.fc = fc
        net.eval()
        torch.save(net.state_dict(), MODEL_PATH)
        model = net
        retrain_state = {"running": False, "message": f"✓ Modelo actualizado con {len(fb_embeddings)} correcciones nuevas."}
    except Exception as e:
        retrain_state = {"running": False, "message": f"Error: {str(e)}"}

@app.post("/api/retrain")
async def start_retrain():
    global retrain_state
    if retrain_state["running"]: return {"status": "already_running"}
    retrain_state = {"running": True, "message": "Iniciando reentrenamiento..."}
    threading.Thread(target=run_finetune, daemon=True).start()
    return {"status": "started"}

@app.get("/api/retrain/status")
async def get_retrain_status():
    return retrain_state


# ── Estado de Amenaza (CITES, IUCN, MADS) ─────────────────────────────────────
def _load_mads_data() -> dict:
    if MADS_PATH.exists():
        with open(MADS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def _query_iucn(species_name: str) -> str:
    token = os.getenv("IUCN_API_TOKEN", "")
    if not token:
        return "Sin configurar"
    try:
        encoded = _up.quote(species_name)
        url = f"https://apiv3.iucnredlist.org/api/v3/species/{encoded}?token={token}"
        with _ur.urlopen(url, timeout=10) as r:
            data = json.loads(r.read())
        result = data.get("result", [])
        if result:
            return result[0].get("category", "No encontrado")
        return "No encontrado"
    except Exception as e:
        print(f"[WARN] IUCN query falló para '{species_name}': {e}")
        return "Error"

def _query_cites(species_name: str) -> str:
    token = os.getenv("CITES_API_TOKEN", "")
    if not token:
        return "Sin configurar"
    try:
        encoded = _up.quote(species_name)
        url = f"https://api.speciesplus.net/api/v1/taxon_concepts.json?name={encoded}&with_descendants=true"
        req = _ur.Request(url, headers={"X-Authentication-Token": token})
        with _ur.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        for taxon in data.get("taxon_concepts", []):
            listings = taxon.get("cites_listings", [])
            if listings:
                latest = sorted(listings, key=lambda x: x.get("change_date", ""), reverse=True)[0]
                return f"Apéndice {latest.get('appendix', '?')}"
        return "No listado"
    except Exception as e:
        print(f"[WARN] CITES query falló para '{species_name}': {e}")
        return "Error"

class ThreatStatusRequest(BaseModel):
    species: List[str]

@app.post("/api/threat-status")
async def get_threat_status(req: ThreatStatusRequest):
    mads_data = _load_mads_data()
    results = []
    for raw in req.species:
        name = raw.strip()
        if not name:
            continue
        # MADS lookup (case-insensitive)
        mads_status = "No listado"
        for key, val in mads_data.items():
            if key.lower() == name.lower():
                mads_status = val
                break
        results.append({
            "species": name,
            "iucn":   _query_iucn(name),
            "cites":  _query_cites(name),
            "mads":   mads_status,
        })
    return results


# ── Ocurrencias GBIF ───────────────────────────────────────────────────────────
def _fetch_gbif(species: str, limit: int) -> dict:
    try:
        encoded = _up.quote(species)
        url = (
            f"https://api.gbif.org/v1/occurrence/search"
            f"?scientificName={encoded}&hasCoordinate=true&limit={limit}"
        )
        with _ur.urlopen(url, timeout=15) as r:
            data = json.loads(r.read())
        points = []
        for occ in data.get("results", []):
            lat = occ.get("decimalLatitude")
            lng = occ.get("decimalLongitude")
            if lat is not None and lng is not None:
                points.append({
                    "lat": lat,
                    "lng": lng,
                    "country": occ.get("country", ""),
                    "stateProvince": occ.get("stateProvince", ""),
                    "year": occ.get("year"),
                })
        return {"species": species, "occurrences": points}
    except Exception as e:
        print(f"[WARN] GBIF fetch falló para '{species}': {e}")
        return {"species": species, "occurrences": []}

@app.get("/api/gbif-occurrences")
async def gbif_occurrences(species: str, limit: int = 300):
    result = _fetch_gbif(species, limit)
    if not result["occurrences"] and len(result["occurrences"]) == 0:
        pass  # no error, just empty
    return result

@app.get("/api/gbif-occurrences/all")
async def gbif_occurrences_all(limit_per_species: int = 150):
    """Carga ocurrencias GBIF de todas las especies del modelo en paralelo."""
    import concurrent.futures
    if not class_names:
        return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
        futures = [ex.submit(_fetch_gbif, sp, limit_per_species) for sp in class_names]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]
    return results


# ── Servir frontend compilado ──────────────────────────────────────────────────
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/")
    async def serve_root():
        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = FRONTEND_DIST / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")
