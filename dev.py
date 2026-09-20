"""Local dev/admin server: the eval tooling and the deploy page behind one uvicorn app.

    uvicorn dev:app --host 127.0.0.1 --port 8001 --reload

Serves /api/eval/* (unchanged) and /api/deploy/*. Localhost only: deploy can restore prod.
"""
from fastapi import FastAPI

from deploy import guard, runner as deploy_runner
from deploy.api import router as deploy_router
from deploy.jobs_api import router as jobs_router
from eval import api as eval_api
from ingest.api import router as discover_router

app = FastAPI(title="Catalogue Dev Server (eval + deploy)", version="1.0.0")
guard.install(app)

app.include_router(eval_api.router, prefix="/api")
app.include_router(eval_api.load_test_router, prefix="/api")
app.include_router(deploy_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(discover_router, prefix="/api")

# Reuse eval's startup (logging, .env.local, job cleanup, load-test db) as-is.
app.add_event_handler("startup", eval_api.startup)
app.add_event_handler("startup", deploy_runner.startup)
app.add_event_handler("shutdown", deploy_runner.runner.shutdown)
