"""Unit tests for MetricsStore, helper functions, analytics._stats, and migration."""
import os
import sqlite3
import sys
from datetime import date, datetime
from pathlib import Path

import pytest

from backend.api.admin.metrics_store import (
    MetricsStore,
    date_to_epoch_ms,
    epoch_ms_to_date,
    epoch_ms_to_timestamp,
    normalize_language,
)
from backend.api.admin.analytics import _stats

# scripts/ has no __init__.py — load via path insertion
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))
from migrate_metrics_log import migrate  # noqa: E402


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_BASE = {
    "source": "swalakshya.me",
    "query_id": "qid-001",
    "chat_request_id": None,
    "query": "जल संरक्षण",
    "search_mode": "vector",
    "reranked": 1,
    "language": "hi",
    "categories": "['Granth']",
    "page_size": 10,
    "page": 1,
    "latency_ms": 120.5,
    "ttfb_ms": 45.0,
    "total_hits": 7,
}


def _row(**overrides):
    r = dict(_BASE)
    r.update(overrides)
    return r


@pytest.fixture
def store():
    s = MetricsStore(":memory:")
    yield s
    s.close()


# ---------------------------------------------------------------------------
# Group 1: Store basics
# ---------------------------------------------------------------------------

def test_query_empty_store(store):
    assert store.query() == []


def test_distinct_sources_empty(store):
    assert store.distinct_sources() == []


def test_insert_and_query_no_filter(store):
    ts = 1_745_000_000_000
    store.insert(_row(created_at=ts))
    rows = store.query()
    assert len(rows) == 1
    r = rows[0]
    assert r["source"] == "swalakshya.me"
    assert r["query_id"] == "qid-001"
    assert r["chat_request_id"] is None
    assert r["latency_ms"] == pytest.approx(120.5)
    assert r["total_hits"] == 7
    assert r["created_at"] == ts


def test_insert_multiple_ordered_by_created_at(store):
    # Insert out of order; query must return ASC by created_at
    store.insert(_row(created_at=3_000_000, query="c"))
    store.insert(_row(created_at=1_000_000, query="a"))
    store.insert(_row(created_at=2_000_000, query="b"))
    rows = store.query()
    assert [r["query"] for r in rows] == ["a", "b", "c"]


# ---------------------------------------------------------------------------
# Group 2: Filters
# ---------------------------------------------------------------------------

_JAN01 = int(datetime(2026, 1,  1,  0, 0, 0).timestamp() * 1000)
_JAN15 = int(datetime(2026, 1, 15,  0, 0, 0).timestamp() * 1000)
_FEB01 = int(datetime(2026, 2,  1,  0, 0, 0).timestamp() * 1000)


def test_filter_by_date_range(store):
    store.insert(_row(created_at=_JAN01, query="jan1"))
    store.insert(_row(created_at=_JAN15, query="jan15"))
    store.insert(_row(created_at=_FEB01, query="feb1"))
    start = int(datetime(2026, 1, 10).timestamp() * 1000)
    end   = int(datetime(2026, 1, 20, 23, 59, 59).timestamp() * 1000)
    rows = store.query(start_epoch_ms=start, end_epoch_ms=end)
    assert len(rows) == 1
    assert rows[0]["query"] == "jan15"


def test_filter_start_only(store):
    store.insert(_row(created_at=_JAN01, query="jan1"))
    store.insert(_row(created_at=_JAN15, query="jan15"))
    store.insert(_row(created_at=_FEB01, query="feb1"))
    start = int(datetime(2026, 1, 10).timestamp() * 1000)
    rows = store.query(start_epoch_ms=start)
    assert {r["query"] for r in rows} == {"jan15", "feb1"}


def test_filter_end_only(store):
    store.insert(_row(created_at=_JAN01, query="jan1"))
    store.insert(_row(created_at=_JAN15, query="jan15"))
    store.insert(_row(created_at=_FEB01, query="feb1"))
    end = int(datetime(2026, 1, 20, 23, 59, 59).timestamp() * 1000)
    rows = store.query(end_epoch_ms=end)
    assert {r["query"] for r in rows} == {"jan1", "jan15"}


def test_filter_by_source(store):
    store.insert(_row(created_at=1000, source="agent"))
    store.insert(_row(created_at=2000, source="swalakshya.me"))
    rows = store.query(sources={"agent"})
    assert len(rows) == 1
    assert rows[0]["source"] == "agent"


def test_filter_by_language(store):
    store.insert(_row(created_at=1000, language="hi"))
    store.insert(_row(created_at=2000, language="gu"))
    rows = store.query(language="hi")
    assert len(rows) == 1
    assert rows[0]["language"] == "hi"


def test_filter_min_max_hits(store):
    store.insert(_row(created_at=1000, total_hits=0))
    store.insert(_row(created_at=2000, total_hits=5))
    store.insert(_row(created_at=3000, total_hits=10))
    rows = store.query(min_hits=5, max_hits=9)
    assert len(rows) == 1
    assert rows[0]["total_hits"] == 5


# ---------------------------------------------------------------------------
# Group 3: distinct_sources
# ---------------------------------------------------------------------------

def test_distinct_sources_deduped(store):
    for src in ["agent", "swalakshya.me", "agent", "chat"]:
        store.insert(_row(created_at=1000, source=src))
    assert store.distinct_sources() == ["agent", "chat", "swalakshya.me"]


def test_distinct_sources_ignores_null(store):
    store.insert(_row(created_at=1000, source=None))
    assert store.distinct_sources() == []


# ---------------------------------------------------------------------------
# Group 4: chat_request_id
# ---------------------------------------------------------------------------

