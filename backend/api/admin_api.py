"""Admin API — config overrides + session-based auth."""
import hashlib
import logging
import os
import secrets
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Header, HTTPException, Request

from backend.config import ADMIN_PARAM_DEFAULTS

log_handle = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])

# ---------------------------------------------------------------------------
# In-memory session store: token -> expiry (unix timestamp)
# ---------------------------------------------------------------------------
_sessions: Dict[str, float] = {}
_SESSION_TTL = 3600  # 1 hour


def _get_key_hash() -> str:
    """SHA-256 of the ADMIN_KEY env var. Empty string if not set."""
    key = os.environ.get("ADMIN_KEY", "")
    if not key:
        return ""
    return hashlib.sha256(key.encode()).hexdigest()


def _require_auth(authorization: Optional[str]):
    """Raise 401 if the Bearer token is missing or expired."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.removeprefix("Bearer ").strip()
    expiry = _sessions.get(token)
    if expiry is None or time.time() > expiry:
        _sessions.pop(token, None)
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@router.post("/admin/auth")
async def admin_auth(key_hash: str = Body(..., embed=True)):
    """
    Validate the SHA-256 hash of the admin key.
    Returns a short-lived session token on success.
    """
    expected = _get_key_hash()
    if not expected:
        raise HTTPException(status_code=503, detail="Admin key not configured")
    if not secrets.compare_digest(key_hash, expected):
        raise HTTPException(status_code=401, detail="Invalid key")

    token = secrets.token_urlsafe(32)
    _sessions[token] = time.time() + _SESSION_TTL
    log_handle.info("Admin session created")
    return {"token": token}


# ---------------------------------------------------------------------------
# Config endpoints
# ---------------------------------------------------------------------------

@router.get("/admin/config")
async def get_admin_config(
    request: Request,
    authorization: Optional[str] = Header(None),
):
    """Return defaults, current overrides, and effective values for all admin params."""
    _require_auth(authorization)
    config = request.app.state.config
    defaults = config.get_defaults()
    overrides = dict(config._overrides)
    effective = {k: overrides[k] if k in overrides else defaults[k] for k in defaults}
    return {"defaults": defaults, "overrides": overrides, "effective": effective}


@router.post("/admin/config")
async def update_admin_config(
    request: Request,
    updates: Dict[str, Any] = Body(...),
    authorization: Optional[str] = Header(None),
):
    """Merge updates into overrides. Unknown keys are rejected."""
    _require_auth(authorization)
    config = request.app.state.config
    allowed = set(ADMIN_PARAM_DEFAULTS.keys()) | {"active_categories"}
    bad_keys = set(updates.keys()) - allowed
    if bad_keys:
        raise HTTPException(status_code=400, detail=f"Unknown keys: {sorted(bad_keys)}")
    config.update_overrides(request.app.state.overrides_path, updates)
    log_handle.info("Admin overrides updated: %s", list(updates.keys()))
    return {"status": "ok", "overrides": dict(config._overrides)}


@router.delete("/admin/config")
async def reset_all_admin_config(
    request: Request,
    authorization: Optional[str] = Header(None),
):
    """Reset all overrides to defaults."""
    _require_auth(authorization)
    config = request.app.state.config
    config.reset_overrides(request.app.state.overrides_path)
    log_handle.info("Admin overrides reset (all)")
    return {"status": "ok"}


@router.delete("/admin/config/{key}")
async def reset_one_admin_config(
    key: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    """Reset a single override key to its default."""
    _require_auth(authorization)
    allowed = set(ADMIN_PARAM_DEFAULTS.keys()) | {"active_categories"}
    if key not in allowed:
        raise HTTPException(status_code=400, detail=f"Unknown key: {key}")
    config = request.app.state.config
    config.reset_overrides(request.app.state.overrides_path, key=key)
    log_handle.info("Admin override reset: %s", key)
    return {"status": "ok", "key": key}
