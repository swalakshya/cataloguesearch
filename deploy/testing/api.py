import asyncio
import json
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Literal
from deploy.testing import manager
from deploy.runner import Busy
from deploy.log_stream import file_feed

router = APIRouter(prefix='/api/testing', tags=['testing'])


def response(data):
    return JSONResponse(data, headers={'Cache-Control': 'no-store'})


@router.get('')
async def inventory():
    return response(await asyncio.to_thread(manager.inventory))


class Start(BaseModel):
    suites: list[Literal['python', 'frontend', 'chat']] = ['python', 'frontend', 'chat']


@router.post('/runs', status_code=202)
async def start(request: Start):
    if not request.suites or len(set(request.suites)) != len(request.suites):
        raise HTTPException(422, 'Choose at least one distinct suite')
    try:
        return {'run_id': manager.start(request.suites)}
    except Busy as exc:
        raise HTTPException(409, f'Another job is running: {exc}')


def checked(run, identifier=None):
    try:
        return manager.store.details(run, identifier, include_text=False) if identifier else manager.store.snapshot(run)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(404, 'Report not available yet or no longer retained' if isinstance(exc, FileNotFoundError) else str(exc))


@router.get('/runs/{run}')
async def snapshot(run: str):
    return response(await asyncio.to_thread(checked, run))


@router.get('/runs/{run}/files/{identifier}')
async def details(run: str, identifier: str):
    data = await asyncio.to_thread(checked, run, identifier)
    data.pop('text', None)
    return response(data)


@router.get('/runs/{run}/files/{identifier}/logs')
async def logs(run: str, identifier: str, cursor: str | None = Query(None, max_length=4096)):
    row = await asyncio.to_thread(checked, run, identifier)
    return response(await asyncio.to_thread(file_feed, manager.store.directory(run) / f'{row.get("log_id", identifier)}.log', cursor))


@router.get('/runs/{run}/coverage/{suite}')
async def coverage(run: str, suite: Literal['python', 'frontend', 'chat']):
    await asyncio.to_thread(checked, run)
    path = manager.store.directory(run) / suite / 'normalized.json'
    if not path.is_file():
        error = path.parent / 'coverage-error.txt'
        return response({'files': [], 'totals': {}, 'available': False,
                         'reason': error.read_text() if error.is_file() else None})
    data = await asyncio.to_thread(lambda: json.loads(path.read_text()))
    data['available'] = True
    return response(data)
