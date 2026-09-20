"""Which PDFs under BASE_PDF_PATH still need ingesting, for the Discover page.

Three states, from the SQLite index state (same source the eval "Unindexed PDFs" view uses):
  not_indexed  nothing done yet
  ocred        OCR finished, index step not done
  indexed      indexed (a "stale" config hash is counted as indexed for now -- see below)
"""
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.common.scan_config import get_scan_config
from backend.common.utils import get_merged_config
from backend.config import Config
from backend.crawler.index_state import IndexState
from backend.crawler.index_status import (
    classify_index_status, config_hash, terminal_scan_config_dir, walk_pdfs,
)

NOT_INDEXED, OCRED, INDEXED = "not_indexed", "ocred", "indexed"
_ORDER = {NOT_INDEXED: 0, OCRED: 1, INDEXED: 2}
# "stale" (config changed since indexing) is deliberately treated as indexed until that logic is fixed.
_MAP = {"never_indexed": NOT_INDEXED, "ocr_only": OCRED, "stale": INDEXED, "indexed": INDEXED}
PENDING = (NOT_INDEXED, OCRED)


def _load_config() -> Config:
    return Config("configs/config.yaml")


def _blank_counts() -> Dict[str, int]:
    return {NOT_INDEXED: 0, OCRED: 0, INDEXED: 0}


def scan(only_dir: Optional[str] = None) -> Dict[str, Any]:
    """Classify every PDF. `only_dir` (relative to BASE_PDF_PATH) limits the walk to that subtree, recursively."""
    config = _load_config()
    base = config.BASE_PDF_PATH
    if not base or not os.path.isdir(base):
        raise RuntimeError("BASE_PDF_PATH not configured or missing")
    if not config.SQLITE_DB_PATH or not os.path.isfile(config.SQLITE_DB_PATH):
        raise RuntimeError("SQLITE_DB_PATH not configured or DB missing")

    index_state = IndexState(config.SQLITE_DB_PATH)
    all_states = index_state.load_state()
    batches = {j["file_path"]: j for j in index_state.list_pending_batch_jobs() if j.get("file_path")}
    now = datetime.now(timezone.utc)

    walk_root = os.path.join(base, only_dir) if only_dir else base
    categories: Dict[str, Dict[str, List[dict]]] = {}
    seen = set()

    for file_path in walk_pdfs(walk_root):
        rel = os.path.relpath(file_path, base)
        if rel in seen:
            continue
        seen.add(rel)

        metadata = get_merged_config(file_path, base)
        category = metadata.get("category", "Uncategorised")
        scan_cfg = get_scan_config(file_path, base)
        file_metadata = dict(metadata)
        file_metadata["file_url"] = scan_cfg.get("file_url", "")
        if "volume" in scan_cfg:
            file_metadata["volume"] = scan_cfg["volume"]

        sub_sections = scan_cfg.get("sub_sections", [])
        sub_rows = None
        if sub_sections:
            base_doc_id = str(uuid.uuid5(uuid.NAMESPACE_URL, rel))
            base_ocr_done = bool(all_states.get(base_doc_id, {}).get("ocr_checksum"))
            sub_rows = []
            for ss in sub_sections:
                field, name = ss.get("field", ""), ss.get("name", "")
                doc_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{rel}#{field}:{name}"))
                raw = classify_index_status(
                    all_states.get(doc_id, {}),
                    config_hash({**file_metadata, "sub_section": {"field": field, "name": name}}))
                if raw == "never_indexed" and base_ocr_done:
                    raw = "ocr_only"
                sub_rows.append({"name": name, "status": _MAP[raw]})
            status = min((r["status"] for r in sub_rows), key=_ORDER.get)
            last_indexed = None
        else:
            state = all_states.get(str(uuid.uuid5(uuid.NAMESPACE_URL, rel)), {})
            status = _MAP[classify_index_status(state, config_hash(file_metadata))]
            last_indexed = state.get("last_indexed_timestamp")

        batch = batches.get(rel)
        categories.setdefault(category, {}).setdefault(terminal_scan_config_dir(file_path, base), []).append({
            "filename": os.path.basename(file_path),
            "relative_path": rel,
            "status": status,
            "sub_sections": sub_rows,
            "last_indexed": last_indexed,
            "batch": {
                "job": batch["batch_job_name"],
                "submitted_at": batch["batch_submitted_at"],
                "model": batch["batch_model"],
            } if batch else None,
        })

    totals = _blank_counts()
    out_categories = []
    for cat in sorted(categories):
        cat_counts = _blank_counts()
        folders = []
        for rel_dir, files in categories[cat].items():
            files.sort(key=lambda f: (_ORDER[f["status"]], f["filename"]))
            counts = _blank_counts()
            for f in files:
                counts[f["status"]] += 1
            for k, v in counts.items():
                cat_counts[k] += v
                totals[k] += v
            folders.append({
                "dir": rel_dir,
                # process-folder needs a directory that has a scan_config; files outside one can't be targeted
                "runnable": bool(rel_dir),
                "counts": counts,
                "pending": counts[NOT_INDEXED] + counts[OCRED],
                "batch_pending": sum(1 for f in files if f["batch"]),
                "files": files,
            })
        folders.sort(key=lambda f: (-f["pending"], f["dir"]))
        out_categories.append({"name": cat, "counts": cat_counts, "folders": folders})

    return {
        "base_pdf_path": base,
        "generated_at": now.isoformat(timespec="seconds"),
        "totals": {**totals, "files": sum(totals.values()), "pending": totals[NOT_INDEXED] + totals[OCRED]},
        "categories": out_categories,
    }


def folder_snapshot(rel_dir: str) -> Dict[str, Any]:
    """Counts under one folder (recursive), for the discover phases to decide what to do next."""
    data = scan(only_dir=rel_dir)
    counts = _blank_counts()
    batch_pending, names, oldest = 0, [], None
    for cat in data["categories"]:
        for folder in cat["folders"]:
            for f in folder["files"]:
                counts[f["status"]] += 1
                if f["status"] in PENDING:
                    names.append(f["relative_path"])
                if f["status"] == NOT_INDEXED and f["batch"]:
                    batch_pending += 1
                    submitted = f["batch"]["submitted_at"]
                    if submitted and (oldest is None or submitted < oldest):
                        oldest = submitted
    return {
        "counts": counts,
        "pending": counts[NOT_INDEXED] + counts[OCRED],
        "not_indexed": counts[NOT_INDEXED],   # OCR not finished
        "batch_pending": batch_pending,       # of those, how many are waiting on an LLM batch job
        "oldest_batch_submitted_at": oldest,
        "pending_files": names,
    }
