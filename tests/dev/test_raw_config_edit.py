"""The "open scan_config.json / config.json as raw text, validate, save" editor behind PDF Parser's edit popups."""
import json
import os

import pytest

from backend.common import raw_config_edit as edit
from backend.common.raw_config_edit import EditRefused


@pytest.fixture
def repo(tmp_path):
    """<repo>/.git plus <repo>/Granth/Book.pdf, its folder's config.json and scan_config.json."""
    root = tmp_path / "configs"
    (root / ".git").mkdir(parents=True)
    folder = root / "Granth"
    folder.mkdir()
    (folder / "Book.pdf").write_bytes(b"%PDF-1.4")
    (folder / "config.json").write_text('{\n    "Anuyog": "Dravyanuyog"\n}', encoding="utf-8")
    (folder / "scan_config.json").write_text('{"Book": {"start_page": 5, "end_page": 20}}', encoding="utf-8")
    return root


def pdf(repo, name="Book"):
    return str(repo / "Granth" / f"{name}.pdf")


# ---- target_path ------------------------------------------------------------------------------------------------

def test_config_target_is_the_pdfs_own_folder(repo):
    assert edit.target_path("config", pdf(repo), str(repo)) == str(repo / "Granth" / "config.json")


def test_scan_config_target_is_the_file_get_scan_config_would_read(repo):
    assert edit.target_path("scan_config", pdf(repo), str(repo)) == str(repo / "Granth" / "scan_config.json")


def test_scan_config_target_falls_back_to_the_pdfs_own_folder_when_none_exists_yet(repo):
    os.remove(repo / "Granth" / "scan_config.json")
    assert edit.target_path("scan_config", pdf(repo), str(repo)) == str(repo / "Granth" / "scan_config.json")


def test_scan_config_target_prefers_the_deepest_existing_file(repo):
    (repo / "scan_config.json").write_text("{}", encoding="utf-8")
    assert edit.target_path("scan_config", pdf(repo), str(repo)) == str(repo / "Granth" / "scan_config.json")


def test_an_unknown_kind_is_refused():
    with pytest.raises(EditRefused) as err:
        edit.target_path("nope", "/x/Book.pdf", "/x")
    assert err.value.status == 404


# ---- describe / read ---------------------------------------------------------------------------------------------

def test_describe_an_editable_existing_file(repo):
    d = edit.describe("config", pdf(repo), str(repo), str(repo))
    assert d == {"kind": "config", "file": os.path.join("Granth", "config.json"), "exists": True, "editable": True, "reason": ""}


def test_describe_a_file_that_does_not_exist_yet_is_still_editable(repo):
    os.remove(repo / "Granth" / "config.json")
    d = edit.describe("config", pdf(repo), str(repo), str(repo))
    assert d["exists"] is False and d["editable"] is True


def test_describe_without_a_git_checkout(repo):
    os.rmdir(repo / ".git")
    d = edit.describe("config", pdf(repo), str(repo), str(repo))
    assert d["editable"] is False and "git checkout" in d["reason"]


def test_describe_outside_the_configs_repo(repo, tmp_path):
    elsewhere = tmp_path / "other-repo"
    (elsewhere / ".git").mkdir(parents=True)
    d = edit.describe("config", pdf(repo), str(repo), str(elsewhere))
    assert d["editable"] is False and "not in the configs repo" in d["reason"]


def test_describe_with_no_root_configured(repo):
    assert edit.describe("config", pdf(repo), str(repo), None)["editable"] is False


def test_read_returns_the_text_and_a_hash(repo):
    r = edit.read("scan_config", pdf(repo), str(repo))
    assert r["exists"] and r["text"] == (repo / "Granth" / "scan_config.json").read_text("utf-8")
    assert r["hash"] == edit._sha(r["text"])


def test_read_a_missing_file_offers_an_empty_object_to_start_from(repo):
    os.remove(repo / "Granth" / "config.json")
    r = edit.read("config", pdf(repo), str(repo))
    assert r["exists"] is False and json.loads(r["text"]) == {} and r["hash"] == edit.EMPTY_HASH


# ---- write ----------------------------------------------------------------------------------------------------

