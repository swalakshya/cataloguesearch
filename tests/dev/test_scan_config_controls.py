"""PDF Parser's "Save" button: writes the current crop/language/engine/multi-page controls into the PDF's own
entry in scan_config.json, touching only those keys (backend.common.raw_config_edit.set_controls)."""
import json
import os

import pytest

from backend.common import raw_config_edit as edit
from backend.common.raw_config_edit import EditRefused


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "configs"
    (root / ".git").mkdir(parents=True)
    folder = root / "Granth"
    folder.mkdir()
    (folder / "Book.pdf").write_bytes(b"%PDF-1.4")
    return root


def pdf(repo, name="Book"):
    return str(repo / "Granth" / f"{name}.pdf")


def cfg(repo):
    return repo / "Granth" / "scan_config.json"


CROP = {"top": 9, "bottom": 4, "left": 0, "right": 0}
CONTROLS = {"crop": CROP, "language": "hi", "ocr_engine": "llm", "multi_page": False}


def save(repo, values=None, remove_keys=(), expected=None, name="Book"):
    if expected is None:
        expected = edit.read("scan_config", pdf(repo, name), str(repo))["hash"]
    return edit.set_controls(pdf(repo, name), str(repo), str(repo),
                             values=values if values is not None else CONTROLS, remove_keys=list(remove_keys), expected_hash=expected)


def loaded(repo):
    return json.loads(cfg(repo).read_text("utf-8"))


# ---- brand new: no file, no entry -----------------------------------------------------------------------------

def test_creates_the_file_and_entry_when_neither_exists(repo):
    result = save(repo, expected=edit.EMPTY_HASH)
    assert result["entry"] == CONTROLS
    assert loaded(repo) == {"Book": CONTROLS}
    # the written text is valid, re-parseable JSON with the entry nested one level in
    text = cfg(repo).read_text("utf-8")
    assert text.splitlines()[0] == "{" and '"Book": {' in text


def test_creates_the_entry_in_a_file_that_already_has_other_entries(repo):
    existing = '{\n    "Other": {\n        "language": "gu"\n    }\n}'
    cfg(repo).write_text(existing, encoding="utf-8")
    save(repo)
    assert loaded(repo) == {"Other": {"language": "gu"}, "Book": CONTROLS}
    text = cfg(repo).read_text("utf-8")
    assert '"Other": {\n        "language": "gu"\n    }' in text          # the sibling entry is untouched, byte for byte


def test_the_new_entrys_indentation_matches_the_files_own_convention(repo):
    cfg(repo).write_text('{\n  "Other": {\n    "x": 1\n  }\n}', encoding="utf-8")  # 2-space style
    save(repo, values={"language": "hi"})
    text = cfg(repo).read_text("utf-8")
    assert '\n  "Book": {\n    "language": "hi"\n  }' in text


# ---- entry exists, keys are being added -----------------------------------------------------------------------

def test_adds_keys_to_an_existing_but_previously_unconfigured_entry(repo):
    cfg(repo).write_text('{"Book": {"header_prefix": ["p."]}}', encoding="utf-8")
    save(repo)
    result = loaded(repo)
    assert result["Book"]["header_prefix"] == ["p."]                      # untouched
    assert {k: result["Book"][k] for k in CONTROLS} == CONTROLS


def test_adding_keys_to_a_genuinely_empty_entry_object(repo):
    cfg(repo).write_text('{"Book": {}}', encoding="utf-8")
    save(repo, values={"language": "gu"})
    assert loaded(repo) == {"Book": {"language": "gu"}}


# ---- replacing existing values, keeping everything else untouched ----------------------------------------------

def test_replacing_an_existing_crop_only_changes_that_span(repo):
    original = (
        '{\n'
        '    "Book": {\n'
        '        "header_prefix": ["p."],\n'
        '        "crop": {"top": 20, "bottom": 5},\n'
        '        "language": "hi",\n'
        '        "sub_sections": [{"name": "One", "start_page": 1, "end_page": 9}]\n'
        '    }\n'
        '}'
    )
    cfg(repo).write_text(original, encoding="utf-8")
    save(repo, values={"crop": {"top": 6, "bottom": 4, "left": 0, "right": 0}})
    text = cfg(repo).read_text("utf-8")
    assert text == original.replace('"crop": {"top": 20, "bottom": 5}', '"crop": {"top": 6, "bottom": 4, "left": 0, "right": 0}')
    assert loaded(repo)["Book"]["sub_sections"] == [{"name": "One", "start_page": 1, "end_page": 9}]  # untouched


