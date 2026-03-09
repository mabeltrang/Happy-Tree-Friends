# ── Build frontend ─────────────────────────────────────────────────────────────
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ── Build backend + serve todo ─────────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y wget && \
    mkdir -p backend/model && \
    wget -O backend/model/resnet50_plantas.pt \
    "https://huggingface.co/mabeltrang/happy-tree-friends-model/resolve/main/modelo.pt"

# Instalar PyTorch CPU-only (mucho más liviano)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Instalar resto de dependencias
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copiar backend
COPY backend/ ./backend/

# Copiar frontend compilado
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Copiar imágenes del frontend (fondos, logo)
COPY ["frontend/Fondo de página 1.jpg", "./frontend/dist/"]
COPY ["frontend/Fondo de página 2.jpg", "./frontend/dist/"]
COPY ["frontend/Logo Unergy.png", "./frontend/dist/"]

WORKDIR /app

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
