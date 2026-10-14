"""Serve the independently built dashboard UI after registering API routes."""
import os
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from deploy.dashboard_updates import RUNTIME


def install(app):
    release = os.environ.get('DASHBOARD_RELEASE')
    if not release:
        return
    releases = RUNTIME / 'releases'
    current = (releases / release).resolve()
    if not (current / 'dashboard.html').is_file():
        raise RuntimeError('Dashboard UI assets are missing. Run python dashboard.py --build.')
    # Versioned paths keep assets for tabs opened before an update available.
    app.mount('/dashboard-assets', StaticFiles(directory=releases), name='dashboard-assets')

    @app.get('/{path:path}', include_in_schema=False)
    async def dashboard_page(path: str):
        if path == 'api' or path.startswith('api/'):
            raise HTTPException(404, 'API route not found')
        target = (current / path).resolve()
        if not target.is_relative_to(current):
            raise HTTPException(404)
        if target.is_file():
            return FileResponse(target)
        if path and Path(path).suffix:
            raise HTTPException(404)
        return FileResponse(current / 'dashboard.html', headers={'Cache-Control': 'no-store'})
