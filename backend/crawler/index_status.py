"""Helpers for classifying which PDFs under BASE_PDF_PATH are indexed. Shared by the eval and ingest tooling."""
import hashlib
import os

from backend.utils import json_dumps


def config_hash(config_data: dict) -> str:
    """Identical to SingleFileProcessor._get_config_hash in discovery.py."""
    return hashlib.sha256(json_dumps(config_data, sort_keys=True).encode('utf-8')).hexdigest()


def classify_index_status(state: dict, current_config_hash: str) -> str:
    """Map a DB state row to a status string by comparing stored vs current config_hash."""
    if not state:
        return "never_indexed"
    stored_config_hash = state.get("config_hash")
    ocr_checksum = state.get("ocr_checksum")
    if not stored_config_hash:
        return "ocr_only" if ocr_checksum else "never_indexed"
    if stored_config_hash != current_config_hash:
        return "stale"
    return "indexed"


def walk_pdfs(base_pdf_path: str):
    """Yield absolute PDF file paths, respecting _ignore markers."""
    for dirpath, dirnames, filenames in os.walk(base_pdf_path):
        # Prune ignored and hidden dirs in-place
        dirnames[:] = sorted(
            d for d in dirnames
            if not d.startswith(".")
            and not os.path.exists(os.path.join(dirpath, d, "_ignore"))
        )
        if os.path.exists(os.path.join(dirpath, "_ignore")):
            dirnames.clear()
            continue
        for fn in filenames:
            if fn.lower().endswith(".pdf"):
                yield os.path.join(dirpath, fn)


def terminal_scan_config_dir(file_path: str, base_pdf_path: str) -> str:
    """
    Return relative path of the deepest directory (closest to file_path) that
    contains a scan_config.json.  This is the 'terminal' scan_config for the file.
    Falls back to "" if none found.
    """
    current = os.path.dirname(file_path)
    while True:
        if os.path.exists(os.path.join(current, "scan_config.json")):
            return os.path.relpath(current, base_pdf_path)
        if os.path.samefile(current, base_pdf_path):
            break
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return ""
