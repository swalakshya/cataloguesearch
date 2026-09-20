"""FastAPI router for the deploy page. Mounted at /api/deploy by dev.py."""
import asyncio
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deploy import checks, settings
from deploy.actions import ACTION_ORDER, ACTION_TITLES, start_deploy
from deploy.runner import Busy, runner

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
    try:
        run_id = start_deploy(req.actions, {"build_services": req.build_services})
    except Busy as busy:
        raise HTTPException(409, f"Run {busy} is already in progress")
    return {"run_id": run_id}
