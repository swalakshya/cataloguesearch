#!/usr/bin/env python3
"""One-time migration: metrics.log* CSV files → SQLite metrics.db

Usage:
    python scripts/migrate_metrics_log.py [--logs-dir logs] [--db-path logs/metrics.db]

Safe to run from the repo root. Existing rows in the DB are not deduplicated,
so run only once (or delete the DB and re-run if needed).
"""
import argparse
import glob as _glob
import os
import sys
from datetime import datetime

# Allow running from repo root without installing the package.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.api.admin.metrics_store import MetricsStore, normalize_language  # noqa: E402

_NUM_COLS = 14
_TIMESTAMP_FORMAT = "%Y-%m-%d %H:%M:%S"


def migrate(logs_dir: str, db_path: str) -> None:
    pattern = os.path.join(logs_dir, "metrics.log*")
    paths = sorted(_glob.glob(pattern))

    store = MetricsStore(db_path)
    if not paths:
        print(f"No metrics.log* files found in {logs_dir!r}. Nothing to do.")
        store.close()
        return
    inserted = 0
    skipped = 0

    for path in paths:
        print(f"  Reading {path} ...", end=" ", flush=True)
        file_inserted = 0
        file_skipped = 0
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    parts = line.rstrip("\n").split(",", _NUM_COLS - 1)
                    if len(parts) != _NUM_COLS:
                        file_skipped += 1
                        continue
                    (ts, source, query_id, _client_ip, query, search_mode,
                     reranked, language, categories, page_size, page,
                     latency_ms, ttfb_ms, total_hits) = parts
                    try:
                        float(latency_ms)
                    except ValueError:
                        file_skipped += 1
                        continue
                    try:
                        dt = datetime.strptime(ts.strip(), _TIMESTAMP_FORMAT)
                        store.insert({
                            "created_at": int(dt.timestamp() * 1000),
                            "source": source or None,
                            "query_id": query_id or None,
                            "chat_request_id": None,
                            "query": query,
                            "search_mode": search_mode,
                            "reranked": 1 if reranked.strip() == "True" else 0,
                            "language": normalize_language(language.strip()),
                            "categories": categories,
                            "page_size": int(page_size),
                            "page": int(page),
                            "latency_ms": float(latency_ms),
                            "ttfb_ms": None if ttfb_ms.strip() == "-" else float(ttfb_ms),
                            "total_hits": int(total_hits.strip()),
                        })
                        file_inserted += 1
                    except (ValueError, TypeError):
                        file_skipped += 1
        except OSError as exc:
            print(f"SKIP (cannot read: {exc})")
            continue
        print(f"inserted={file_inserted} skipped={file_skipped}")
        inserted += file_inserted
        skipped += file_skipped

    store.close()
    print(f"\nDone. Total inserted: {inserted}, skipped: {skipped}")
    print(f"DB written to: {os.path.abspath(db_path)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate metrics.log* CSV files to SQLite")
    parser.add_argument("--logs-dir", default="logs", help="Directory containing metrics.log* files (default: logs)")
    parser.add_argument("--db-path", default=None, help="Output SQLite DB path (default: <logs-dir>/metrics.db)")
    args = parser.parse_args()

    db_path = args.db_path or os.path.join(args.logs_dir, "metrics.db")
    print(f"Migrating {args.logs_dir}/metrics.log* → {db_path}")
    migrate(args.logs_dir, db_path)


if __name__ == "__main__":
    main()
