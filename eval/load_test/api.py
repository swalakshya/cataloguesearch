"""FastAPI router for load test endpoints. Mounted at /api/eval/load-test."""
import asyncio
import hashlib
import json
import logging
import os
import uuid
from typing import Any, Dict, Optional

import aiohttp
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from eval.load_test import db, queries
from eval.load_test.runner import LoadTestConfig, LoadTestRunner, _ADMIN_AUTH_PATH, _ADMIN_CONFIG_PATH

log = logging.getLogger(__name__)

router = APIRouter(prefix="/eval/load-test", tags=["load-test"])

# Module-level state — single run at a time
_state: Dict[str, Any] = {
    "running": False,
    "runner": None,
    "task": None,
}


# ------------------------------------------------------------------
# Request / Response models
# ------------------------------------------------------------------

class StartRequest(BaseModel):
    base_api_url: str = Field("http://localhost:8000")
    duration_seconds: int = Field(60, ge=10, le=3600)
    warmup_seconds: int = Field(15, ge=0, le=300)
    max_concurrent: int = Field(10, ge=1, le=100)
    query_type: str = Field("rrf", pattern="^(lexical|rrf|mixed)$")
    page_size: int = Field(20, ge=1, le=100)
    rerank_batch_size: int = Field(4, ge=1, le=32)
    rerank_block_size: int = Field(1500, ge=64, le=2048)
    recall_size: int = Field(40, ge=1, le=200)
    request_timeout_seconds: int = Field(30, ge=5, le=300)
    run_name: str = Field("")


# ------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------

@router.post("/start")
async def start(
    config_json: str = Form(...),
    query_file: Optional[UploadFile] = File(None),
):
    if _state["running"]:
        raise HTTPException(status_code=409, detail="A load test is already running")

    # Parse config
    try:
        raw = json.loads(config_json)
        req = StartRequest(**raw)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    if req.warmup_seconds >= req.duration_seconds:
        raise HTTPException(
            status_code=422,
            detail=f"warmup_seconds ({req.warmup_seconds}) must be less than duration_seconds ({req.duration_seconds})",
        )

    # Load / validate query data
    query_file_path = ""
    if query_file:
        content = await query_file.read()
        try:
            query_data = json.loads(content)
            queries.validate(query_data)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Invalid query file: {exc}")
        query_file_path = query_file.filename or "uploaded"
    else:
        try:
            query_data = queries.load_queries()
            query_file_path = "default_queries.json"
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to load default queries: {exc}")

    cfg = LoadTestConfig(
        base_api_url=req.base_api_url,
        duration_seconds=req.duration_seconds,
        warmup_seconds=req.warmup_seconds,
        max_concurrent=req.max_concurrent,
        query_type=req.query_type,
        page_size=req.page_size,
        rerank_batch_size=req.rerank_batch_size,
        rerank_block_size=req.rerank_block_size,
        recall_size=req.recall_size,
        request_timeout_seconds=req.request_timeout_seconds,
        run_name=req.run_name,
        query_file=query_file_path,
    )

    run_id = str(uuid.uuid4())
    db.insert_run(run_id, req.run_name, cfg.to_dict(), query_file_path)

    runner = LoadTestRunner(cfg, run_id)
    _state["running"] = True
    _state["runner"] = runner

    async def _run_and_cleanup():
        try:
            await runner.run(query_data)
        except Exception as exc:
            log.exception("Load test run failed unexpectedly: %s", exc)
            try:
                db.update_run(run_id, "failed", None)
            except Exception:
                pass
        finally:
            _state["running"] = False
            _state["runner"] = None
            _state["task"] = None

    _state["task"] = asyncio.create_task(_run_and_cleanup())
    log.info("Load test started: run_id=%s", run_id)
    return {"run_id": run_id, "status": "started"}


@router.post("/stop")
async def stop():
    runner: Optional[LoadTestRunner] = _state.get("runner")
    if not runner:
        raise HTTPException(status_code=404, detail="No load test is currently running")
    runner.abort()
    return {"status": "stopping"}


@router.get("/status")
async def status():
    """SSE stream — sends a snapshot immediately, then every 15 s, final event on completion."""

    async def _generate():
        runner: Optional[LoadTestRunner] = _state.get("runner")
        if not runner:
            yield f"data: {json.dumps({'status': 'idle'})}\n\n"
            return

        while True:
            snap = runner.snapshot()
            yield f"data: {json.dumps(snap)}\n\n"
            if runner.is_done():
                break
            # Sleep up to 15s but wake immediately when runner finishes
            try:
                await asyncio.wait_for(runner._done.wait(), timeout=15)
            except asyncio.TimeoutError:
                pass

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/runs")
async def list_runs():
    try:
        return db.list_runs()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    try:
        result = db.get_run(run_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    if not result:
        raise HTTPException(status_code=404, detail="Run not found")
    return result


# ------------------------------------------------------------------
# Config inspection + manual recovery
# ------------------------------------------------------------------

async def _get_admin_token(base_url: str) -> Optional[str]:
    admin_key = os.environ.get("ADMIN_KEY", "")
    if not admin_key:
        return None
    key_hash = hashlib.sha256(admin_key.encode()).hexdigest()
    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(
                base_url.rstrip("/") + _ADMIN_AUTH_PATH,
                json={"key_hash": key_hash},
            ) as resp:
                data = await resp.json()
                return data.get("token")
        except Exception:
            return None


@router.get("/admin-config")
async def get_admin_config(base_api_url: str = "http://localhost:8000"):
    """
    Fetch current effective admin config from the search API.
    Also returns dirty flag so the UI knows if a previous test left config modified.
    """
    dirty_raw = db.get_state("config_dirty")
    dirty_info = json.loads(dirty_raw) if dirty_raw else None

    token = await _get_admin_token(base_api_url)
    if not token:
        return {
            "effective": None,
            "dirty": dirty_info,
            "error": "Could not authenticate with search API (ADMIN_KEY missing or wrong)",
        }

    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(
                base_api_url.rstrip("/") + _ADMIN_CONFIG_PATH,
                headers={"Authorization": f"Bearer {token}"},
            ) as resp:
                if resp.status != 200:
                    raise HTTPException(status_code=resp.status, detail="Search API admin config fetch failed")
                data = await resp.json()
                return {"effective": data.get("effective"), "defaults": data.get("defaults"), "dirty": dirty_info}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Search API unreachable: {exc}")


@router.post("/reset-config")
async def reset_config(base_api_url: str = "http://localhost:8000"):
    """
    Restore search API admin config to defaults. No auth required on the eval side —
    credentials are read from ADMIN_KEY env var.
    Use this if a load test was interrupted and left config in a modified state.
    """
    token = await _get_admin_token(base_api_url)
    if not token:
        raise HTTPException(status_code=401, detail="Could not authenticate with search API (ADMIN_KEY missing or wrong)")

    async with aiohttp.ClientSession() as session:
        try:
            async with session.delete(
                base_api_url.rstrip("/") + _ADMIN_CONFIG_PATH,
                headers={"Authorization": f"Bearer {token}"},
            ) as resp:
                if resp.status != 200:
                    raise HTTPException(status_code=resp.status, detail="Search API reset failed")
                db.clear_state("config_dirty")
                log.info("Admin config manually reset to defaults via /reset-config")
                return {"status": "ok", "message": "Search API config restored to defaults"}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Search API unreachable: {exc}")
