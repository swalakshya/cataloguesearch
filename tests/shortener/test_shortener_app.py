from fastapi.testclient import TestClient

from backend.shortener.app import create_app
from backend.shortener.core import ShortenerStore


def _store_with_url():
    store = ShortenerStore(base_len=6)
    store.load(["https://example.com/a.pdf"])
    return store


def test_shorten_returns_short_url():
    app = create_app(store=_store_with_url(), base_url="https://swalakshya.me")
    client = TestClient(app)
    resp = client.post("/shorten", json={"long_urls": ["https://example.com/a.pdf"]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["short_urls"]["https://example.com/a.pdf"].startswith("https://swalakshya.me/su/")


def test_shorten_unknown_url_404():
    app = create_app(store=_store_with_url(), base_url="https://swalakshya.me")
    client = TestClient(app)
    resp = client.post("/shorten", json={"long_urls": ["https://example.com/missing.pdf"]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["short_urls"] == {}


def test_redirect_with_page_appends_fragment():
    app = create_app(store=_store_with_url(), base_url="https://swalakshya.me")
    client = TestClient(app)

    code = app.state.store.get_code("https://example.com/a.pdf")
    resp = client.get(f"/su/{code}/68", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "https://example.com/a.pdf#page=68"
