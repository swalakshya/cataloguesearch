from fastapi.testclient import TestClient

from backend.shortener.app import create_app
from backend.shortener.core import ShortenerStore


def _store_with_urls():
    store = ShortenerStore(base_len=6)
    store.load(["https://example.com/a.pdf", "https://example.com/b.pdf"])
    return store


def test_bulk_shorten_returns_map():
    app = create_app(store=_store_with_urls(), base_url="https://swalakshya.me")
    client = TestClient(app)
    resp = client.post(
        "/shorten",
        json={"long_urls": ["https://example.com/a.pdf", "https://example.com/missing.pdf"]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "short_urls" in data
    assert "https://example.com/a.pdf" in data["short_urls"]
    assert "https://example.com/missing.pdf" not in data["short_urls"]
