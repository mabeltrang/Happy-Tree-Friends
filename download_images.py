"""
Descarga imágenes de iNaturalist y GBIF para las especies del modelo.
Uso:
    python download_images.py                        # todas las especies, 100 fotos c/u
    python download_images.py --max 200              # 200 fotos por especie
    python download_images.py --species "Crescentia cujete" --max 50
    python download_images.py --source inaturalist   # solo una fuente
"""

import argparse
import json
import time
import urllib.request
import urllib.parse
from pathlib import Path

# ── Configuración ──────────────────────────────────────────────────────────────
CLASSES_PATH  = Path("backend/model/class_names.json")
OUTPUT_DIR    = Path("data/descargadas")
DELAY         = 0.3   # segundos entre requests para no saturar las APIs

# Colombia: place_id en iNaturalist = 7512
INAT_PLACE_ID = 7512


# ── Utilidades ─────────────────────────────────────────────────────────────────
def get_json(url: str) -> dict | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "HappyTreeFriends/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"    [ERROR] {url[:80]}... → {e}")
        return None


def download_image(url: str, dest: Path) -> bool:
    if dest.exists():
        return False  # ya existe
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "HappyTreeFriends/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            dest.write_bytes(r.read())
        return True
    except Exception:
        return False


# ── iNaturalist ────────────────────────────────────────────────────────────────
def fetch_inaturalist(species: str, folder: Path, max_imgs: int):
    print(f"  [iNaturalist] Buscando '{species}'...")
    downloaded = 0
    page = 1
    per_page = min(200, max_imgs)

    while downloaded < max_imgs:
        params = urllib.parse.urlencode({
            "taxon_name":    species,
            "place_id":      INAT_PLACE_ID,
            "quality_grade": "research",
            "photos":        "true",
            "per_page":      per_page,
            "page":          page,
            "order_by":      "votes",
        })
        data = get_json(f"https://api.inaturalist.org/v1/observations?{params}")
        if not data or not data.get("results"):
            break

        for obs in data["results"]:
            if downloaded >= max_imgs:
                break
            for photo in obs.get("photos", []):
                if downloaded >= max_imgs:
                    break
                url = photo.get("url", "").replace("square", "medium")
                if not url:
                    continue
                obs_id = obs.get("id", "")
                ext    = url.split(".")[-1].split("?")[0] or "jpg"
                dest   = folder / f"inat_{obs_id}_{photo.get('id','')}.{ext}"
                if download_image(url, dest):
                    downloaded += 1
                    print(f"    ✓ {dest.name} ({downloaded}/{max_imgs})")
                time.sleep(DELAY)

        total = data.get("total_results", 0)
        if page * per_page >= total:
            break
        page += 1

    print(f"  [iNaturalist] {downloaded} fotos descargadas para '{species}'")
    return downloaded


# ── GBIF ───────────────────────────────────────────────────────────────────────
def fetch_gbif(species: str, folder: Path, max_imgs: int):
    # GBIF usa el nombre en minúsculas para el epiteto
    species_gbif = species[0].upper() + species[1:].lower() if " " in species else species
    # Preservar el género en mayúscula
    parts = species.split()
    if len(parts) == 2:
        species_gbif = parts[0][0].upper() + parts[0][1:].lower() + " " + parts[1].lower()

    print(f"  [GBIF] Buscando '{species_gbif}'...")
    downloaded = 0
    offset = 0
    limit  = min(300, max_imgs)

    while downloaded < max_imgs:
        params = urllib.parse.urlencode({
            "scientificName": species_gbif,
            "country":        "CO",
            "mediaType":      "StillImage",
            "hasCoordinate":  "true",
            "limit":          limit,
            "offset":         offset,
        })
        data = get_json(f"https://api.gbif.org/v1/occurrence/search?{params}")
        if not data or not data.get("results"):
            break

        for occ in data["results"]:
            if downloaded >= max_imgs:
                break
            for media in occ.get("media", []):
                if downloaded >= max_imgs:
                    break
                url = media.get("identifier", "")
                if not url or not url.startswith("http"):
                    continue
                occ_key = occ.get("key", "")
                ext     = url.split(".")[-1].split("?")[0]
                ext     = ext if ext in ("jpg", "jpeg", "png") else "jpg"
                dest    = folder / f"gbif_{occ_key}.{ext}"
                if download_image(url, dest):
                    downloaded += 1
                    print(f"    ✓ {dest.name} ({downloaded}/{max_imgs})")
                time.sleep(DELAY)

        end_of_records = data.get("endOfRecords", True)
        if end_of_records:
            break
        offset += limit

    print(f"  [GBIF] {downloaded} fotos descargadas para '{species}'")
    return downloaded


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Descarga imágenes de iNaturalist y GBIF")
    parser.add_argument("--species", type=str, default=None, help="Especie específica (opcional)")
    parser.add_argument("--max",     type=int, default=100,  help="Máximo de fotos por especie por fuente (default: 100)")
    parser.add_argument("--source",  type=str, default="all", choices=["all", "inaturalist", "gbif"], help="Fuente de datos")
    args = parser.parse_args()

    # Cargar lista de especies
    if args.species:
        species_list = [args.species]
    else:
        with open(CLASSES_PATH, encoding="utf-8") as f:
            species_list = json.load(f)

    print(f"\n{'='*60}")
    print(f"  Descargando {args.max} fotos/fuente para {len(species_list)} especie(s)")
    print(f"  Fuente: {args.source} | Destino: {OUTPUT_DIR}")
    print(f"{'='*60}\n")

    total = 0
    for species in species_list:
        # Normalizar nombre para carpeta
        folder_name = species.replace(" ", "_")
        folder = OUTPUT_DIR / folder_name
        folder.mkdir(parents=True, exist_ok=True)

        print(f"\n{'─'*50}")
        print(f"  Especie: {species}")
        print(f"{'─'*50}")

        if args.source in ("all", "inaturalist"):
            total += fetch_inaturalist(species, folder, args.max)

        if args.source in ("all", "gbif"):
            total += fetch_gbif(species, folder, args.max)

    print(f"\n{'='*60}")
    print(f"  TOTAL descargado: {total} fotos")
    print(f"  Carpeta: {OUTPUT_DIR.resolve()}")
    print(f"  Para usar en el modelo, copia las carpetas a: data/3 - copia/")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
