from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.url.router import router as url_router
from backend.shortener.core import ShortenerStore


def _make_test_app():
    app = FastAPI()
    store = ShortenerStore(base_len=6)
    store.load(["https://example.com/a.pdf"])
    app.state.shortener_store = store
    app.include_router(url_router)
    return app


def test_redirect_returns_302():
    app = _make_test_app()
    client = TestClient(app)
    code = app.state.shortener_store.get_code("https://example.com/a.pdf")
    resp = client.get(f"/url/{code}", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "https://example.com/a.pdf"


def test_redirect_unknown_code_404():
    app = _make_test_app()
    client = TestClient(app)
    resp = client.get("/url/unknown", follow_redirects=False)
    assert resp.status_code == 404


def test_redirect_with_page_appends_fragment():
    app = _make_test_app()
    client = TestClient(app)
    code = app.state.shortener_store.get_code("https://example.com/a.pdf")
    resp = client.get(f"/url/{code}/68", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "https://example.com/a.pdf#page=68"
