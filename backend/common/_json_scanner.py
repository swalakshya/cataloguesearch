"""
A JSON parser that remembers where every value sits in the source text (byte offsets), so callers can replace,
cut or insert one value without re-serialising the rest of the file. Shared by scan_config_edit.py (surgical
edits to sub-sections and control values) and raw_config_edit.py.
"""
import json
import re
from json.decoder import scanstring
from typing import Any, Dict

_WS = " \t\r\n"
_NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?")


class _Node:
    """A parsed JSON value that remembers where it sits in the text."""
    __slots__ = ("kind", "value", "start", "end")

    def __init__(self, kind: str, value: Any, start: int, end: int):
        self.kind, self.value, self.start, self.end = kind, value, start, end


def _skip(text: str, i: int) -> int:
    while i < len(text) and text[i] in _WS:
        i += 1
    return i


def _parse(text: str, i: int) -> _Node:
    i = _skip(text, i)
    ch = text[i]
    if ch == "{":
        members: Dict[str, _Node] = {}
        j = _skip(text, i + 1)
        if text[j] == "}":
            return _Node("obj", members, i, j + 1)
        while True:
            j = _skip(text, j)
            key, j = scanstring(text, j + 1, True)
            j = _skip(text, j)
            if text[j] != ":":
                raise ValueError("expected ':'")
            node = _parse(text, j + 1)
            members[key] = node
            j = _skip(text, node.end)
            if text[j] == ",":
                j += 1
                continue
            if text[j] == "}":
                return _Node("obj", members, i, j + 1)
            raise ValueError("expected ',' or '}'")
    if ch == "[":
        items = []
        j = _skip(text, i + 1)
        if text[j] == "]":
            return _Node("arr", items, i, j + 1)
        while True:
            node = _parse(text, j)
            items.append(node)
            j = _skip(text, node.end)
            if text[j] == ",":
                j += 1
                continue
            if text[j] == "]":
                return _Node("arr", items, i, j + 1)
            raise ValueError("expected ',' or ']'")
    if ch == '"':
        value, end = scanstring(text, i + 1, True)
        return _Node("str", value, i, end)
    m = _NUMBER.match(text, i)
    if m:
        return _Node("num", json.loads(m.group()), i, m.end())
    for word, value in (("true", True), ("false", False), ("null", None)):
        if text.startswith(word, i):
            return _Node("lit", value, i, i + len(word))
    raise ValueError(f"unexpected character at {i}")
