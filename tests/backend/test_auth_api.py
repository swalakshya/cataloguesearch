"""Unit tests for the Google login / JWT session-cookie auth API."""
import time

import google.auth.exceptions
import jwt as pyjwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.auth import auth_api
from backend.api.auth.users_store import UsersStore


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    # TestClient talks plain http://testserver, like local dev — a Secure
    # cookie would never come back, same as a real browser would refuse it.
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "false")


class _StubConfig:
    ACTIVE_CATEGORIES = ["Pravachan", "Granth"]


@pytest.fixture
def app():
    fastapi_app = FastAPI()
    fastapi_app.state.users_store = UsersStore(":memory:")
    fastapi_app.state.config = _StubConfig()
    fastapi_app.include_router(auth_api.router)
    return fastapi_app


@pytest.fixture
def client(app):
    return TestClient(app)


def _mock_google_claims(**overrides):
    claims = {
        "sub": "google-sub-1",
        "email": "person@example.com",
        "name": "Person Name",
        "given_name": "Person",
        "picture": "http://example.com/pic.png",
    }
    claims.update(overrides)
    return claims


def _patch_google(monkeypatch, claims=None, raise_error=None):
    def _verify(*_args, **_kwargs):
        if raise_error:
            raise raise_error
        return claims if claims is not None else _mock_google_claims()

    monkeypatch.setattr(auth_api.google_id_token, "verify_oauth2_token", _verify)


