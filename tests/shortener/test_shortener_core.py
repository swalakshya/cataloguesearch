import hashlib

from backend.url_shortener.core import base62_encode, build_maps, code_for_url


def test_base62_encode_known_values():
    assert base62_encode(0) == "0"
    assert base62_encode(61) == "z"
    assert base62_encode(62) == "10"


def test_code_for_url_is_deterministic():
    url = "https://example.com/a.pdf"
    code1 = code_for_url(url, length=7)
    code2 = code_for_url(url, length=7)
    assert code1 == code2
    assert len(code1) == 7


def test_build_maps_extends_length_on_collision():
    # Force collision by returning the same digest for two different URLs.
    fixed_digest = hashlib.sha256(b"same").digest()

    def fake_hash_fn(_url: str) -> bytes:
        return fixed_digest

    urls = ["https://example.com/a.pdf", "https://example.com/b.pdf"]
    long_to_short, short_to_long = build_maps(urls, base_len=5, max_extra=4, hash_fn=fake_hash_fn)

    assert long_to_short[urls[0]] != long_to_short[urls[1]]
    assert short_to_long[long_to_short[urls[0]]] == urls[0]
    assert short_to_long[long_to_short[urls[1]]] == urls[1]
