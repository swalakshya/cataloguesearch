"""SQLite-backed store for search metrics."""
import os
import sqlite3
from datetime import datetime, time as dt_time
from typing import Any, Dict, List, Optional

_TIMESTAMP_FORMAT = "%Y-%m-%d %H:%M:%S"
_DATE_FORMAT = "%Y-%m-%d"

_LANG_NORMALIZE: Dict[str, str] = {"hindi": "hi", "gujarati": "gu"}


def normalize_language(lang: str) -> str:
    s = str(lang or "").lower().strip()
    return _LANG_NORMALIZE.get(s, s)


class MetricsStore:
    def __init__(self, db_path: str):
        self.db_path = str(db_path)
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA synchronous = NORMAL")
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS search_metrics (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at      INTEGER NOT NULL,
                source          TEXT,
                query_id        TEXT,
                chat_request_id TEXT,
                query           TEXT,
                search_mode     TEXT,
                reranked        INTEGER,
                language        TEXT,
                categories      TEXT,
                page_size       INTEGER,
                page            INTEGER,
                latency_ms      REAL,
                ttfb_ms         REAL,
                total_hits      INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_sm_created_at
                ON search_metrics(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_sm_source
                ON search_metrics(source);
            CREATE INDEX IF NOT EXISTS idx_sm_language
                ON search_metrics(language);
            CREATE INDEX IF NOT EXISTS idx_sm_chat_request_id
                ON search_metrics(chat_request_id);
        """)
        self._conn.commit()

    def insert(self, record: Dict[str, Any]) -> None:
        self._conn.execute(
            """
            INSERT INTO search_metrics
              (created_at, source, query_id, chat_request_id, query, search_mode,
               reranked, language, categories, page_size, page, latency_ms, ttfb_ms, total_hits)
            VALUES
              (:created_at, :source, :query_id, :chat_request_id, :query, :search_mode,
               :reranked, :language, :categories, :page_size, :page, :latency_ms, :ttfb_ms, :total_hits)
            """,
            record,
        )
        self._conn.commit()

    def distinct_sources(self) -> List[str]:
        rows = self._conn.execute(
            "SELECT DISTINCT source FROM search_metrics WHERE source IS NOT NULL ORDER BY source"
        ).fetchall()
        return [r[0] for r in rows]

    def query(
        self,
        *,
        start_epoch_ms: Optional[int] = None,
        end_epoch_ms: Optional[int] = None,
        sources: Optional[set] = None,
        language: Optional[str] = None,
        min_hits: Optional[int] = None,
        max_hits: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        where: List[str] = []
        params: List[Any] = []

        if start_epoch_ms is not None:
            where.append("created_at >= ?")
            params.append(start_epoch_ms)
        if end_epoch_ms is not None:
            where.append("created_at <= ?")
            params.append(end_epoch_ms)
        if sources:
            placeholders = ",".join("?" * len(sources))
            where.append(f"source IN ({placeholders})")
            params.extend(sources)
        if language:
            where.append("language = ?")
            params.append(language)
        if min_hits is not None:
            where.append("total_hits >= ?")
            params.append(min_hits)
        if max_hits is not None:
            where.append("total_hits <= ?")
            params.append(max_hits)

        sql = "SELECT * FROM search_metrics"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY created_at ASC"

        rows = self._conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def close(self) -> None:
        self._conn.close()


def date_to_epoch_ms(date_obj, *, end_of_day: bool = False) -> int:
    """Convert a date object to epoch milliseconds (local time)."""
    t = dt_time.max if end_of_day else dt_time.min
    return int(datetime.combine(date_obj, t).timestamp() * 1000)


def epoch_ms_to_timestamp(epoch_ms: int) -> str:
    return datetime.fromtimestamp(epoch_ms / 1000).strftime(_TIMESTAMP_FORMAT)


def epoch_ms_to_date(epoch_ms: int) -> str:
    return datetime.fromtimestamp(epoch_ms / 1000).strftime(_DATE_FORMAT)
