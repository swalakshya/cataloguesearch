"""
Open, validate and save a whole config.json or scan_config.json file, as raw text.

Unlike scan_config_edit.py (which changes one value or a few sub-sections in place, keeping the rest of the file
byte-for-byte), this is the "open it in a text box and save" escape hatch PDF Parser's popups use: whatever text
comes back is written verbatim, once it parses as a JSON object, so any formatting you type is exactly what lands
on disk. Restricted to a git checkout of the configs repo, same as scan_config_edit.py, and refuses to overwrite
a file that changed since it was opened.
"""
import hashlib
import json
import os
import tempfile
from typing import Any, Dict, List, Optional

from backend.common._json_scanner import _Node, _parse
from backend.common.scan_config import scan_config_source_path

# "scan_config": the file get_scan_config actually reads this PDF's own entry from (may not exist yet, in which
#   case it would be created in the PDF's own folder).
# "config": the config.json in the PDF's own folder (get_merged_config merges every ancestor folder's config.json,
#   but this is the one this PDF's folder itself owns).
KINDS = ("scan_config", "config")
MAX_BYTES = 2 * 1024 * 1024  # generous for a hand-edited config; keeps a runaway paste from being written


class EditRefused(Exception):
    """The edit was not made. `status` maps to an HTTP status (403 not allowed, 404 unknown kind, 409 stale, 422 invalid)."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


EMPTY_HASH = _sha("")


def target_path(kind: str, file_path: str, base_pdf_folder: str) -> str:
    """The one physical file this PDF's config/scan_config edits apply to. May not exist yet."""
    if kind == "scan_config":
        return scan_config_source_path(file_path, base_pdf_folder) or os.path.join(os.path.dirname(file_path), "scan_config.json")
    if kind == "config":
        return os.path.join(os.path.dirname(file_path), "config.json")
    raise EditRefused(404, f"Unknown kind: {kind}")


def _repo_reason(path: str, edit_root: Optional[str]) -> str:
    """'' if `path` is safely inside a git checkout of the configs repo, else why it isn't."""
    if not edit_root or not os.path.isdir(os.path.join(edit_root, ".git")):
        return "Read-only: the configs are not in a git checkout of the configs repo."
    root_real, target_real = os.path.realpath(edit_root), os.path.realpath(path)
    if target_real != root_real and not target_real.startswith(root_real + os.sep):
        return "Read-only: this file is not in the configs repo."
    return ""


def describe(kind: str, file_path: str, base_pdf_folder: str, edit_root: Optional[str]) -> Dict[str, Any]:
    """Where the file is and whether it may be saved. Never raises."""
    path = target_path(kind, file_path, base_pdf_folder)
    reason = _repo_reason(path, edit_root)
    return {
        "kind": kind, "file": os.path.relpath(path, base_pdf_folder),
        "exists": os.path.isfile(path), "editable": not reason, "reason": reason,
    }


def read(kind: str, file_path: str, base_pdf_folder: str) -> Dict[str, Any]:
    """The file's current text and a hash of it, to hand back unchanged on save (staleness check)."""
    path = target_path(kind, file_path, base_pdf_folder)
    if not os.path.isfile(path):
        return {"text": "{}\n", "hash": EMPTY_HASH, "exists": False}
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    return {"text": text, "hash": _sha(text), "exists": True}


def write(kind: str, file_path: str, base_pdf_folder: str, edit_root: Optional[str], *, text: str, expected_hash: str) -> Dict[str, Any]:
    """Validates `text` and writes it verbatim. Refuses if the file is not editable, isn't valid JSON, or changed
    on disk since `expected_hash` was read."""
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise EditRefused(422, f"That's larger than the {MAX_BYTES // (1024 * 1024)} MB limit for this editor.")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise EditRefused(422, f"Not valid JSON: {exc.msg} (line {exc.lineno}, column {exc.colno}).") from exc
    if not isinstance(parsed, dict):
        raise EditRefused(422, "The file must be a JSON object ({...}), not a list or a bare value.")

    path = target_path(kind, file_path, base_pdf_folder)
    reason = _repo_reason(path, edit_root)
    if reason:
        raise EditRefused(403, reason)

    exists = os.path.isfile(path)
    current = ""
    if exists:
        with open(path, "r", encoding="utf-8") as fh:
            current = fh.read()
    if _sha(current) != expected_hash:
        raise EditRefused(409, "The file changed on disk since you opened it. Reopen it to see the latest version.")

    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{os.path.basename(path)}.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        if exists:
            os.chmod(tmp, os.stat(path).st_mode & 0o7777)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return {"text": text, "hash": _sha(text), "exists": True}


def _write_atomically(path: str, text: str, existed: bool) -> None:
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{os.path.basename(path)}.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        if existed:
            os.chmod(tmp, os.stat(path).st_mode & 0o7777)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


