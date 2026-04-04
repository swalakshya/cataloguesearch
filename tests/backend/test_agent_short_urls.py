from backend.api.agent.router import _apply_short_urls


def test_apply_short_urls_replaces_and_blanks():
    items = [
        {"file_url": "https://example.com/a.pdf", "other": 1},
        {"file_url": "https://example.com/missing.pdf", "other": 2},
        {"file_url": "", "other": 3},
    ]
    short_map = {"https://example.com/a.pdf": "https://swalakshya.me/su/abc"}
    result = _apply_short_urls(items, short_map)

    assert result[0]["file_url"] == "https://swalakshya.me/su/abc"
    assert result[1]["file_url"] == ""
    assert result[2]["file_url"] == ""
