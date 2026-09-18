"""Google login + stateless JWT session-cookie auth.

The session token is a signed JWT (HS256, shared secret with
cataloguesearch-chat) delivered as an httpOnly cookie -- unlike the admin
key's in-memory `_sessions` dict (backend/api/admin/admin_api.py), this
needs no server-side session store and survives restarts / multiple
workers, since verification is just a signature check.
"""
import json
import logging
import os
import time
from typing import Any, Dict, List, Literal, Optional

import google.auth.exceptions
import jwt as pyjwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel, ValidationError

from backend.api.auth.users_store import EmailConflictError

log_handle = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])

COOKIE_NAME = "cs_session"
_JWT_ALGORITHM = "HS256"
_JWT_TTL_SECONDS = 7 * 24 * 3600  # 7 days


class GoogleAuthRequest(BaseModel):
    id_token: str


# Generous for 5 flat UI-pref fields; guards against abuse, not a substitute
# for SettingsPayload's own field-level validation below.
_MAX_SETTINGS_BYTES = 8192


# Field-level validation for the settings blob. `palette` stays a loose
# string (its valid values live in the frontend's palettes.js, not anything
# the backend knows about) -- the frontend's own ThemeContext setter already
# guards against an unknown palette key, this just keeps obviously-wrong
# types (e.g. a number, a nested object) out of storage. mode/answerFormat
# have small, stable, backend-known domains, so those get real enums.
class SettingsPayload(BaseModel):
    mode: Optional[Literal["light", "dark"]] = None
    palette: Optional[str] = None
    answerFormat: Optional[Literal["summary", "structured"]] = None
    chatDefaultCategories: Optional[List[str]] = None
    khojDefaultCategories: Optional[List[str]] = None


def _user_settings(user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    raw = user.get("settings_json")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        log_handle.warning("corrupt_settings_json", extra={"user_id": user.get("id")})
        return None


def _validate_settings_payload(body: Dict[str, Any], active_categories: Optional[List[str]]) -> Dict[str, Any]:
    # FastAPI's own Dict[str, Any] body coercion already rejects a
    # non-object JSON payload before this runs -- only the size cap and the
    # field-level checks below are this function's job.
    encoded = json.dumps(body)
    if len(encoded.encode("utf-8")) > _MAX_SETTINGS_BYTES:
        raise HTTPException(status_code=422, detail="settings_too_large")

    try:
        payload = SettingsPayload.model_validate(body)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="invalid_settings") from exc

    validated = payload.model_dump(exclude_none=True)
    # Clamp against admin-active categories the same way the offline
    # (localStorage) path always has -- a category disabled after being
    # saved should silently fall out here too, not be rejected outright
    # (the save itself is otherwise legitimate).
    if active_categories:
        for key in ("chatDefaultCategories", "khojDefaultCategories"):
            if key in validated:
                validated[key] = [c for c in validated[key] if c in active_categories]
    return validated


def _jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET", "")
    if not secret:
        raise HTTPException(status_code=503, detail="auth_not_configured")
    return secret


def _google_client_id() -> str:
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(status_code=503, detail="auth_not_configured")
    return client_id


def _issue_token(user_id: str) -> str:
    now = int(time.time())
    payload = {"sub": user_id, "iat": now, "exp": now + _JWT_TTL_SECONDS}
    return pyjwt.encode(payload, _jwt_secret(), algorithm=_JWT_ALGORITHM)


def _decode_token(token: str) -> Dict[str, Any]:
    try:
        return pyjwt.decode(token, _jwt_secret(), algorithms=[_JWT_ALGORITHM])
    except pyjwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="invalid_session") from exc


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=_JWT_TTL_SECONDS,
        httponly=True,
        secure=os.environ.get("SESSION_COOKIE_SECURE", "true").lower() != "false",
        samesite="lax",
        domain=os.environ.get("SESSION_COOKIE_DOMAIN") or None,
    )


def get_current_user(
    request: Request, cs_session: Optional[str] = Cookie(default=None)
) -> Dict[str, Any]:
    """FastAPI dependency: the authenticated user, or 401."""
    if not cs_session:
        raise HTTPException(status_code=401, detail="not_authenticated")
    payload = _decode_token(cs_session)
    users_store = request.app.state.users_store
    user = users_store.get_by_id(payload.get("sub", ""))
    if not user:
        raise HTTPException(status_code=401, detail="not_authenticated")
    return user


@router.post("/auth/google")
async def google_login(request: Request, response: Response, body: GoogleAuthRequest):
    client_id = _google_client_id()

    try:
        claims = google_id_token.verify_oauth2_token(
            body.id_token, google_requests.Request(), client_id
        )
    except ValueError as exc:
        # The token itself is malformed/invalid -- the client's fault.
        raise HTTPException(status_code=401, detail="invalid_google_token") from exc
    except google.auth.exceptions.GoogleAuthError as exc:
        # A network/transport problem reaching Google's cert endpoint (or
        # similar) -- not the client's fault, and not "invalid token" either.
        log_handle.warning("google_token_verification_transport_error", extra={"error": str(exc)})
        raise HTTPException(status_code=503, detail="google_auth_unavailable") from exc

    google_sub = claims.get("sub")
    email = claims.get("email")
    if not google_sub or not email:
        raise HTTPException(status_code=401, detail="invalid_google_token")

    users_store = request.app.state.users_store
    try:
        user = users_store.upsert_google_user(
            google_sub=google_sub,
            email=email,
            name=claims.get("name") or email,
            given_name=claims.get("given_name"),
            avatar_url=claims.get("picture"),
        )
    except EmailConflictError as exc:
        raise HTTPException(status_code=409, detail="email_conflict") from exc

    token = _issue_token(user["id"])
    _set_session_cookie(response, token)
    log_handle.info("google_login_success", extra={"user_id": user["id"]})
    return {"user": user, "settings": _user_settings(user)}


@router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(
        COOKIE_NAME, domain=os.environ.get("SESSION_COOKIE_DOMAIN") or None
    )
    return {"status": "logged_out"}


@router.get("/auth/me")
async def me(user: Dict[str, Any] = Depends(get_current_user)):
    return {"user": user, "settings": _user_settings(user)}


@router.put("/auth/settings")
async def update_settings(
    body: Dict[str, Any],
    request: Request,
    user: Dict[str, Any] = Depends(get_current_user),
):
    active_categories = getattr(getattr(request.app.state, "config", None), "ACTIVE_CATEGORIES", None)
    validated = _validate_settings_payload(body, active_categories)
    users_store = request.app.state.users_store
    updated = users_store.update_settings(user["id"], json.dumps(validated))
    if not updated:
        # user_id from a valid cookie disappeared mid-request (deleted
        # account) -- same shape as get_current_user's 401 for a stale session.
        raise HTTPException(status_code=401, detail="not_authenticated")
    return {"settings": _user_settings(updated)}
