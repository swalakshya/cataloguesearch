"""SQLite persistence for deploy runs and their steps."""
import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from deploy import settings

_init_lock = threading.Lock()

RUN_ACTIVE = "running"
STEP_TERMINAL = ("succeeded", "failed", "cancelled", "skipped")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def _conn():
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.DATA_DIR / "deploy.db", timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with _init_lock:
        with _conn() as c:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    finished_at TEXT,
                    status TEXT NOT NULL,
                    label TEXT,
                    params TEXT NOT NULL DEFAULT '{}',
                    kind TEXT NOT NULL DEFAULT 'deploy'
                );
                CREATE TABLE IF NOT EXISTS steps (
                    run_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    exit_code INTEGER,
                    detail TEXT,
                    command TEXT,
                    pgid INTEGER,
                    pstart TEXT,
                    title TEXT,
                    progress TEXT,
                    PRIMARY KEY (run_id, name)
                );
                """
            )
            for table, additions in (
                ("steps", (("pgid", "INTEGER"), ("pstart", "TEXT"), ("title", "TEXT"), ("progress", "TEXT"))),
                ("runs", (("kind", "TEXT NOT NULL DEFAULT 'deploy'"),)),
            ):
                cols = {row[1] for row in c.execute(f"PRAGMA table_info({table})")}
                for col, typ in additions:
                    if col not in cols:
                        c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")


def orphan_candidates() -> List[Dict[str, Any]]:
    """Steps recorded as running: their process group may have outlived a server restart."""
    with _conn() as c:
        rows = c.execute(
            "SELECT run_id, name, pgid, pstart FROM steps WHERE status='running' AND pgid IS NOT NULL").fetchall()
        return [dict(r) for r in rows]


def mark_interrupted() -> None:
    """A server restart orphans any run that was mid-flight; close those runs out."""
    with _conn() as c:
        c.execute(
            "UPDATE steps SET status='cancelled', finished_at=?, detail='Server restarted while running' "
            "WHERE status='running'", (now(),))
        c.execute(
            "UPDATE steps SET status='skipped' WHERE status='pending' AND run_id IN "
            "(SELECT id FROM runs WHERE status='running')")
        c.execute(
            "UPDATE runs SET status='interrupted', finished_at=? WHERE status='running'", (now(),))


def create_run(run_id: str, kind: str, label: str, steps: List[Tuple[str, str]], params: Dict[str, Any]) -> None:
    """`steps` is a list of (name, title) in execution order."""
    with _conn() as c:
        c.execute("INSERT INTO runs (id, created_at, status, label, params, kind) VALUES (?,?,?,?,?,?)",
                  (run_id, now(), RUN_ACTIVE, label, json.dumps(params), kind))
        for pos, (name, title) in enumerate(steps):
            c.execute("INSERT INTO steps (run_id, name, position, status, title) VALUES (?,?,?,'pending',?)",
                      (run_id, name, pos, title))


def update_step(run_id: str, name: str, **fields: Any) -> None:
    if not fields:
        return
    cols = ", ".join(f"{k}=?" for k in fields)
    with _conn() as c:
        c.execute(f"UPDATE steps SET {cols} WHERE run_id=? AND name=?", (*fields.values(), run_id, name))


def finish_run(run_id: str, status: str) -> None:
    with _conn() as c:
        c.execute("UPDATE runs SET status=?, finished_at=? WHERE id=?", (status, now(), run_id))


def _typical_seconds(c: sqlite3.Connection, kind: str, name: str, cache: Dict[tuple, Optional[int]]) -> Optional[int]:
    """Median duration of the last few successful runs of this step: a hint, never shown as a percentage."""
    key = (kind, name)
    if key not in cache:
        rows = c.execute(
            "SELECT s.started_at, s.finished_at FROM steps s JOIN runs r ON r.id = s.run_id "
            "WHERE r.kind=? AND s.name=? AND s.status='succeeded' AND s.started_at IS NOT NULL "
            "AND s.finished_at IS NOT NULL ORDER BY s.finished_at DESC LIMIT 5", (kind, name)).fetchall()
        secs = sorted(
            int((datetime.fromisoformat(r["finished_at"]) - datetime.fromisoformat(r["started_at"])).total_seconds())
            for r in rows)
        cache[key] = secs[len(secs) // 2] if len(secs) >= 2 else None  # need 2+ samples to call it "usual"
    return cache[key]


def _run_row(row: sqlite3.Row, steps: List[sqlite3.Row], c: sqlite3.Connection,
             cache: Dict[tuple, Optional[int]]) -> Dict[str, Any]:
    d = dict(row)
    d["params"] = json.loads(d["params"] or "{}")
    d["steps"] = []
    for s in steps:
        step = dict(s)
        step["progress"] = json.loads(step["progress"]) if step.get("progress") else None
        step["typical_seconds"] = _typical_seconds(c, d["kind"], step["name"], cache)
        del step["pgid"], step["pstart"]
        d["steps"].append(step)
    return d


def get_run(run_id: str) -> Optional[Dict[str, Any]]:
    with _conn() as c:
        row = c.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            return None
        steps = c.execute("SELECT * FROM steps WHERE run_id=? ORDER BY position", (run_id,)).fetchall()
        return _run_row(row, steps, c, {})


def list_runs(limit: int = 30, kind: Optional[str] = None) -> List[Dict[str, Any]]:
    with _conn() as c:
        if kind:
            rows = c.execute("SELECT * FROM runs WHERE kind=? ORDER BY created_at DESC LIMIT ?",
                             (kind, limit)).fetchall()
        else:
            rows = c.execute("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        out, cache = [], {}
        for row in rows:
            steps = c.execute("SELECT * FROM steps WHERE run_id=? ORDER BY position", (row["id"],)).fetchall()
            out.append(_run_row(row, steps, c, cache))
        return out
