"""Endpoints shared by every job kind (deploy, discover): list, inspect, cancel, tail logs."""
import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from deploy import db
from deploy.runner import log_path, runner

router = APIRouter(prefix="/jobs", tags=["jobs"])

_MAX_LOG_CHUNK = 256 * 1024


@router.get("/runs")
async def list_runs(kind: Optional[str] = None, limit: int = Query(30, ge=1, le=100)):
    return {"runs": await asyncio.to_thread(db.list_runs, limit, kind), "active_run_id": runner.active_run_id()}


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    run = await asyncio.to_thread(db.get_run, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str):
    if not runner.cancel(run_id):
        raise HTTPException(409, "Run is not active")
    return {"ok": True}


@router.get("/runs/{run_id}/log")
async def get_log(run_id: str, step: str, offset: int = Query(0, ge=0)):
    """Complete lines of a step's log from byte `offset`. Poll with the returned `offset`."""
    run = await asyncio.to_thread(db.get_run, run_id)
    if not run or step not in {s["name"] for s in run["steps"]}:
        raise HTTPException(404, "Unknown run or step")
    path = log_path(run_id, step)
    if not path.exists():
        return {"text": "", "offset": offset}
    with open(path, "rb") as fh:
        fh.seek(offset)
        data = fh.read(_MAX_LOG_CHUNK)
    end = data.rfind(b"\n")
    if end < 0:
        return {"text": "", "offset": offset}
    data = data[:end + 1]
    return {"text": data.decode("utf-8", "replace"), "offset": offset + len(data)}