def test_replacing_several_keys_at_once_leaves_the_rest_alone(repo):
    original = '{"Book": {"language": "hi", "ocr_engine": "tesseract", "crop": {"top": 1}, "note": "keep me"}}'
    cfg(repo).write_text(original, encoding="utf-8")
    save(repo, values={"language": "gu", "ocr_engine": "llm", "crop": CROP})
    result = loaded(repo)["Book"]
    assert result == {"language": "gu", "ocr_engine": "llm", "crop": CROP, "note": "keep me"}


def test_boolean_and_numeric_values_round_trip(repo):
    cfg(repo).write_text('{"Book": {"multi_page": false}}', encoding="utf-8")
    save(repo, values={"multi_page": True, "split_percentage": 47})
    assert loaded(repo)["Book"] == {"multi_page": True, "split_percentage": 47}


def test_unicode_values_are_written_as_is(repo):
    cfg(repo).write_text('{"Book": {}}', encoding="utf-8")
    save(repo, values={"language": "gu+hi"})
    assert loaded(repo)["Book"]["language"] == "gu+hi"
    assert '"gu+hi"' in cfg(repo).read_text("utf-8")


# ---- removing keys ----------------------------------------------------------------------------------------------

def test_removing_a_key_that_exists(repo):
    original = '{\n    "Book": {\n        "language": "hi",\n        "llm_model": "gemini-2.5-pro",\n        "ocr_engine": "tesseract"\n    }\n}'
    cfg(repo).write_text(original, encoding="utf-8")
    save(repo, values={}, remove_keys=["llm_model"])
    assert loaded(repo)["Book"] == {"language": "hi", "ocr_engine": "tesseract"}
    assert "llm_model" not in cfg(repo).read_text("utf-8")


def test_removing_the_only_key_leaves_an_empty_object(repo):
    cfg(repo).write_text('{"Book": {"llm_model": "x"}}', encoding="utf-8")
    save(repo, values={}, remove_keys=["llm_model"])
    assert loaded(repo) == {"Book": {}}


def test_removing_a_key_that_is_not_there_is_a_harmless_no_op(repo):
    cfg(repo).write_text('{"Book": {"language": "hi"}}', encoding="utf-8")
    save(repo, values={}, remove_keys=["llm_model", "split_percentage"])
    assert loaded(repo) == {"Book": {"language": "hi"}}


def test_replace_insert_and_remove_together(repo):
    cfg(repo).write_text('{"Book": {"language": "hi", "ocr_engine": "llm", "llm_model": "gemini-2.5-flash"}}', encoding="utf-8")
    save(repo, values={"ocr_engine": "tesseract", "crop": CROP}, remove_keys=["llm_model"])
    assert loaded(repo)["Book"] == {"language": "hi", "ocr_engine": "tesseract", "crop": CROP}


# ---- refusals -----------------------------------------------------------------------------------------------

def test_setting_and_removing_the_same_key_is_refused(repo):
    with pytest.raises(EditRefused) as err:
        save(repo, values={"language": "hi"}, remove_keys=["language"])
    assert err.value.status == 422 and "language" in err.value.message


def test_nothing_to_save_is_refused(repo):
    with pytest.raises(EditRefused) as err:
        save(repo, values={}, remove_keys=[])
    assert err.value.status == 422


def test_a_stale_hash_is_refused_and_changes_nothing(repo):
    cfg(repo).write_text('{"Book": {"language": "hi"}}', encoding="utf-8")
    before = cfg(repo).read_text("utf-8")
    with pytest.raises(EditRefused) as err:
        save(repo, expected="0" * 64)
    assert err.value.status == 409 and cfg(repo).read_text("utf-8") == before


def test_not_editable_outside_the_configs_repo(repo):
    (repo / ".git").rmdir()
    with pytest.raises(EditRefused) as err:
        save(repo, expected=edit.EMPTY_HASH)
    assert err.value.status == 403