# ---------------------------------------------------------------------------------------------------------------
# set_controls: PDF Parser's "Save" button. Writes several top-level keys (crop, language, ocr_engine, multi_page,
# ...) into the PDF's own entry in scan_config.json -- the fields the OCR/crop/language controls represent --
# leaving sub_sections, header_prefix and everything else in the file exactly as they were. Unlike write() above,
# this is surgical: an existing key's value is replaced in place (so a hand-formatted file keeps its formatting
# apart from that one value), and only a genuinely new key, or a brand-new entry, is written with plain
# json.dumps formatting, since there is nothing existing there to preserve.
# ---------------------------------------------------------------------------------------------------------------

def _entry_key(file_path: str) -> str:
    return os.path.splitext(os.path.basename(file_path))[0]


def _indent_of(text: str, pos: int, default: str = "    ") -> str:
    """The leading whitespace of the line containing `pos`, or `default` if that line starts at column 0."""
    line_start = text.rfind("\n", 0, pos) + 1
    i = line_start
    while i < len(text) and text[i] in " \t":
        i += 1
    return text[line_start:i] or default


def _key_start(text: str, window_start: int, window_end: int) -> int:
    """The start (opening quote) of the one quoted key inside `text[window_start:window_end]`."""
    i = window_start
    while i < window_end and text[i] != '"':
        i += 1
    if i >= window_end:
        raise EditRefused(422, "Could not read the scan_config.json: expected a key here.")
    return i


def _member_bounds(text: str, obj: _Node, key: str) -> Any:
    """(key_start, value_end, previous_value_end_or_None, next_key_start_or_None) for `key` inside object `obj`,
    ordered by where each member actually sits in the text (not dict insertion order, which can differ after an
    earlier edit reordered nothing but a Python dict still remembers original insertion order)."""
    ordered = sorted(obj.value.items(), key=lambda kv: kv[1].start)
    idx = next((i for i, (k, _) in enumerate(ordered) if k == key), None)
    if idx is None:
        raise KeyError(key)
    window_start = ordered[idx - 1][1].end if idx > 0 else obj.start + 1
    key_start = _key_start(text, window_start, ordered[idx][1].start)
    value_end = ordered[idx][1].end
    prev_end = ordered[idx - 1][1].end if idx > 0 else None
    next_key_start = None
    if idx < len(ordered) - 1:
        next_window_start = value_end
        next_key_start = _key_start(text, next_window_start, ordered[idx + 1][1].start)
    return key_start, value_end, prev_end, next_key_start


def _cut_member(text: str, obj: _Node, key: str) -> str:
    """Removes `"key": value` from `obj`'s text, together with one neighbouring comma and its whitespace."""
    key_start, value_end, prev_end, next_key_start = _member_bounds(text, obj, key)
    if next_key_start is not None:
        return text[:key_start] + text[next_key_start:]
    if prev_end is not None:
        return text[:prev_end] + text[value_end:]
    return text[:key_start] + text[value_end:]


def _replace_member(text: str, obj: _Node, key: str, value: Any) -> str:
    """Replaces just `key`'s value text with `json.dumps(value)`, keeping everything else -- including the key's
    own formatting -- untouched."""
    node = obj.value[key]
    return text[:node.start] + json.dumps(value, ensure_ascii=False) + text[node.end:]


def _last_member_end(obj: _Node) -> int:
    return max(node.end for node in obj.value.values())


def _insert_members(text: str, obj: _Node, values: Dict[str, Any]) -> str:
    """Adds keys that are not in `obj` yet, right after its last existing member (so the closing brace's own line
    is untouched), or as its first and only members if it was empty. Formatted plainly (there is nothing existing
    at that spot to preserve), indented one level deeper than the object itself."""
    if not values:
        return text
    if obj.value:
        any_key_start, _, _, _ = _member_bounds(text, obj, next(iter(obj.value)))
        indent = _indent_of(text, any_key_start)
        pieces = ",\n".join(f'{indent}"{k}": {json.dumps(v, ensure_ascii=False)}' for k, v in values.items())
        insert_at = _last_member_end(obj)
        return text[:insert_at] + ",\n" + pieces + text[insert_at:]
    indent = _indent_of(text, obj.start) + "    "
    pieces = ",\n".join(f'{indent}"{k}": {json.dumps(v, ensure_ascii=False)}' for k, v in values.items())
    close = obj.end - 1
    return text[:close] + "\n" + pieces + f"\n{_indent_of(text, obj.start)}" + text[close:]