def test_google_login_creates_user_and_sets_cookie(client, monkeypatch):
    _patch_google(monkeypatch)
    resp = client.post("/auth/google", json={"id_token": "fake-token"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["email"] == "person@example.com"
    assert body["user"]["name"] == "Person Name"
    assert body["user"]["given_name"] == "Person"
    assert auth_api.COOKIE_NAME in resp.cookies


def test_google_login_without_given_name_claim_still_succeeds(client, monkeypatch):
    # Not every Google account necessarily returns a given_name claim.
    claims = _mock_google_claims()
    del claims["given_name"]
    _patch_google(monkeypatch, claims=claims)
    resp = client.post("/auth/google", json={"id_token": "fake-token"})
    assert resp.status_code == 200
    assert resp.json()["user"]["given_name"] is None


def test_google_login_invalid_token_returns_401(client, monkeypatch):
    _patch_google(monkeypatch, raise_error=ValueError("bad token"))
    resp = client.post("/auth/google", json={"id_token": "bad"})
    assert resp.status_code == 401


def test_google_login_missing_email_returns_401(client, monkeypatch):
    _patch_google(monkeypatch, claims={"sub": "g-1"})  # no email claim
    resp = client.post("/auth/google", json={"id_token": "x"})
    assert resp.status_code == 401


def test_google_login_transport_error_returns_503_not_500(client, monkeypatch):
    # A network blip fetching Google's certs raises a GoogleAuthError
    # subclass, not a ValueError -- must not escape as a raw 500.
    _patch_google(monkeypatch, raise_error=google.auth.exceptions.TransportError("network blip"))
    resp = client.post("/auth/google", json={"id_token": "x"})
    assert resp.status_code == 503


def test_google_login_email_conflict_returns_409_not_500(client, monkeypatch):
    # Row A logs in first under its own (old) email.
    _patch_google(monkeypatch, claims=_mock_google_claims(sub="g-1", email="old@example.com"))
    client.post("/auth/google", json={"id_token": "x"})

    # A separate row already owns "new@example.com".
    client.app.state.users_store.upsert_google_user(
        google_sub="g-2", email="new@example.com", name="Other", avatar_url=None
    )

    # Row A's Google account email now reports as "new@example.com" -- the
    # update-by-google_sub path finds row A, but writing that email onto it
    # collides with row B's existing UNIQUE email.
    _patch_google(monkeypatch, claims=_mock_google_claims(sub="g-1", email="new@example.com"))
    resp = client.post("/auth/google", json={"id_token": "x"})
    assert resp.status_code == 409


def test_google_login_missing_client_id_returns_503(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    resp = client.post("/auth/google", json={"id_token": "x"})
    assert resp.status_code == 503


def test_google_login_missing_jwt_secret_returns_503(client, monkeypatch):
    _patch_google(monkeypatch)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    resp = client.post("/auth/google", json={"id_token": "fake-token"})
    assert resp.status_code == 503


def test_me_without_cookie_returns_401(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_me_with_valid_cookie_returns_user(client, monkeypatch):
    _patch_google(monkeypatch)
    login_resp = client.post("/auth/google", json={"id_token": "fake-token"})
    assert login_resp.status_code == 200

    me_resp = client.get("/auth/me")
    assert me_resp.status_code == 200
    assert me_resp.json()["user"]["email"] == "person@example.com"


def test_me_with_tampered_cookie_returns_401(client):
    client.cookies.set(auth_api.COOKIE_NAME, "not-a-real-jwt")
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_me_with_expired_token_returns_401(client):
    now = int(time.time())
    expired = pyjwt.encode(
        {"sub": "some-user-id", "iat": now - 1000, "exp": now - 500},
        "test-secret",
        algorithm="HS256",
    )
    client.cookies.set(auth_api.COOKIE_NAME, expired)
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_me_with_token_for_deleted_user_returns_401(client):
    now = int(time.time())
    token = pyjwt.encode(
        {"sub": "user-does-not-exist", "iat": now, "exp": now + 3600},
        "test-secret",
        algorithm="HS256",
    )
    client.cookies.set(auth_api.COOKIE_NAME, token)
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_logout_clears_session(client, monkeypatch):
    _patch_google(monkeypatch)
    client.post("/auth/google", json={"id_token": "fake-token"})
    logout_resp = client.post("/auth/logout")
    assert logout_resp.status_code == 200

    me_resp = client.get("/auth/me")
    assert me_resp.status_code == 401


def test_second_login_same_google_sub_reuses_user_id(client, monkeypatch):
    _patch_google(monkeypatch)
    first = client.post("/auth/google", json={"id_token": "fake-token"}).json()["user"]
    second = client.post("/auth/google", json={"id_token": "fake-token-2"}).json()["user"]
    assert first["id"] == second["id"]


def test_google_login_response_includes_null_settings_for_new_user(client, monkeypatch):
    _patch_google(monkeypatch)
    resp = client.post("/auth/google", json={"id_token": "fake-token"})
    assert resp.json()["settings"] is None


def test_me_response_includes_null_settings_when_unset(client, monkeypatch):
    _patch_google(monkeypatch)
    client.post("/auth/google", json={"id_token": "fake-token"})
    resp = client.get("/auth/me")
    assert resp.json()["settings"] is None


def test_update_settings_requires_auth(client):
    resp = client.put("/auth/settings", json={"mode": "dark"})
    assert resp.status_code == 401


def test_update_settings_persists_and_reflected_in_me(client, monkeypatch):
    _patch_google(monkeypatch)
    client.post("/auth/google", json={"id_token": "fake-token"})

    put_resp = client.put("/auth/settings", json={"mode": "dark", "palette": "forest"})
    assert put_resp.status_code == 200
    assert put_resp.json()["settings"] == {"mode": "dark", "palette": "forest"}

    me_resp = client.get("/auth/me")
    assert me_resp.json()["settings"] == {"mode": "dark", "palette": "forest"}


def test_update_settings_rejects_non_object_body(client, monkeypatch):
    _patch_google(monkeypatch)
    client.post("/auth/google", json={"id_token": "fake-token"})

    resp = client.put("/auth/settings", json=["not", "an", "object"])
    assert resp.status_code == 422


def test_update_settings_rejects_oversized_payload(client, monkeypatch):
    _patch_google(monkeypatch)
    client.post("/auth/google", json={"id_token": "fake-token"})

    resp = client.put("/auth/settings", json={"junk": "x" * 20_000})
    assert resp.status_code == 422


def test_update_settings_rejects_invalid_mode(client, monkeypatch):
    _patch_google(monkeypatch)
    client.post("/auth/google", json={"id_token": "fake-token"})

    resp = client.put("/auth/settings", json={"mode": "not-a-real-mode"})
    assert resp.status_code == 422


def test_update_settings_rejects_invalid_answer_format(client, monkeypatch):
    _patch_google(monkeypatch)
    client.post("/auth/google", json={"id_token": "fake-token"})

    resp = client.put("/auth/settings", json={"answerFormat": "not-a-real-format"})
    assert resp.status_code == 422


def test_update_settings_clamps_categories_to_active_list(client, monkeypatch):
    # _StubConfig.ACTIVE_CATEGORIES is ["Pravachan", "Granth"] -- "Books"
    # should silently fall out, not cause a rejection.
    _patch_google(monkeypatch)
    client.post("/auth/google", json={"id_token": "fake-token"})

    resp = client.put("/auth/settings", json={"chatDefaultCategories": ["Pravachan", "Books"]})
    assert resp.status_code == 200
    assert resp.json()["settings"]["chatDefaultCategories"] == ["Pravachan"]


def test_update_settings_ignores_unknown_extra_fields(client, monkeypatch):
    _patch_google(monkeypatch)
    client.post("/auth/google", json={"id_token": "fake-token"})

    resp = client.put("/auth/settings", json={"mode": "dark", "somethingUnknown": "x"})
    assert resp.status_code == 200
    assert resp.json()["settings"] == {"mode": "dark"}
