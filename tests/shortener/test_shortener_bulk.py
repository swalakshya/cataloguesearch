from backend.shortener.core import ShortenerStore


def test_store_returns_codes_for_known_urls():
    store = ShortenerStore(base_len=6)
    store.load(["https://example.com/a.pdf", "https://example.com/b.pdf"])
    assert store.get_code("https://example.com/a.pdf") is not None
    assert store.get_code("https://example.com/b.pdf") is not None
    assert store.get_code("https://example.com/a.pdf") != store.get_code("https://example.com/b.pdf")


def test_store_returns_none_for_unknown_url():
    store = ShortenerStore(base_len=6)
    store.load(["https://example.com/a.pdf", "https://example.com/b.pdf"])
    assert store.get_code("https://example.com/missing.pdf") is None