def _entry_object(text: str, entry_key: str) -> _Node:
    try:
        root = _parse(text, 0)
    except (ValueError, IndexError) as exc:
        raise EditRefused(422, f"Could not read the scan_config.json: {exc}") from exc
    if root.kind != "obj":
        raise EditRefused(422, "The file must be a JSON object ({...}).")
    entry = root.value.get(entry_key)
    if entry is None or entry.kind != "obj":
        raise EditRefused(422, f"'{entry_key}' in this file is not a JSON object.")
    return entry


def _verify_only_this_entry_changed(old_text: str, new_text: str, entry_key: str, expected_entry: Dict[str, Any]) -> None:
    before = json.loads(old_text) if old_text.strip() else {}
    try:
        after = json.loads(new_text)
    except json.JSONDecodeError as exc:
        raise EditRefused(422, f"Internal check failed: the result is not valid JSON ({exc}). Nothing was changed.") from exc
    if after.get(entry_key) != expected_entry:
        raise EditRefused(422, "Internal check failed: the result is not what was expected. Nothing was changed.")
    before.setdefault(entry_key, {})
    after[entry_key] = before[entry_key]
    if after != before:
        raise EditRefused(422, "Internal check failed: the edit would change more than this file's own entry for this PDF. Nothing was changed.")


def set_controls(
    file_path: str,
    base_pdf_folder: str,
    edit_root: Optional[str],
    *,
    values: Dict[str, Any],
    remove_keys: List[str] = (),
    expected_hash: str,
) -> Dict[str, Any]:
    """
    Writes `values` (e.g. {"crop": {...}, "language": "hi", "ocr_engine": "llm", "multi_page": False}) into the
    PDF's own entry, and removes any of `remove_keys` that are present and not also in `values` (e.g. "llm_model"
    when switching back to Tesseract). Creates the entry, or the whole file, if either is missing. Refuses if the
    file changed on disk since `expected_hash` was read.
    """
    overlap = set(values) & set(remove_keys)
    if overlap:
        raise EditRefused(422, f"Cannot both set and remove: {', '.join(sorted(overlap))}.")
    if not values and not remove_keys:
        raise EditRefused(422, "Nothing to save.")

    path = target_path("scan_config", file_path, base_pdf_folder)
    reason = _repo_reason(path, edit_root)
    if reason:
        raise EditRefused(403, reason)
    entry_key = _entry_key(file_path)

    exists = os.path.isfile(path)
    text = ""
    if exists:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    if _sha(text) != expected_hash:
        raise EditRefused(409, "The file changed on disk since you opened it. Reopen it to see the latest version.")

    root_text = text if text.strip() else "{}"
    try:
        root = _parse(root_text, 0)
    except (ValueError, IndexError) as exc:
        raise EditRefused(422, f"Could not read the scan_config.json: {exc}") from exc
    if root.kind != "obj":
        raise EditRefused(422, "The file must be a JSON object ({...}).")

    if entry_key not in root.value:
        if root.value:
            any_key_start, _, _, _ = _member_bounds(root_text, root, next(iter(root.value)))
            indent = _indent_of(root_text, any_key_start)
        else:
            indent = "    "  # a brand-new (or previously empty) file: nothing to match, so use plain 4-space style
        new_entry = json.dumps(values, indent=indent, ensure_ascii=False)
        new_entry = (f"\n{indent}").join(new_entry.split("\n"))  # nest one level under the top-level object
        insertion = f'"{entry_key}": {new_entry}'
        if root.value:
            insert_at = _last_member_end(root)
            new_text = root_text[:insert_at] + f',\n{indent}{insertion}' + root_text[insert_at:]
        else:
            new_text = root_text[:root.end - 1] + f'\n{indent}{insertion}\n' + root_text[root.end - 1:]
    else:
        entry = _entry_object(root_text, entry_key)
        to_remove = [k for k in remove_keys if k in entry.value]
        to_replace = {k: v for k, v in values.items() if k in entry.value}
        to_insert = {k: v for k, v in values.items() if k not in entry.value}

        edited = root_text
        for start, end, new_val in sorted(
                ((entry.value[k].start, entry.value[k].end, json.dumps(v, ensure_ascii=False)) for k, v in to_replace.items()),
                key=lambda e: e[0], reverse=True):
            edited = edited[:start] + new_val + edited[end:]

        for key in to_remove:
            entry = _entry_object(edited, entry_key)
            edited = _cut_member(edited, entry, key)

        entry = _entry_object(edited, entry_key)
        new_text = _insert_members(edited, entry, to_insert)

    expected_entry = {**json.loads(root_text).get(entry_key, {}), **values}
    for key in remove_keys:
        expected_entry.pop(key, None)
    _verify_only_this_entry_changed(root_text, new_text, entry_key, expected_entry)

    _write_atomically(path, new_text, exists)
    return {"file": os.path.relpath(path, base_pdf_folder), "entry": json.loads(new_text)[entry_key], "hash": _sha(new_text)}