def test_chat_request_id_stored_and_retrieved(store):
    store.insert(_row(created_at=1000, chat_request_id="req-abc-123"))
    rows = store.query()
    assert rows[0]["chat_request_id"] == "req-abc-123"


def test_chat_request_id_null_for_direct_search(store):
    store.insert(_row(created_at=1000, chat_request_id=None))
    rows = store.query()
    assert rows[0]["chat_request_id"] is None  # not the string "None"


# ---------------------------------------------------------------------------
# Group 5: helper functions (no fixture)
# ---------------------------------------------------------------------------

def test_normalize_language_passthrough():
    assert normalize_language("hi") == "hi"
    assert normalize_language("gu") == "gu"


def test_normalize_language_long_forms():
    assert normalize_language("hindi") == "hi"
    assert normalize_language("gujarati") == "gu"


def test_normalize_language_case_insensitive():
    assert normalize_language("Hindi") == "hi"
    assert normalize_language("GUJARATI") == "gu"


def test_date_to_epoch_ms_start_of_day():
    d = date(2026, 4, 1)
    epoch = date_to_epoch_ms(d)
    ts = epoch_ms_to_timestamp(epoch)
    assert ts.startswith("2026-04-01 00:00:00")


def test_date_to_epoch_ms_end_of_day():
    d = date(2026, 4, 1)
    epoch = date_to_epoch_ms(d, end_of_day=True)
    ts = epoch_ms_to_timestamp(epoch)
    assert ts.startswith("2026-04-01 23:59:59")


def test_epoch_ms_to_date():
    epoch = int(datetime(2026, 4, 15, 14, 30, 0).timestamp() * 1000)
    assert epoch_ms_to_date(epoch) == "2026-04-15"


# ---------------------------------------------------------------------------
# Group 6: migration (uses tmp_path — file-based DB needed here)
# ---------------------------------------------------------------------------

# 14-column CSV rows matching the v2 schema:
# timestamp, source, query_id, client_ip, query, search_mode, reranked,
# language, categories, page_size, page, latency_ms, ttfb_ms, total_hits
_CSV_VALID_A = (
    "2026-04-01 10:00:00,swalakshya.me,qid-1,1.2.3.4,"
    "जल संरक्षण,vector,True,hindi,['Granth'],10,1,123.4,45.6,7"
)
_CSV_VALID_B = (
    "2026-04-02 11:00:00,agent,qid-2,5.6.7.8,"
    "प्रकाश,lexical,False,hi,['Pravachan'],5,1,80.0,-,3"
)
_CSV_BAD_COLS = "2026-04-03,too,few,columns"
_CSV_BAD_LATENCY = (
    "2026-04-03 09:00:00,web,qid-3,0.0.0.0,"
    "test,vector,False,hi,['Granth'],10,1,NOT_A_NUMBER,-,0"
)


def test_migrate_valid_csv(tmp_path):
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    db_path = str(tmp_path / "metrics.db")
    (logs_dir / "metrics.log").write_text(
        "\n".join([_CSV_VALID_A, _CSV_VALID_B]) + "\n",
        encoding="utf-8",
    )

    migrate(str(logs_dir), db_path)

    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT source, language, chat_request_id FROM search_metrics ORDER BY created_at"
    ).fetchall()
    conn.close()

    assert len(rows) == 2
    # "hindi" is normalised to "hi" by migrate; chat_request_id is always NULL
    assert rows[0] == ("swalakshya.me", "hi", None)
    assert rows[1] == ("agent", "hi", None)


def test_migrate_skips_bad_rows(tmp_path):
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    db_path = str(tmp_path / "metrics.db")
    (logs_dir / "metrics.log").write_text(
        "\n".join([_CSV_VALID_A, _CSV_BAD_COLS, _CSV_BAD_LATENCY]) + "\n",
        encoding="utf-8",
    )

    migrate(str(logs_dir), db_path)

    conn = sqlite3.connect(db_path)
    count = conn.execute("SELECT COUNT(*) FROM search_metrics").fetchone()[0]
    conn.close()
    assert count == 1  # only the one valid row


def test_migrate_no_log_files(tmp_path):
    logs_dir = tmp_path / "empty"
    logs_dir.mkdir()
    db_path = str(tmp_path / "metrics.db")
    # Should not raise — just produce an empty DB
    migrate(str(logs_dir), db_path)
    conn = sqlite3.connect(db_path)
    count = conn.execute("SELECT COUNT(*) FROM search_metrics").fetchone()[0]
    conn.close()
    assert count == 0


# ---------------------------------------------------------------------------
# Group 7: _stats (pure function, no fixture)
# ---------------------------------------------------------------------------

def test_stats_empty_list():
    assert _stats([]) is None


def test_stats_single_value():
    result = _stats([42.0])
    assert result["avg"] == pytest.approx(42.0)
    assert result["p50"] == pytest.approx(42.0)
    assert result["p95"] == pytest.approx(42.0)
    assert result["p99"] == pytest.approx(42.0)


def test_stats_percentiles():
    # 100 evenly spaced values [1..100]; percentile positions use 0-based indexing.
    # p(pct) = s[int(n * pct / 100)], so:
    #   p50 = s[50] = 51.0,  p95 = s[95] = 96.0,  p99 = s[99] = 100.0
    vals = [float(v) for v in range(1, 101)]
    result = _stats(vals)
    assert result["avg"] == pytest.approx(50.5)
    assert result["p50"] == pytest.approx(51.0)
    assert result["p95"] == pytest.approx(96.0)
    assert result["p99"] == pytest.approx(100.0)
