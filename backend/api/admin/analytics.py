"""Analytics API — query metrics from SQLite."""
import logging
from collections import defaultdict
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request

from backend.api.admin.admin_api import _require_auth
from backend.api.admin.metrics_store import (
    date_to_epoch_ms,
    epoch_ms_to_date,
    epoch_ms_to_timestamp,
    normalize_language,
)

log_handle = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])

_DATE_FORMAT = "%Y-%m-%d"


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


@router.get("/admin/analytics")
async def get_analytics(
    request: Request,
    authorization: Optional[str] = Header(None),
    from_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD (inclusive)"),
    to_date: Optional[str] = Query(None, description="End date YYYY-MM-DD (inclusive)"),
    source: Optional[str] = Query(None, description="Comma-separated sources to include (omit for all)"),
    language: Optional[str] = Query(None, description="Filter by language code, e.g. 'hi' or 'gu' (omit for all)"),
    min_hits: Optional[int] = Query(None, description="Minimum total_hits (inclusive)"),
    max_hits: Optional[int] = Query(None, description="Maximum total_hits (inclusive)"),
):
    """
    Return query metrics aggregated from SQLite.
    Supports date-range, source, and language filtering.
    Returns `sources` — all distinct source values seen (unfiltered).
    """
    _require_auth(authorization)

    selected_sources = {s.strip() for s in source.split(",") if s.strip()} if source else set()

    start_date = _parse_date(from_date, "from_date")
    end_date = _parse_date(to_date, "to_date")
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="from_date must be <= to_date")

    metrics_store = request.app.state.metrics_store

    all_sources = metrics_store.distinct_sources()

    rows = metrics_store.query(
        start_epoch_ms=date_to_epoch_ms(start_date) if start_date else None,
        end_epoch_ms=date_to_epoch_ms(end_date, end_of_day=True) if end_date else None,
        sources=selected_sources if selected_sources else None,
        language=normalize_language(language) if language else None,
        min_hits=min_hits,
        max_hits=max_hits,
    )

    latencies = [r["latency_ms"] for r in rows if r["latency_ms"] is not None]
    ttfbs = [r["ttfb_ms"] for r in rows if r["ttfb_ms"] is not None]

    by_day: Dict[str, dict] = defaultdict(lambda: {"count": 0, "latencies": []})
    for r in rows:
        day = epoch_ms_to_date(r["created_at"])
        by_day[day]["count"] += 1
        if r["latency_ms"] is not None:
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
    serialized = [
        {
            "timestamp": epoch_ms_to_timestamp(r["created_at"]),
            "source": r["source"],
            "query_id": r["query_id"],
            "chat_request_id": r["chat_request_id"],
            "query": r["query"],
            "search_mode": r["search_mode"],
            "reranked": bool(r["reranked"]),
            "language": r["language"],
            "categories": r["categories"],
            "page_size": r["page_size"],
            "page": r["page"],
            "latency_ms": r["latency_ms"],
            "ttfb_ms": r["ttfb_ms"],
            "total_hits": r["total_hits"],
        }
        for r in rows
    ]

    return {
        "total": len(serialized),
        "sources": all_sources,
        "latency": _stats(latencies),
        "ttfb": _stats(ttfbs),
        "by_day": by_day_list,
        "queries": serialized[-_QUERY_CAP:],
    }
