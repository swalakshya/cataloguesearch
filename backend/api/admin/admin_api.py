"""Admin API — config overrides + session-based auth."""
import hashlib
import logging
import os
import secrets
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Header, HTTPException, Request

from backend.common.opensearch import get_opensearch_client
from backend.config import ADMIN_PARAM_DEFAULTS, AGENT_PARAM_DEFAULTS

log_handle = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])

# ---------------------------------------------------------------------------
# In-memory session store: token -> expiry (unix timestamp)
# ---------------------------------------------------------------------------
_sessions: Dict[str, float] = {}
_SESSION_TTL = 86400  # 1 day


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
    # Validate rerank_oversample >= max page size after proposed update
    page_keys = ("page_size_pravachan", "page_size_granth", "page_size_books")
    would_be_oversample = int(updates.get("rerank_oversample", config.RERANK_OVERSAMPLE))
    would_be_pages = [int(updates.get(k, getattr(config, k.upper()))) for k in page_keys]
    if would_be_oversample < max(would_be_pages):
        raise HTTPException(
            status_code=400,
            detail=f"rerank_oversample ({would_be_oversample}) must be >= largest page size ({max(would_be_pages)})",
        )
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


@router.get("/admin/agent-config")
async def get_agent_config(
    request: Request,
    authorization: Optional[str] = Header(None),
):
    """Return defaults (inherited from main search config), current agent overrides, and effective values."""
    _require_auth(authorization)
    config = request.app.state.config
    defaults = config.get_agent_defaults()
    overrides = dict(config._agent_overrides)
    effective = {k: overrides[k] if k in overrides else defaults[k] for k in defaults}
    return {"defaults": defaults, "overrides": overrides, "effective": effective}


@router.post("/admin/agent-config")
async def update_agent_config(
    request: Request,
    updates: Dict[str, Any] = Body(...),
    authorization: Optional[str] = Header(None),
):
    """Merge updates into agent overrides. Unknown keys are rejected."""
    _require_auth(authorization)
    config = request.app.state.config
    bad_keys = set(updates.keys()) - set(AGENT_PARAM_DEFAULTS.keys())
    if bad_keys:
        raise HTTPException(status_code=400, detail=f"Unknown agent config keys: {sorted(bad_keys)}")
    config.update_agent_overrides(request.app.state.overrides_path, updates)
    log_handle.info("Agent overrides updated: %s", list(updates.keys()))
    return {"status": "ok", "overrides": dict(config._agent_overrides)}


@router.delete("/admin/agent-config")
async def reset_all_agent_config(
    request: Request,
    authorization: Optional[str] = Header(None),
):
    """Reset all agent overrides."""
    _require_auth(authorization)
    config = request.app.state.config
    config.reset_agent_overrides(request.app.state.overrides_path)
    log_handle.info("Agent overrides reset (all)")
    return {"status": "ok"}


@router.delete("/admin/agent-config/{key}")
async def reset_one_agent_config(
    key: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    """Reset a single agent override key."""
    _require_auth(authorization)
    if key not in AGENT_PARAM_DEFAULTS:
        raise HTTPException(status_code=400, detail=f"Unknown agent config key: {key}")
    config = request.app.state.config
    config.reset_agent_overrides(request.app.state.overrides_path, key=key)
    log_handle.info("Agent override reset: %s", key)
    return {"status": "ok", "key": key}


@router.post("/admin/cache/clear")
async def clear_opensearch_cache(
    request: Request,
    authorization: Optional[str] = Header(None),
):
    """Clear all OpenSearch caches (request, query, fielddata) on all indices."""
    _require_auth(authorization)
    client = get_opensearch_client(request.app.state.config)
    try:
        result = client.indices.clear_cache(index="_all")
        log_handle.info("OpenSearch cache cleared: %s", result)
        return {"status": "ok", "result": result}
    except Exception as exc:
        log_handle.warning("Failed to clear OpenSearch cache: %s", exc)
        raise HTTPException(status_code=503, detail=f"Cache clear failed: {exc}") from exc


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
