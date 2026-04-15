"""Analytics API — query metrics from metrics.log."""
import asyncio
import glob as _glob
import logging
import os
from collections import defaultdict
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Query

from backend.api.admin.admin_api import _require_auth

log_handle = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])

# ---------------------------------------------------------------------------
# Metrics log parsing
# ---------------------------------------------------------------------------

# Expected number of CSV columns in the v2 metrics schema:
# timestamp, source, query_id, client_ip, query, search_mode, reranked,
# language, categories, page_size, page, latency_ms, ttfb_ms, total_hits
_NUM_COLS = 14
_TIMESTAMP_FORMAT = "%Y-%m-%d %H:%M:%S"
_DATE_FORMAT = "%Y-%m-%d"


def _parse_metrics(logs_dir: str) -> List[dict]:
    """Read all metrics.log* files and return parsed rows (new schema only)."""
    rows = []
    pattern = os.path.join(logs_dir, "metrics.log*")
    for path in sorted(_glob.glob(pattern)):
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    parts = line.rstrip("\n").split(",", _NUM_COLS - 1)
                    if len(parts) != _NUM_COLS:
                        continue
                    (ts, source, query_id, _client_ip, query, search_mode,
                     reranked, language, categories, page_size, page,
                     latency_ms, ttfb_ms, total_hits) = parts
                    if source not in ("search", "agent"):
                        continue  # skip old-format lines
                    try:
                        rows.append({
                            "timestamp": ts,
                            "source": source,
                            "query_id": query_id,
                            "query": query,
                            "search_mode": search_mode,
                            "reranked": reranked == "True",
                            "language": language,
                            "categories": categories,
                            "page_size": int(page_size),
                            "page": int(page),
                            "latency_ms": float(latency_ms),
                            "ttfb_ms": None if ttfb_ms.strip() == "-" else float(ttfb_ms),
                            "total_hits": int(total_hits.strip()),
                        })
                    except (ValueError, TypeError):
                        continue
        except OSError:
            continue
    return rows


def _stats(vals: List[float]) -> Optional[Dict]:
    if not vals:
        return None
    s = sorted(vals)
    n = len(s)

    def p(pct):
        return round(s[min(int(n * pct / 100), n - 1)], 1)

    return {
        "avg": round(sum(s) / n, 1),
        "p50": p(50),
        "p95": p(95),
        "p99": p(99),
    }


def _parse_date(value: Optional[str], field_name: str):
    if value is None:
        return None
    try:
        return datetime.strptime(value, _DATE_FORMAT).date()
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be in YYYY-MM-DD format",
        ) from exc


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/admin/analytics")
async def get_analytics(
    authorization: Optional[str] = Header(None),
    from_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD (inclusive)"),
    to_date: Optional[str] = Query(None, description="End date YYYY-MM-DD (inclusive)"),
    source: Optional[str] = Query(None, description="Filter: search | agent (omit for all)"),
):
    """
    Return query metrics aggregated from metrics.log.
    Supports date-range and source filtering.
    """
    _require_auth(authorization)

    if source and source not in ("search", "agent"):
        raise HTTPException(status_code=400, detail="source must be 'search' or 'agent'")

    start_date = _parse_date(from_date, "from_date")
    end_date = _parse_date(to_date, "to_date")
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="from_date must be <= to_date")

    logs_dir = os.environ.get("LOGS_DIR", "logs")
    all_rows = await asyncio.to_thread(_parse_metrics, logs_dir)

    # Apply filters
    rows = []
    for r in all_rows:
        try:
            row_date = datetime.strptime(r["timestamp"], _TIMESTAMP_FORMAT).date()
        except ValueError:
            continue
        if start_date and row_date < start_date:
            continue
        if end_date and row_date > end_date:
            continue
        if source and r["source"] != source:
            continue
        rows.append(r)

    # Aggregate
    latencies = [r["latency_ms"] for r in rows]
    ttfbs = [r["ttfb_ms"] for r in rows if r["ttfb_ms"] is not None]

    by_day: Dict[str, dict] = defaultdict(lambda: {"count": 0, "latencies": []})
    for r in rows:
        day = r["timestamp"][:10]
        by_day[day]["count"] += 1
        by_day[day]["latencies"].append(r["latency_ms"])

    by_day_list = sorted(
        [
            {
                "date": day,
                "count": v["count"],
                **(_stats(v["latencies"]) or {}),
            }
            for day, v in by_day.items()
        ],
        key=lambda x: x["date"],
    )

    _QUERY_CAP = 5000
    return {
        "total": len(rows),
        "latency": _stats(latencies),
        "ttfb": _stats(ttfbs),
        "by_day": by_day_list,
        "queries": rows[-_QUERY_CAP:],  # most recent N chronologically (frontend re-sorts)
    }
