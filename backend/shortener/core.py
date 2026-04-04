import hashlib
from typing import Callable, Dict, Iterable, Tuple

_BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def base62_encode(num: int) -> str:
    if num < 0:
        raise ValueError("num must be non-negative")
    if num == 0:
        return "0"
    chars = []
    base = 62
    while num > 0:
        num, rem = divmod(num, base)
        chars.append(_BASE62_ALPHABET[rem])
    return "".join(reversed(chars))


def _hash_bytes(url: str) -> bytes:
    return hashlib.sha256(url.encode("utf-8")).digest()


def _hash_to_base62(url: str, hash_fn: Callable[[str], bytes]) -> str:
    digest = hash_fn(url)
    num = int.from_bytes(digest, "big", signed=False)
    return base62_encode(num)


def code_for_url(url: str, length: int, hash_fn: Callable[[str], bytes] = _hash_bytes) -> str:
    if length <= 0:
        raise ValueError("length must be positive")
    full = _hash_to_base62(url, hash_fn)
    if len(full) >= length:
        return full[:length]
    # Left-pad with zeros to fixed length if extremely short (unlikely for sha256).
    return ("0" * (length - len(full))) + full


def build_maps(
    urls: Iterable[str],
    base_len: int = 7,
    max_extra: int = 4,
    hash_fn: Callable[[str], bytes] = _hash_bytes,
) -> Tuple[Dict[str, str], Dict[str, str]]:
    long_to_short: Dict[str, str] = {}
    short_to_long: Dict[str, str] = {}

    for url in urls:
        if url in long_to_short:
            continue
        code = code_for_url(url, base_len, hash_fn=hash_fn)
        if code in short_to_long and short_to_long[code] != url:
            # Collision: extend length until unique or give up.
            extended = False
            for extra in range(1, max_extra + 1):
                longer = code_for_url(url, base_len + extra, hash_fn=hash_fn)
                if longer not in short_to_long:
                    code = longer
                    extended = True
                    break
            if not extended:
                # Skip if we cannot resolve collision safely.
                continue
        long_to_short[url] = code
        short_to_long[code] = url

    return long_to_short, short_to_long


class ShortenerStore:
    def __init__(self, base_len: int = 7, max_extra: int = 4):
        self._base_len = base_len
        self._max_extra = max_extra
        self._long_to_short: Dict[str, str] = {}
        self._short_to_long: Dict[str, str] = {}

    @property
    def long_to_short(self) -> Dict[str, str]:
        return self._long_to_short

    @property
    def short_to_long(self) -> Dict[str, str]:
        return self._short_to_long

    def load(self, urls: Iterable[str]) -> None:
        self._long_to_short, self._short_to_long = build_maps(
            urls, base_len=self._base_len, max_extra=self._max_extra
        )

    def get_code(self, url: str) -> str | None:
        return self._long_to_short.get(url)

    def get_url(self, code: str) -> str | None:
        return self._short_to_long.get(code)
