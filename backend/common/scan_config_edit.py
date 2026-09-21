"""
Edits the sub-sections of a scan_config.json in place: change a start/end page, remove sub-sections, or merge
neighbouring ones into one.

The configs repo holds hand-formatted files, so the file is never re-serialised: the affected values or array items
are found in the original text and only those characters are replaced or cut. Everything else (indentation, inline
arrays, key order, line endings, a missing final newline) stays byte for byte, and git shows a small change.
"""
import hashlib
import json
import os
import re
import tempfile
from json.decoder import scanstring
from typing import Any, Dict, List, Optional, Tuple

from backend.common.scan_config import scan_config_source_path


class EditRefused(Exception):
    """The edit was not made. `status` maps to an HTTP status (403 not allowed, 404 not found, 409 stale, 422 invalid)."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


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


def _sub_section(root: _Node, entry_key: str, index: int) -> Dict[str, _Node]:
    entry = root.value.get(entry_key) if root.kind == "obj" else None
    if entry is None or entry.kind != "obj":
        raise EditRefused(404, f"This file has no entry for '{entry_key}'.")
    subs = entry.value.get("sub_sections")
    if subs is None or subs.kind != "arr":
        raise EditRefused(404, f"'{entry_key}' has no sub_sections in this file.")
    if not 0 <= index < len(subs.value) or subs.value[index].kind != "obj":
        raise EditRefused(409, "That sub-section is no longer in the file. Reopen the file.")
    return subs.value[index].value


def sub_sections_source(file_path: str, base_pdf_folder: str, edit_root: Optional[str]) -> Dict[str, Any]:
    """
    Says where a PDF's sub_sections come from and whether they may be edited: only when they are written in the
    file's own entry of a scan_config.json inside the configs repo (`edit_root`, which must be a git checkout).
    """
    return _inspect(file_path, base_pdf_folder, edit_root)[0]


def _inspect(file_path: str, base_pdf_folder: str, edit_root: Optional[str]) -> Tuple[Dict[str, Any], Optional[str]]:
    """(the answer of sub_sections_source, the absolute path of the scan_config.json it is about)."""
    source = scan_config_source_path(file_path, base_pdf_folder)
    entry_key = os.path.splitext(os.path.basename(file_path))[0]
    result: Dict[str, Any] = {"editable": False, "reason": "", "entry_key": entry_key, "file": None}
    if not source:
        result["reason"] = "This file has no scan_config.json."
        return result, None
    result["file"] = os.path.relpath(source, os.path.realpath(base_pdf_folder))
    if not edit_root or not os.path.isdir(os.path.join(edit_root, ".git")):
        result["reason"] = "Read-only: the configs are not in a git checkout of the configs repo."
        return result, source
    root_real, source_real = os.path.realpath(edit_root), os.path.realpath(source)
    if not source_real.startswith(root_real + os.sep):
        result["reason"] = "Read-only: this scan_config.json is not in the configs repo."
        return result, source
    try:
        with open(source, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        result["reason"] = "Read-only: this scan_config.json could not be read."
        return result, source
    if not isinstance(data.get(entry_key), dict) or not isinstance(data[entry_key].get("sub_sections"), list):
        result["reason"] = "Read-only: the sub-sections are not written in this file's own entry."
        return result, source
    result["editable"] = True
    return result, source


def set_sub_section_page(
    file_path: str,
    base_pdf_folder: str,
    edit_root: Optional[str],
    *,
    index: int,
    which: str,
    page: int,
    expect: Dict[str, Any],
    num_pages: int,
) -> Tuple[str, list]:
    """
    Sets `start_page` or `end_page` of sub-section `index` to `page`. Returns (scan_config path, new sub_sections).
    Refuses unless the file, the section (name, field) and its current page still match what the caller was
    showing, so an edit can never land on a different sub-section than the one on screen.
    """
    if which not in ("start", "end"):
        raise EditRefused(422, "which must be 'start' or 'end'.")
    if isinstance(page, bool) or not isinstance(page, int) or not 1 <= page <= num_pages:
        raise EditRefused(422, f"Page must be between 1 and {num_pages}.")
    source, path = _inspect(file_path, base_pdf_folder, edit_root)
    if not source["editable"]:
        raise EditRefused(403, source["reason"])
    key = f"{which}_page"

    with open(path, "r", encoding="utf-8", newline="") as fh:
        text = fh.read()
    try:
        root = _parse(text, 0)
    except (ValueError, IndexError) as exc:
        raise EditRefused(422, f"Could not read the scan_config.json: {exc}") from exc
    section = _sub_section(root, source["entry_key"], index)

    if (section.get("name") and section["name"].value) != expect.get("name") \
            or (section.get("field") and section["field"].value) != expect.get("field"):
        raise EditRefused(409, "The file changed since it was loaded (a different sub-section is at that position). Reopen the file.")
    target = section.get(key)
    if target is None or target.kind != "num" or not isinstance(target.value, int):
        raise EditRefused(422, f"This sub-section has no {key} to change.")
    if target.value != expect.get("page"):
        raise EditRefused(409, f"The file changed since it was loaded ({key} is now {target.value}). Reopen the file.")

    other = section.get("end_page" if which == "start" else "start_page")
    if other is not None and other.kind == "num" and isinstance(other.value, int):
        start, end = (page, other.value) if which == "start" else (other.value, page)
        if start > end:
            raise EditRefused(422, f"start_page ({start}) cannot be after end_page ({end}).")

    new_text = text[:target.start] + str(page) + text[target.end:]
    _verify_only_that_number_changed(text, new_text, source["entry_key"], index, key, page)
    _write_atomically(path, new_text)
    return path, json.loads(new_text)[source["entry_key"]]["sub_sections"]


def _verify_only_that_number_changed(old: str, new: str, entry_key: str, index: int, key: str, page: int) -> None:
    """Belt and braces: the new text must parse, and differ from the old parse in exactly that one value."""
    before, after = json.loads(old), json.loads(new)
    if after[entry_key]["sub_sections"][index][key] != page:
        raise EditRefused(422, "Internal check failed: the page was not written where expected. Nothing was changed.")
    after[entry_key]["sub_sections"][index][key] = before[entry_key]["sub_sections"][index][key]
    if after != before:
        raise EditRefused(422, "Internal check failed: the edit would change more than one value. Nothing was changed.")


def _write_atomically(path: str, text: str) -> None:
    directory = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=".scan_config.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        os.chmod(tmp, os.stat(path).st_mode & 0o7777)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


# ---------------------------------------------------------------------------------------------------------------
# Removing and merging sub-sections
# ---------------------------------------------------------------------------------------------------------------

# What the last remove / merge replaced, per file: path -> (sha256 of the text we wrote, the text before).
# Undo puts the old text back, but only while the file is still exactly what we wrote.
_LAST_STRUCTURAL_EDIT: Dict[str, Tuple[str, str]] = {}
_MAX_NAME = 200


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _value(section: Dict[str, _Node], key: str) -> Any:
    node = section.get(key)
    return node.value if node is not None and node.kind in ("str", "num", "lit") else None


def _load_for_edit(file_path: str, base_pdf_folder: str, edit_root: Optional[str]) -> Tuple[Dict[str, Any], str, str]:
    source, path = _inspect(file_path, base_pdf_folder, edit_root)
    if not source["editable"]:
        raise EditRefused(403, source["reason"])
    with open(path, "r", encoding="utf-8", newline="") as fh:
        return source, path, fh.read()


def _sections(text: str, entry_key: str) -> List[_Node]:
    try:
        root = _parse(text, 0)
    except (ValueError, IndexError) as exc:
        raise EditRefused(422, f"Could not read the scan_config.json: {exc}") from exc
    entry = root.value.get(entry_key) if root.kind == "obj" else None
    subs = entry.value.get("sub_sections") if entry is not None and entry.kind == "obj" else None
    if subs is None or subs.kind != "arr":
        raise EditRefused(404, f"'{entry_key}' has no sub_sections in this file.")
    return subs


def _check_refs(subs: _Node, refs: List[Dict[str, Any]]) -> None:
    """Every sub-section the caller named must still be exactly what it was showing (position, name, field, pages)."""
    for ref in refs:
        i = ref["index"]
        if not 0 <= i < len(subs.value) or subs.value[i].kind != "obj":
            raise EditRefused(409, "A sub-section is no longer in the file. Reopen the file.")
        section = subs.value[i].value
        now = (_value(section, "name"), _value(section, "field"), _value(section, "start_page"), _value(section, "end_page"))
        if now != (ref.get("name"), ref.get("field"), ref.get("start_page"), ref.get("end_page")):
            raise EditRefused(409, f"The file changed since it was loaded ('{now[0]}' is not what was on screen). Reopen the file.")


def _cut_item(text: str, subs: _Node, i: int) -> str:
    """Removes array item i together with one neighbouring comma and its whitespace, so the layout stays intact."""
    items = subs.value
    if i < len(items) - 1:
        lo, hi = items[i].start, items[i + 1].start
    else:
        lo, hi = items[i - 1].end, items[i].end
    return text[:lo] + text[hi:]


def _verify_sub_sections_only(old: str, new: str, entry_key: str, expected: list) -> None:
    before, after = json.loads(old), json.loads(new)
    if after[entry_key]["sub_sections"] != expected:
        raise EditRefused(422, "Internal check failed: the result is not what was expected. Nothing was changed.")
    after[entry_key]["sub_sections"] = before[entry_key]["sub_sections"]
    if after != before:
        raise EditRefused(422, "Internal check failed: the edit would change more than the sub-sections. Nothing was changed.")


def _commit(path: str, old: str, new: str) -> None:
    _write_atomically(path, new)
    _LAST_STRUCTURAL_EDIT[path] = (_sha(new), old)


def remove_sub_sections(file_path: str, base_pdf_folder: str, edit_root: Optional[str], *, refs: List[Dict[str, Any]]) -> Tuple[str, list]:
    """Removes the named sub-sections. Returns (scan_config path, new sub_sections)."""
    indices = sorted({r["index"] for r in refs})
    if not indices or len(indices) != len(refs):
        raise EditRefused(422, "Name each sub-section to remove once.")
    source, path, text = _load_for_edit(file_path, base_pdf_folder, edit_root)
    entry_key = source["entry_key"]
    subs = _sections(text, entry_key)
    _check_refs(subs, refs)
    if len(indices) >= len(subs.value):
        raise EditRefused(422, "That would remove every sub-section, and the file would then be indexed as one block. Edit the file by hand if that is what you want.")

    new_text = text
    for i in reversed(indices):                      # from the end, so earlier positions stay valid
        new_text = _cut_item(new_text, _sections(new_text, entry_key), i)
    expected = [s for i, s in enumerate(json.loads(text)[entry_key]["sub_sections"]) if i not in indices]
    _verify_sub_sections_only(text, new_text, entry_key, expected)
    _commit(path, text, new_text)
    return path, expected


def merge_sub_sections(file_path: str, base_pdf_folder: str, edit_root: Optional[str], *, refs: List[Dict[str, Any]], name: str) -> Tuple[str, list]:
    """
    Merges neighbouring sub-sections into the first one: it gets `name`, and runs from its own start to the last one's
    end. The others are removed. Returns (scan_config path, new sub_sections).
    """
    name = (name or "").strip()
    if not name or len(name) > _MAX_NAME:
        raise EditRefused(422, f"Give the merged sub-section a name (up to {_MAX_NAME} characters).")
    indices = [r["index"] for r in refs]
    if len(refs) < 2 or indices != list(range(indices[0], indices[0] + len(indices))):
        raise EditRefused(422, "Only two or more neighbouring sub-sections (next to each other in the file) can be merged.")
    source, path, text = _load_for_edit(file_path, base_pdf_folder, edit_root)
    entry_key = source["entry_key"]
    subs = _sections(text, entry_key)
    _check_refs(subs, refs)

    parts = [subs.value[i].value for i in indices]
    first, last = parts[0], parts[-1]
    for key, what in (("field", "fields"), ("volume", "volumes")):
        if len({json.dumps(_value(p, key)) for p in parts}) > 1:
            raise EditRefused(422, f"These sub-sections have different {what}, so they cannot be merged.")
    if _value(last, "end_page") < _value(first, "start_page"):
        raise EditRefused(422, "The last sub-section ends before the first one starts.")
    edits = [(first["name"], json.dumps(name, ensure_ascii=False)), (first["end_page"], str(_value(last, "end_page")))]
    if ("end_side" in first) != ("end_side" in last):
        raise EditRefused(422, "Only one of these has an end_side (two-page books), so they cannot be merged automatically. Edit the file by hand.")
    if "end_side" in first and _value(first, "end_side") != _value(last, "end_side"):
        edits.append((first["end_side"], json.dumps(_value(last, "end_side"), ensure_ascii=False)))

    new_text = text
    for node, replacement in sorted(edits, key=lambda e: e[0].start, reverse=True):
        new_text = new_text[:node.start] + replacement + new_text[node.end:]
    for i in reversed(indices[1:]):
        new_text = _cut_item(new_text, _sections(new_text, entry_key), i)

    old_list = json.loads(text)[entry_key]["sub_sections"]
    merged = dict(old_list[indices[0]], name=name, end_page=_value(last, "end_page"))
    if "end_side" in last:
        merged["end_side"] = _value(last, "end_side")
    expected = old_list[:indices[0]] + [merged] + old_list[indices[-1] + 1:]
    _verify_sub_sections_only(text, new_text, entry_key, expected)
    _commit(path, text, new_text)
    return path, expected


def undo_last_structural_edit(file_path: str, base_pdf_folder: str, edit_root: Optional[str]) -> Tuple[str, list]:
    """Puts the file back as it was before the last remove / merge, if nothing has touched it since."""
    source, path, current = _load_for_edit(file_path, base_pdf_folder, edit_root)
    remembered = _LAST_STRUCTURAL_EDIT.get(path)
    if remembered is None:
        raise EditRefused(404, "There is nothing to undo for this file (undo only lasts until the dev server restarts).")
    if remembered[0] != _sha(current):
        raise EditRefused(409, "The file has changed since that edit, so it cannot be undone safely. Use git to restore it.")
    _write_atomically(path, remembered[1])
    del _LAST_STRUCTURAL_EDIT[path]
    return path, json.loads(remembered[1])[source["entry_key"]]["sub_sections"]
