"""CORS + origin guard for the local dev server."""
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get(
        "DEV_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()
]

# Routes that can deploy to prod, run indexing, or cancel a running job.
GUARDED_PREFIXES = ("/api/deploy", "/api/discover", "/api/jobs")


def install(app: FastAPI) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def guard_job_origin(request: Request, call_next):
        """Any web page can fire requests at localhost; don't let a foreign origin start (or cancel) a job."""
        if request.url.path.startswith(GUARDED_PREFIXES):
            origin = request.headers.get("origin")
            if origin and origin not in ALLOWED_ORIGINS:
                return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
        return await call_next(request)
