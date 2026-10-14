"""Allow-listed local service controls; secrets are revealed only on request."""
import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from deploy.local_services import ORDER, manager
from deploy.runner import Busy

Service = Literal[ORDER]
router = APIRouter(prefix='/api/local-services', tags=['local-services'])


@router.get('')
async def status():
    return await asyncio.to_thread(manager.status)


class Action(BaseModel):
    service: Literal[(*ORDER, 'all')]
    action: Literal['start', 'stop', 'restart', 'update']
    confirm: bool = False


@router.post('/actions', status_code=202)
async def action(request: Action):
    implementation = manager.service(request.service) if request.service != 'all' else None
    if request.action == 'update' and (implementation is None or not implementation.can_update):
        raise HTTPException(422, 'Only API, UI and chat have source updates')
    if implementation and implementation.confirmation and request.action in ('stop', 'restart') and not request.confirm:
        raise HTTPException(422, 'Confirm stopping Docker and all its local containers')
    try:
        return {'run_id': manager.start_action(request.service, request.action)}
    except Busy as busy:
        raise HTTPException(409, f'Another job is running: {busy}')


@router.get('/{service}/config')
async def configuration(service: Service):
    return JSONResponse(await asyncio.to_thread(manager.configuration, service), headers={'Cache-Control': 'no-store'})


class Reveal(BaseModel):
    key: str


@router.post('/{service}/config/reveal')
async def reveal(service: Service, request: Reveal):
    try:
        value = await asyncio.to_thread(manager.reveal, service, request.key)
        return JSONResponse({'value': value}, headers={'Cache-Control': 'no-store'})
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.get('/{service}/logs')
async def logs(service: Service, cursor: str | None = Query(None, max_length=4096)):
    try:
        return JSONResponse(await asyncio.to_thread(manager.logs, service, cursor), headers={'Cache-Control': 'no-store'})
    except Exception as exc:
        raise HTTPException(503, manager.redact(str(exc))[:1000])
