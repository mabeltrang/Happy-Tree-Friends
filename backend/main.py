import os
import base64
import re
import json
from io import BytesIO
from collections import defaultdict
from pathlib import Path
from typing import List

import torch
import torchvision.transforms as transforms
from torchvision import models
from torch import nn
from PIL import Image
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

# ── Cargar modelo al inicio ────────────────────────────────────────────────────
MODEL_DIR   = Path(__file__).parent / "model"
MODEL_PATH  = MODEL_DIR / "resnet50_plantas.pt"
CLASSES_PATH = MODEL_DIR / "class_names.json"

model = None
class_names = []

def load_model():
    global model, class_names

    if not MODEL_PATH.exists() or not CLASSES_PATH.exists():
        print("[WARN] Modelo no encontrado en backend/model/. Coloca resnet50_plantas.pt y class_names.json")
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

load_model()

# ── FastAPI ────────────────────────────────────────────────────────────────────
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Transform igual al de validación en Colab
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


# ── Endpoint ───────────────────────────────────────────────────────────────────
@app.post("/classify")
async def classify(files: List[UploadFile] = File(...)):
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
            "tree_id":          tree_id,
            "predicted_species": best_prediction["species"] if best_prediction else "No identificado",
            "confidence":        round(best_confidence * 100, 1) if best_confidence >= 0 else 0,
            "thumbnail":         thumbnail,
        })

    return results
