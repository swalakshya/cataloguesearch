"""Opt-in physical-page overrides and cache recipes; existing configs are unchanged."""
import hashlib
import json
from pathlib import Path

RECIPE_FILE = ".auto-tesseract-recipe.json"
AUTO_OCR_VERSION = 1


def validate_auto_pages(scan_config, num_pages=None):
    pages = scan_config.get("auto_tesseract_pages", [])
    if not isinstance(pages, list) or any(type(p) is not int or p < 1 for p in pages):
        raise ValueError("auto_tesseract_pages must be a list of positive physical PDF page numbers")
    if pages and scan_config.get("multi_page"):
        raise ValueError("auto_tesseract_pages cannot be combined with multi_page book spreads")
    for page in pages:
        if num_pages and page > num_pages:
            raise ValueError(f"auto_tesseract_pages: page {page} exceeds PDF length {num_pages}")
        if page < scan_config.get("start_page", 1) or page > scan_config.get("end_page", float("inf")):
            raise ValueError(f"auto_tesseract_pages: page {page} is outside start_page/end_page")
        if page in scan_config.get("skip_pdf_pages", []):
            raise ValueError(f"auto_tesseract_pages: page {page} is explicitly skipped")
    return sorted(set(pages))


def included_pages(pages, scan_config):
    start, end = scan_config.get("start_page", 1), scan_config.get("end_page", float("inf"))
    skipped = set(scan_config.get("skip_pdf_pages", []))
    return sorted({p for p in pages if start <= p <= end and p not in skipped})


def ocr_directory(pdf_file, config):
    return Path(config.BASE_OCR_PATH) / Path(pdf_file).relative_to(Path(config.BASE_PDF_PATH)).with_suffix("")


def recipe(pdf_file, scan_config, config):
    # Retain only extraction settings. Text-only tuning should not trigger paid OCR.
    keys = ("auto_tesseract_pages", "crop", "psm", "language", "ocr_engine", "llm_model",
            "llm_mode", "start_page", "end_page", "page_list", "skip_pdf_pages")
    settings = {key: scan_config[key] for key in keys if key in scan_config}
    if "sub_sections" in scan_config:
        settings["sub_sections"] = [
            {key: section[key] for key in ("start_page", "end_page") if key in section}
            for section in scan_config["sub_sections"]]
    settings["auto_tesseract_pages"] = validate_auto_pages(scan_config)
    settings.setdefault("ocr_engine", getattr(config, "OCR_ENGINE", "tesseract"))
    settings.setdefault("llm_model", getattr(config, "DEFAULT_LLM_MODEL", None))
    settings.setdefault("llm_mode", getattr(config, "LLM_MODE", None))
    stat = Path(pdf_file).stat()
    data = {"version": AUTO_OCR_VERSION, "settings": settings, "pdf": [stat.st_size, stat.st_mtime_ns]}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def recipe_current(pdf_file, scan_config, config):
    directory = ocr_directory(pdf_file, config)
    marker = directory / RECIPE_FILE
    if not scan_config.get("auto_tesseract_pages") and not marker.exists():
        return True
    try:
        return json.loads(marker.read_text())["recipe"] == recipe(pdf_file, scan_config, config)
    except (OSError, ValueError, KeyError):
        return False


def prepare_ocr_cache(pdf_file, scan_config, config):
    """Invalidate this PDF's OCR only when the opt-in recipe changes (including removal)."""
    directory = ocr_directory(pdf_file, config)
    marker = directory / RECIPE_FILE
    if recipe_current(pdf_file, scan_config, config):
        return False
    directory.mkdir(parents=True, exist_ok=True)
    # Keep unrelated sidecars/backups, but no old OCR page may masquerade as the
    # new mode. Retain a recipe with [] after removal to track future changes.
    for pattern in ("page_*.json", "page_*.txt"):
        for path in directory.glob(pattern):
            path.unlink()
    temporary = marker.with_suffix(".tmp")
    temporary.write_text(json.dumps({"recipe": recipe(pdf_file, scan_config, config)}))
    temporary.replace(marker)
    return True
