"""Admin API — config overrides + session-based auth."""
import hashlib
import logging
import os
import secrets
import time
from typing import Any, Dict, Optional

import requests
from fastapi import APIRouter, Body, Header, HTTPException, Request

from backend.common.opensearch import get_opensearch_client
from backend.config import ADMIN_PARAM_DEFAULTS, AGENT_PARAM_DEFAULTS

log_handle = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])

# ---------------------------------------------------------------------------
# In-memory session store keyed by cataloguesearch admin session token.
# ---------------------------------------------------------------------------
_sessions: Dict[str, Dict[str, Any]] = {}
_SESSION_TTL = 86400  # 1 day
_CHAT_ADMIN_TIMEOUT_SEC = 15


def _get_key_hash() -> str:
    """SHA-256 of the ADMIN_KEY env var. Empty string if not set."""
    key = os.environ.get("ADMIN_KEY", "")
    if not key:
        return ""
    return hashlib.sha256(key.encode()).hexdigest()


def _require_auth(authorization: Optional[str]):
    """Raise 401 if the Bearer token is missing or expired."""
    _get_session(authorization)


def _get_session(authorization: Optional[str]) -> Dict[str, Any]:
    """Return the current admin session, or raise 401 if missing/expired."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.removeprefix("Bearer ").strip()
    session = _sessions.get(token)
    expiry = session.get("expires_at") if isinstance(session, dict) else session
    if not session or expiry is None or time.time() > expiry:
        _sessions.pop(token, None)
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return session


def _get_chat_admin_base_url() -> str:
    base_url = (
        os.environ.get("CHAT_ADMIN_BASE_URL")
        or os.environ.get("LLM_API_BASE_URL")
        or "http://localhost:8012"
    )
    return base_url.rstrip("/")


def _ensure_chat_admin_token(session: Dict[str, Any], *, force_refresh: bool = False) -> str:
    cached_token = session.get("chat_admin_token")
    if cached_token and not force_refresh:
        return cached_token

    key_hash = session.get("key_hash")
    if not key_hash:
        raise HTTPException(status_code=401, detail="Missing admin session key hash")

    auth_url = f"{_get_chat_admin_base_url()}/v1/admin/auth"
    try:
        response = requests.post(
            auth_url,
            json={"key_hash": key_hash},
            timeout=_CHAT_ADMIN_TIMEOUT_SEC,
        )
    except requests.RequestException as exc:
        log_handle.warning("Chat admin auth request failed: %s", exc)
        raise HTTPException(status_code=503, detail="chat_admin_unavailable") from exc

    detail = _extract_detail(response)
    if response.status_code != 200:
        log_handle.warning(
            "Chat admin auth failed: status=%s detail=%s",
            response.status_code,
            detail,
        )
        if response.status_code == 401:
            raise HTTPException(status_code=401, detail="Invalid key")
        raise HTTPException(status_code=503, detail=detail or "chat_admin_auth_failed")

    body = _safe_json(response)
    token = body.get("token") if isinstance(body, dict) else None
    if not token:
        raise HTTPException(status_code=502, detail="chat_admin_invalid_response")

    session["chat_admin_token"] = token
    return token


def _chat_admin_get(session: Dict[str, Any], path: str, *, params: Optional[Dict[str, Any]] = None):
    last_response = None
    for attempt in range(2):
        token = _ensure_chat_admin_token(session, force_refresh=attempt > 0)
        try:
            response = requests.get(
                f"{_get_chat_admin_base_url()}{path}",
                params=params,
                headers={"Authorization": f"Bearer {token}"},
                timeout=_CHAT_ADMIN_TIMEOUT_SEC,
            )
        except requests.RequestException as exc:
            log_handle.warning("Chat admin GET %s failed: %s", path, exc)
            raise HTTPException(status_code=503, detail="chat_admin_unavailable") from exc

        if response.status_code == 401 and attempt == 0:
            session["chat_admin_token"] = None
            last_response = response
            continue
        return response

    return last_response


def _safe_json(response: requests.Response) -> Dict[str, Any]:
    try:
        parsed = response.json()
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _extract_detail(response: requests.Response) -> Optional[str]:
    body = _safe_json(response)
    detail = body.get("detail")
    return str(detail) if detail else None


def _proxy_chat_response(response: requests.Response):
    detail = _extract_detail(response)
    if response.status_code >= 400:
        status_code = response.status_code if response.status_code in (400, 401, 404, 503) else 502
        raise HTTPException(status_code=status_code, detail=detail or "chat_admin_request_failed")
    return _safe_json(response)


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
    _sessions[token] = {
        "expires_at": time.time() + _SESSION_TTL,
        "key_hash": key_hash,
        "chat_admin_token": None,
    }
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


@router.get("/admin/chat-request-logs")
async def get_chat_request_logs(
    authorization: Optional[str] = Header(None),
    from_ts: Optional[int] = None,
    to_ts: Optional[int] = None,
    request_id: Optional[str] = None,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    status: str = "all",
    limit: int = 50,
    offset: int = 0,
):
    """Proxy paginated chat request-log summaries from cataloguesearch-chat."""
    session = _get_session(authorization)
    params = {
        "from": from_ts,
        "to": to_ts,
        "request_id": request_id,
        "session_id": session_id,
        "user_id": user_id,
        "status": status,
        "limit": limit,
        "offset": offset,
    }
    response = _chat_admin_get(session, "/v1/admin/request-logs", params=params)
    return _proxy_chat_response(response)


@router.get("/admin/chat-request-logs/{request_id}")
async def get_chat_request_log_detail(
    request_id: str,
    authorization: Optional[str] = Header(None),
):
    """Proxy one chat request-log detail record from cataloguesearch-chat."""
    session = _get_session(authorization)
    response = _chat_admin_get(session, f"/v1/admin/request-logs/{request_id}")
    return _proxy_chat_response(response)
