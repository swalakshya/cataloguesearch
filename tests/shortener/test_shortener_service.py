from fastapi.testclient import TestClient

from backend.shortener.app import create_app
from backend.shortener.core import ShortenerStore


def _make_store():
    store = ShortenerStore(base_len=6)
    store.load(["https://example.com/a.pdf", "https://example.com/b.pdf"])
    return store


def test_health():
    client = TestClient(create_app(store=_make_store()))
    assert client.get("/health").json() == {"status": "ok"}


def test_shorten_known_url():
    store = _make_store()
    client = TestClient(create_app(store=store, base_url="https://swalakshya.me"))
    resp = client.post("/shorten", json={"long_urls": ["https://example.com/a.pdf"]})
    assert resp.status_code == 200
    short_urls = resp.json()["short_urls"]
    assert "https://example.com/a.pdf" in short_urls
    assert short_urls["https://example.com/a.pdf"].startswith("https://swalakshya.me/url/")


def test_shorten_unknown_url_excluded():
    client = TestClient(create_app(store=_make_store(), base_url="https://swalakshya.me"))
    resp = client.post("/shorten", json={"long_urls": ["https://notloaded.com/x.pdf"]})
    assert resp.status_code == 200
    assert resp.json()["short_urls"] == {}


def test_redirect_known_code():
    store = _make_store()
    client = TestClient(create_app(store=store))
    code = store.get_code("https://example.com/a.pdf")
    resp = client.get(f"/url/{code}", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "https://example.com/a.pdf"


def test_redirect_unknown_code_returns_404():
    client = TestClient(create_app(store=_make_store()))
    resp = client.get("/url/notexist", follow_redirects=False)
    assert resp.status_code == 404


def test_redirect_with_page_appends_fragment():
    store = _make_store()
    client = TestClient(create_app(store=store))
    code = store.get_code("https://example.com/a.pdf")
    resp = client.get(f"/url/{code}/42", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "https://example.com/a.pdf#page=42"


def test_redirect_with_unknown_code_and_page_returns_404():
    client = TestClient(create_app(store=_make_store()))
    resp = client.get("/url/notexist/5", follow_redirects=False)
    assert resp.status_code == 404


def test_redirect_with_invalid_page_returns_400():
    store = _make_store()
    client = TestClient(create_app(store=store))
    code = store.get_code("https://example.com/a.pdf")
    resp = client.get(f"/url/{code}/0", follow_redirects=False)
    assert resp.status_code == 400
