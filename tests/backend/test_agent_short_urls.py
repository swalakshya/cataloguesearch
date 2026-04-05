from backend.api.agent.router import _apply_short_urls


def test_apply_short_urls_replaces_with_fallback():
    items = [
        {"file_url": "https://example.com/a.pdf", "other": 1},
        {"file_url": "https://example.com/missing.pdf", "other": 2},
        {"file_url": "", "other": 3},
    ]
    short_map = {"https://example.com/a.pdf": "https://swalakshya.me/url/abc"}
    result = _apply_short_urls(items, short_map)

    assert result[0]["file_url"] == "https://swalakshya.me/url/abc"
    assert result[1]["file_url"] == "https://example.com/missing.pdf"
    assert result[2]["file_url"] == ""
