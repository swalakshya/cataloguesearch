"""Source change detection and graceful dashboard update admission control.

The parent launcher builds/releases assets and restarts Uvicorn. This module
drains requests and existing jobs first; it never kills a job to update code.
"""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from deploy import settings
from deploy.runner import runner

ROOT = settings.REPO_ROOT
RUNTIME = ROOT / '.dashboard'
ACTIVE_PHASES = {'waiting', 'ready', 'building', 'restarting'}


def revisions(root=ROOT):
    groups = {'backend': [], 'frontend': []}
    for folder in ('deploy', 'ingest', 'eval', 'backend', 'utils', 'scripts', 'scratch'):
        groups['backend'].extend((root / folder).rglob('*.py'))
    groups['backend'].extend(root / name for name in ('dev.py', 'dashboard.py'))
    front = root / 'frontend'
    for folder in ('src', 'public'):
        groups['frontend'].extend((front / folder).rglob('*'))
    groups['frontend'].extend(front / name for name in ('dashboard.html', 'vite.dashboard.config.mjs', 'package.json', 'package-lock.json', 'tailwind.config.js', 'postcss.config.js'))
    result = {}
    for group, paths in groups.items():
        digest = hashlib.sha256()
        for path in sorted(set(paths)):
            if not path.is_file() or '__pycache__' in path.parts or '.test.' in path.name:
                continue
            digest.update(str(path.relative_to(root)).encode())
            digest.update(path.read_bytes())
        result[group] = digest.hexdigest()
    return result


def read_state(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {'phase': 'idle'}


def write_state(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.new')
    temp.write_text(json.dumps(value))
    temp.replace(path)


def background_jobs():
    busy = []
    if runner.active_run_id():
        busy.append('Deployment, discovery or maintenance job')
    # Read only instantiated services; don't initialize OCR just to check it.
    module = sys.modules.get('eval.ocr')
    service = getattr(module, '_service_instance', None)
    if service:
        manager = service.job_manager
        with manager.lock:
            if any(job['status'] in ('queued', 'processing', 'running') for job in manager.jobs.values()):
                busy.append('Evaluation OCR job')
    load_test = sys.modules.get('eval.load_test.api')
    if getattr(load_test, '_state', {}).get('running'):
        busy.append('Load test')
    drive = sys.modules.get('deploy.drive')
    if getattr(getattr(drive, 'connection', None), 'state', None) == 'connecting':
        busy.append('Google Drive connection')
    return busy


class UpdateCoordinator:
    def __init__(self, state_path=None, baseline=None, managed=None):
        self.path = state_path or Path(os.environ.get('DASHBOARD_STATE_PATH', RUNTIME / 'update.json'))
        self.baseline = baseline if baseline is not None else json.loads(os.environ.get('DASHBOARD_REVISION', '{}'))
        self.managed = managed if managed is not None else os.environ.get('DASHBOARD_MANAGED') == '1'
        self.requests = 0
        self.task = None
        self._revision_cache = None
        self._checked = 0

    def phase(self):
        return read_state(self.path).get('phase', 'idle') if self.managed else 'idle'

    async def status(self):
        if not self.managed:
            return {'enabled': False}
        if self._revision_cache is None or time.monotonic() - self._checked > 3:
            self._revision_cache = await asyncio.to_thread(revisions)
            self._checked = time.monotonic()
        state = read_state(self.path)
        return {**state, 'enabled': True, 'instance': os.environ.get('DASHBOARD_INSTANCE', ''),
                'available': self._revision_cache != self.baseline,
                'waiting_for': background_jobs() + ([f'{self.requests} request(s)'] if self.requests else [])}

    def request(self):
        if not self.managed:
            raise HTTPException(409, 'Start the dashboard with python dashboard.py to enable updates.')
        if self.phase() not in ACTIVE_PHASES:
            write_state(self.path, {'phase': 'waiting', 'message': 'Waiting for running jobs and requests to finish'})
        return {'phase': self.phase()}

    async def drain(self):
        while True:
            if self.phase() == 'waiting' and self.requests == 0 and not background_jobs():
                write_state(self.path, {'phase': 'ready', 'message': 'All jobs complete; preparing the dashboard update'})
            await asyncio.sleep(1)


def install(app, coordinator=None):
    coordinator = coordinator or UpdateCoordinator()
    router = APIRouter(prefix='/api/dashboard', tags=['dashboard'])

    @router.get('/status')
    async def status():
        return await coordinator.status()

    @router.post('/update', status_code=202)
    async def update():
        return coordinator.request()

    app.include_router(router)

    @app.middleware('http')
    async def drain_requests(request, call_next):
        path = request.url.path
        tracked = path.startswith('/api/') and not path.startswith('/api/dashboard/')
        # Cancellation remains available so users can finish draining a job.
        cancellation = path.endswith('/cancel') or '/cancel/' in path
        if tracked and request.method not in ('GET', 'HEAD', 'OPTIONS') and not cancellation:
            if coordinator.phase() in ACTIVE_PHASES:
                return JSONResponse({'detail': 'Dashboard update queued. New work is paused until the update finishes.'}, status_code=503)
        if tracked:
            coordinator.requests += 1
        try:
            return await call_next(request)
        finally:
            if tracked:
                coordinator.requests -= 1

    @app.on_event('startup')
    async def start():
        if coordinator.managed:
            coordinator.task = asyncio.create_task(coordinator.drain())

    @app.on_event('shutdown')
    async def stop():
        if coordinator.task:
            coordinator.task.cancel()
            try:
                await coordinator.task
            except asyncio.CancelledError:
                pass

    return coordinator
