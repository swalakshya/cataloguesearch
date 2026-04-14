"""SQLite persistence for load test runs and per-query results."""
import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _db_path() -> str:
    path = os.environ.get("LOAD_TEST_DB_PATH", "~/cataloguesearch/load_test.db")
    return os.path.expanduser(path)


def _connect() -> sqlite3.Connection:
    path = _db_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")   # concurrent readers + writer
    conn.execute("PRAGMA busy_timeout=5000")  # retry for 5s before raising
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS load_test_runs (
                id               TEXT PRIMARY KEY,
                name             TEXT NOT NULL DEFAULT '',
                config           TEXT NOT NULL,
                query_file       TEXT NOT NULL DEFAULT '',
                status           TEXT NOT NULL DEFAULT 'running',
                started_at       TEXT NOT NULL,
                finished_at      TEXT,
                aggregate_stats  TEXT,
                pre_test_config  TEXT
            )
        """)
        # Tracks whether the load test left the search API config dirty.
        # Survives eval server restarts — UI reads this to show the warning banner.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS load_test_state (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS load_test_query_results (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id           TEXT NOT NULL REFERENCES load_test_runs(id),
                query_id         TEXT,
                query            TEXT NOT NULL,
                query_type       TEXT NOT NULL,
                ttfb_ms          REAL,
                total_latency_ms REAL,
                is_warmup        INTEGER NOT NULL DEFAULT 0,
                status           TEXT NOT NULL DEFAULT 'ok',
                error_message    TEXT,
                timestamp        TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_qr_run_id ON load_test_query_results(run_id)")
        # Migrations: add columns that may be missing from older DBs
        existing = {row[1] for row in conn.execute("PRAGMA table_info(load_test_runs)")}
        if "pre_test_config" not in existing:
            conn.execute("ALTER TABLE load_test_runs ADD COLUMN pre_test_config TEXT")
        existing_qr = {row[1] for row in conn.execute("PRAGMA table_info(load_test_query_results)")}
        if "query_id" not in existing_qr:
            conn.execute("ALTER TABLE load_test_query_results ADD COLUMN query_id TEXT")
        # Clean up runs that were left in 'running' state by a previous server crash
        conn.execute(
            "UPDATE load_test_runs SET status='interrupted', finished_at=? WHERE status='running'",
            (datetime.now(timezone.utc).isoformat(),),
        )
        conn.commit()


def set_state(key: str, value: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO load_test_state (key, value) VALUES (?, ?)",
            (key, value),
        )
        conn.commit()


def get_state(key: str) -> Optional[str]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT value FROM load_test_state WHERE key=?", (key,)
        ).fetchone()
    return row["value"] if row else None


def clear_state(key: str) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM load_test_state WHERE key=?", (key,))
        conn.commit()


def insert_run(run_id: str, name: str, config: Dict[str, Any], query_file: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO load_test_runs (id, name, config, query_file, status, started_at) VALUES (?,?,?,?,?,?)",
            (run_id, name, json.dumps(config), query_file, "running",
             datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()


def save_pre_test_config(run_id: str, effective: Dict[str, Any]) -> None:
    """Snapshot the search API's effective config before the test modifies it."""
    with _connect() as conn:
        conn.execute(
            "UPDATE load_test_runs SET pre_test_config=? WHERE id=?",
            (json.dumps(effective), run_id),
        )
        conn.commit()


def update_run(run_id: str, status: str, aggregate_stats: Optional[Dict] = None) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE load_test_runs SET status=?, finished_at=?, aggregate_stats=? WHERE id=?",
            (status, datetime.now(timezone.utc).isoformat(),
             json.dumps(aggregate_stats) if aggregate_stats else None, run_id),
        )
        conn.commit()


def insert_query_result(
    run_id: str,
    query: str,
    query_type: str,
    ttfb_ms: Optional[float],
    total_latency_ms: Optional[float],
    is_warmup: bool,
    status: str,
    error_message: Optional[str] = None,
    query_id: Optional[str] = None,
) -> None:
    with _connect() as conn:
        conn.execute(
            """INSERT INTO load_test_query_results
               (run_id, query_id, query, query_type, ttfb_ms, total_latency_ms, is_warmup, status, error_message, timestamp)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (run_id, query_id, query, query_type, ttfb_ms, total_latency_ms,
             1 if is_warmup else 0, status, error_message,
             datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()


def list_runs() -> List[Dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, name, config, status, started_at, finished_at FROM load_test_runs ORDER BY started_at DESC"
        ).fetchall()
    result = []
    for r in rows:
        cfg = json.loads(r["config"])
        result.append({
            "id": r["id"],
            "name": r["name"],
            "status": r["status"],
            "started_at": r["started_at"],
            "finished_at": r["finished_at"],
            "query_type": cfg.get("query_type", ""),
            "duration_seconds": cfg.get("duration_seconds", 0),
            "max_concurrent": cfg.get("max_concurrent", 0),
        })
    return result


def get_run(run_id: str) -> Optional[Dict]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM load_test_runs WHERE id=?", (run_id,)
        ).fetchone()
        if not row:
            return None
        query_rows = conn.execute(
            """SELECT query, query_type, ttfb_ms, total_latency_ms, is_warmup, status, error_message, timestamp
               FROM load_test_query_results WHERE run_id=? AND is_warmup=0 ORDER BY id""",
            (run_id,)
        ).fetchall()
    return {
        "id": row["id"],
        "name": row["name"],
        "config": json.loads(row["config"]),
        "query_file": row["query_file"],
        "status": row["status"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "aggregate_stats": json.loads(row["aggregate_stats"]) if row["aggregate_stats"] else None,
        "query_results": [dict(q) for q in query_rows],
    }