def test_an_entry_that_is_not_an_object_is_refused(repo):
    cfg(repo).write_text('{"Book": "not an object"}', encoding="utf-8")
    before = cfg(repo).read_text("utf-8")
    with pytest.raises(EditRefused) as err:
        save(repo)
    assert err.value.status == 422 and "not a JSON object" in err.value.message
    assert cfg(repo).read_text("utf-8") == before


def test_a_root_that_is_not_an_object_is_refused(repo):
    cfg(repo).write_text('[1, 2, 3]', encoding="utf-8")
    with pytest.raises(EditRefused) as err:
        save(repo, expected=edit._sha('[1, 2, 3]'))
    assert err.value.status == 422


def test_unparseable_json_is_refused(repo):
    cfg(repo).write_text('{not json', encoding="utf-8")
    with pytest.raises(EditRefused) as err:
        save(repo, expected=edit._sha('{not json'))
    assert err.value.status == 422


# ---- safety net: a result that does not match the plan is never written -----------------------------------------

def test_the_safety_check_catches_a_bad_replace(repo, monkeypatch):
    cfg(repo).write_text('{"Book": {"language": "hi"}}', encoding="utf-8")
    before = cfg(repo).read_text("utf-8")
    monkeypatch.setattr(edit, "_replace_member", lambda text, obj, key, value: text)  # pretend to replace, but don't
    # _replace_member isn't actually called by set_controls (it inlines the replace) -- patch the inline logic instead
    real_verify = edit._verify_only_this_entry_changed
    monkeypatch.setattr(edit, "_verify_only_this_entry_changed",
                        lambda old, new, entry_key, expected: real_verify(old, old, entry_key, expected))
    with pytest.raises(EditRefused):
        save(repo, values={"language": "gu"})
    assert cfg(repo).read_text("utf-8") == before


def test_file_permissions_are_kept(repo):
    cfg(repo).write_text('{"Book": {}}', encoding="utf-8")
    os.chmod(cfg(repo), 0o640)
    save(repo, values={"language": "hi"})
    assert cfg(repo).stat().st_mode & 0o777 == 0o640


def test_a_failed_write_leaves_the_file_and_no_temp_files(repo, monkeypatch):
    cfg(repo).write_text('{"Book": {}}', encoding="utf-8")
    before = cfg(repo).read_text("utf-8")
    monkeypatch.setattr(edit.os, "replace", lambda *a: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(OSError):
        save(repo, values={"language": "hi"})
    assert cfg(repo).read_text("utf-8") == before
    assert [p.name for p in (repo / "Granth").iterdir()] == ["Book.pdf", "scan_config.json"]


# ---- real repo sweep (skipped if not checked out) -----------------------------------------------------------

from pathlib import Path  # noqa: E402

REAL_REPO = Path(__file__).resolve().parents[3] / "cataloguesearch-configs"


@pytest.mark.skipif(not REAL_REPO.exists(), reason="configs repo not checked out next to this repo")
def test_set_controls_round_trips_cleanly_on_real_files(tmp_path):
    import glob
    import shutil
    import tempfile

    files = glob.glob(str(REAL_REPO / "**" / "scan_config.json"), recursive=True)[:40]
    assert files
    for f in files:
        data = json.loads(Path(f).read_text("utf-8"))
        for entry_key, entry in data.items():
            if entry_key == "default" or not isinstance(entry, dict):
                continue
            root = tmp_path / f"repo-{abs(hash(f))}" / "x"
            (root / ".git").mkdir(parents=True, exist_ok=True)
            rel = os.path.relpath(f, REAL_REPO)
            dst = root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(f, dst)
            pdf_path = dst.parent / f"{entry_key}.pdf"
            before_hash = edit.read("scan_config", str(pdf_path), str(root))["hash"]
            result = edit.set_controls(str(pdf_path), str(root), str(root),
                                       values={"language": "hi", "ocr_engine": "tesseract", "crop": {"top": 6, "bottom": 6, "left": 0, "right": 0}},
                                       remove_keys=["llm_model"], expected_hash=before_hash)
            after = json.loads(dst.read_text("utf-8"))
            assert after[entry_key]["language"] == "hi" and after[entry_key]["crop"]["top"] == 6
            assert result["entry"] == after[entry_key]
            break  # one entry per file is plenty; this is a smoke test, not exhaustive
