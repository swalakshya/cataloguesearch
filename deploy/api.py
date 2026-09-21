"""FastAPI router for the deploy page. Mounted at /api/deploy by dev.py."""
import asyncio
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deploy import checks, compare, docker_health, docker_restart, gc, settings
from deploy.actions import ACTION_ORDER, ACTION_TITLES, start_deploy
from deploy.runner import Busy, runner
from deploy import db

router = APIRouter(prefix="/deploy", tags=["deploy"])


class StartRunRequest(BaseModel):
    actions: List[str] = Field(..., min_length=1)
    build_services: Optional[List[str]] = None


@router.get("/config")
async def get_config():
    services = await asyncio.to_thread(checks.build_services)
    return {
        "actions": [{"id": a, "title": ACTION_TITLES[a]} for a in ACTION_ORDER],
        "build_services": services,
        "default_build_services": [s for s in settings.DEFAULT_BUILD_SERVICES if s in services],
        "prod_host": settings.PROD_HOST,
        "build_env_file": settings.BUILD_ENV_FILE,
    }


@router.get("/overview")
async def overview():
    opensearch, hub, tooling = await asyncio.gather(
        asyncio.to_thread(checks.local_opensearch),
        asyncio.to_thread(checks.dockerhub_tags),
        asyncio.to_thread(checks.local_tooling),
    )
    return {"opensearch": opensearch, "registry": hub, "tooling": tooling, "active_run_id": runner.active_run_id()}


@router.get("/prod")
async def prod():
    return await asyncio.to_thread(checks.prod_status)


@router.get("/compare")
async def compare_opensearch():
    """Dev vs prod: are the indices a snapshot would push already identical on prod? Read-only."""
    return await asyncio.to_thread(compare.compare)


@router.get("/docker")
async def docker_status(fresh: bool = False):
    """Docker's health (green / yellow / red) plus what is running, so the page can offer a restart. Cached for a few seconds."""
    result = await asyncio.to_thread(docker_health.get, fresh)
    active = runner.active_run_id()
    run = await asyncio.to_thread(db.get_run, active) if active else None
    return {**result, "active_run_id": active, "active_kind": run["kind"] if run else None,
            "restarting": bool(run and run["kind"] == "docker")}


@router.post("/docker/restart", status_code=202)
async def docker_restart_endpoint():
    """Restarts OrbStack (stop, start, wait until Docker and the local OpenSearch container are back). One job at a time."""
    try:
        run_id = await asyncio.to_thread(docker_restart.start_restart)
    except Busy as busy:
        raise HTTPException(409, f"Run {busy} is in progress. Cancel it first if you want to restart Docker now.")
    return {"run_id": run_id}


def _require_docker() -> None:
    """Refuses to start a job that needs Docker while Docker is yellow or red."""
    try:
        docker_health.require_healthy()
    except docker_health.DockerUnhealthy as exc:
        raise HTTPException(503, str(exc))


@router.post("/runs", status_code=202)
async def start_run(req: StartRunRequest):
    unknown = [a for a in req.actions if a not in ACTION_ORDER]
    if unknown:
        raise HTTPException(422, f"Unknown action(s): {', '.join(unknown)}")
    if req.build_services:
        allowed = await asyncio.to_thread(checks.build_services)
        bad = [s for s in req.build_services if s not in allowed]
        if bad:
            raise HTTPException(422, f"Not a buildable service: {', '.join(bad)}")
    if any(a in ("build", "copy_snapshots") for a in req.actions):   # restoring on prod only needs ssh
        await asyncio.to_thread(_require_docker)
    try:
        run_id = start_deploy(req.actions, {"build_services": req.build_services})
    except Busy as busy:
        raise HTTPException(409, f"Run {busy} is already in progress")
    return {"run_id": run_id}


class GcSelection(BaseModel):
    id: str
    variant: Optional[str] = None  # build_cache only: "older" or "all"


class GcRunRequest(BaseModel):
    target: str = "local"
    categories: List[GcSelection] = Field(..., min_length=1)
    confirm: bool = False  # required on prod and for the optional (not-safe) categories; the UI asks for a typed confirmation


@router.get("/gc/scan")
async def gc_scan(target: str = "local"):
    """What could be reclaimed on this machine ("local") or on prod. Read-only."""
    if target not in gc.TARGETS:
        raise HTTPException(422, f"Unknown target: {target}")
    try:
        return await asyncio.to_thread(gc.scan, target)
    except gc.EngineError as exc:
        raise HTTPException(503, str(exc))


@router.post("/gc/run", status_code=202)
async def gc_run(req: GcRunRequest):
    if req.target == "local":   # cleaning prod goes over ssh
        await asyncio.to_thread(_require_docker)
    try:
        run_id = await asyncio.to_thread(gc.start_cleanup, req.target, [s.model_dump() for s in req.categories], req.confirm)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Busy as busy:
        raise HTTPException(409, f"Run {busy} is already in progress")
    return {"run_id": run_id}
