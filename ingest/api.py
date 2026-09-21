"""FastAPI router for the Discover page. Mounted at /api/discover by dev.py."""
import asyncio
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from deploy import docker_health
from deploy.runner import Busy
from ingest import jobs, status

router = APIRouter(prefix="/discover", tags=["discover"])


class StartRequest(BaseModel):
    folders: Optional[List[str]] = None  # relative scan_config dirs; omit to run every folder with pending files
    mode: str = "index"                  # "ocr" (OCR only, to evaluate), "index" (OCR then index), "reindex"


class CleanupRequest(BaseModel):
    folder: str
    confirm: bool = False  # the UI asks for a typed confirmation; the server insists it was given


async def _require_docker() -> None:
    """Indexing and cleanup need OpenSearch, which runs in Docker: refuse while Docker is yellow or red."""
    try:
        await asyncio.to_thread(docker_health.require_healthy)
    except docker_health.DockerUnhealthy as exc:
        raise HTTPException(503, str(exc))


@router.get("/status")
async def get_status():
    try:
        return await asyncio.to_thread(status.scan)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))


@router.post("/runs", status_code=202)
async def start_run(req: StartRequest):
    if req.mode in ("index", "reindex"):   # OCR alone does not touch OpenSearch
        await _require_docker()
    try:
        run_id = await asyncio.to_thread(jobs.start_discover, req.folders, req.mode)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Busy as busy:
        raise HTTPException(409, f"Run {busy} is already in progress")
    return {"run_id": run_id}


@router.post("/cleanup", status_code=202)
async def start_cleanup(req: CleanupRequest):
    if not req.confirm:
        raise HTTPException(422, "Cleanup deletes the folder's OpenSearch documents and index state; confirm=true is required")
    await _require_docker()
    try:
        run_id = await asyncio.to_thread(jobs.start_cleanup, req.folder)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Busy as busy:
        raise HTTPException(409, f"Run {busy} is already in progress")
    return {"run_id": run_id}