def write(repo, kind="config", text='{"Anuyog": "Charananuyog"}', expected=None, name="Book", root=None):
    if expected is None:
        expected = edit.read(kind, pdf(repo, name), str(repo))["hash"]
    return edit.write(kind, pdf(repo, name), str(repo), root if root is not None else str(repo), text=text, expected_hash=expected)


def test_writes_the_text_back_verbatim(repo):
    text = '{\n  "Anuyog":    "Charananuyog",\n  "extra": [1, 2, 3]\n}\n'
    result = write(repo, text=text)
    assert (repo / "Granth" / "config.json").read_text("utf-8") == text  # not re-formatted
    assert result == {"text": text, "hash": edit._sha(text), "exists": True}


def test_odd_but_valid_json_is_accepted_as_is(repo):
    text = '{"unicode": "अष्टसहस्री", "nested": {"a": [true, null, 1.5]}}'
    write(repo, text=text)
    assert json.loads((repo / "Granth" / "config.json").read_text("utf-8")) == json.loads(text)


def test_creates_the_file_when_it_did_not_exist(repo):
    os.remove(repo / "Granth" / "config.json")
    write(repo, text="{}", expected=edit.EMPTY_HASH)
    assert (repo / "Granth" / "config.json").read_text("utf-8") == "{}"


@pytest.mark.parametrize("bad,msg", [
    ("{not json", "Not valid JSON"),
    ("[1, 2, 3]", "must be a JSON object"),
    ('"just a string"', "must be a JSON object"),
    ("", "Not valid JSON"),
])
def test_invalid_json_is_refused_and_nothing_is_written(repo, bad, msg):
    before = (repo / "Granth" / "config.json").read_text("utf-8")
    with pytest.raises(EditRefused) as err:
        write(repo, text=bad)
    assert err.value.status == 422 and msg in err.value.message
    assert (repo / "Granth" / "config.json").read_text("utf-8") == before


def test_a_stale_hash_is_refused(repo):
    before = (repo / "Granth" / "config.json").read_text("utf-8")
    with pytest.raises(EditRefused) as err:
        write(repo, expected="0" * 64)
    assert err.value.status == 409 and "changed on disk" in err.value.message
    assert (repo / "Granth" / "config.json").read_text("utf-8") == before


def test_expecting_a_file_to_still_be_missing_but_it_now_exists_is_refused(repo):
    with pytest.raises(EditRefused) as err:
        write(repo, expected=edit.EMPTY_HASH)  # config.json already exists in the fixture
    assert err.value.status == 409


def test_not_editable_outside_the_configs_repo_is_refused_even_with_a_correct_hash(repo):
    os.rmdir(repo / ".git")
    with pytest.raises(EditRefused) as err:
        write(repo)
    assert err.value.status == 403


def test_too_large_a_payload_is_refused(repo, monkeypatch):
    monkeypatch.setattr(edit, "MAX_BYTES", 5)
    with pytest.raises(EditRefused) as err:
        write(repo, text='{"a": 1}')
    assert err.value.status == 422 and "MB limit" in err.value.message


def test_file_permissions_are_kept(repo):
    os.chmod(repo / "Granth" / "config.json", 0o640)
    write(repo)
    assert (repo / "Granth" / "config.json").stat().st_mode & 0o777 == 0o640


def test_a_failed_write_leaves_the_file_and_no_temp_files(repo, monkeypatch):
    before = (repo / "Granth" / "config.json").read_text("utf-8")
    monkeypatch.setattr(edit.os, "replace", lambda *a: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(OSError):
        write(repo)
    assert (repo / "Granth" / "config.json").read_text("utf-8") == before
    assert [p.name for p in (repo / "Granth").iterdir()] == ["Book.pdf", "config.json", "scan_config.json"]


def test_scan_config_edits_use_the_same_rules(repo):
    text = '{"Book": {"start_page": 5, "end_page": 21}}'
    write(repo, kind="scan_config", text=text)
    assert (repo / "Granth" / "scan_config.json").read_text("utf-8") == text


def test_a_symlinked_repo_folder_still_works(repo, tmp_path):
    link = tmp_path / "link-to-configs"
    os.symlink(repo, link)
    write(repo, root=str(link))
    assert (repo / "Granth" / "config.json").read_text("utf-8") == '{"Anuyog": "Charananuyog"}'
