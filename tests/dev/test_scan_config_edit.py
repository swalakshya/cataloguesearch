"""SET in the sub-section verifier: one page number is changed in the configs repo's scan_config.json, nothing else."""
import json
import os
from pathlib import Path

import pytest

from backend.common import scan_config_edit as edit
from backend.common.scan_config import scan_config_source_path
from backend.common.scan_config_edit import EditRefused, set_sub_section_page, sub_sections_source

# Hand-formatted on purpose: inline arrays, odd spacing, unicode, no final newline, like many real files.
HAND_FORMATTED = (
    '{\n'
    '    "default": {\n'
    '        "crop": {"top": 6, "bottom": 17},\n'
    '        "typo_list": [\n'
    '            ["इलोक", "श्लोक"],   \n'
    '            ["परवचन", "प्रवचन"]\n'
    '        ]\n'
    '    },\n'
    '    "Book": {\n'
    '        "start_page": 5,\n'
    '        "sub_sections": [\n'
    '            {"field": "Adhikaar", "name": "One", "start_page": 10, "end_page": 18},\n'
    '            {\n'
    '                "field": "Adhikaar",\n'
    '                "name": "Two",\n'
    '                "start_page": 19,\n'
    '                "end_page": 35\n'
    '            }\n'
    '        ]\n'
    '    }\n'
    '}'
)


@pytest.fixture
def repo(tmp_path):
    """<repo>/.git plus <repo>/Granth/Book.pdf's folder with the hand-formatted scan_config.json."""
    root = tmp_path / "configs"
    (root / ".git").mkdir(parents=True)
    folder = root / "Granth"
    folder.mkdir()
    (folder / "scan_config.json").write_bytes(HAND_FORMATTED.encode("utf-8"))
    return root


def pdf(repo, name="Book"):
    return str(repo / "Granth" / f"{name}.pdf")


def cfg_path(repo):
    return repo / "Granth" / "scan_config.json"


def setpage(repo, index=0, which="start", page=11, name="One", field="Adhikaar", old=10, num_pages=300, **kw):
    return set_sub_section_page(pdf(repo, kw.pop("pdf", "Book")), str(repo), kw.pop("root", str(repo)), index=index, which=which,
                                page=page, expect={"name": name, "field": field, "page": old}, num_pages=num_pages)


def test_only_the_digits_of_that_page_change(repo):
    before = cfg_path(repo).read_bytes()
    _, subs = setpage(repo, which="start", page=11)
    after = cfg_path(repo).read_bytes()
    assert after == before.replace(b'"start_page": 10,', b'"start_page": 11,')      # every other byte identical
    assert subs[0]["start_page"] == 11 and subs[1]["start_page"] == 19
    assert not after.endswith(b"\n")                                                 # no final newline was added


def test_end_page_of_a_multiline_section(repo):
    setpage(repo, index=1, which="end", page=36, name="Two", old=35)
    assert json.loads(cfg_path(repo).read_text("utf-8"))["Book"]["sub_sections"][1]["end_page"] == 36


def test_number_width_can_change(repo):
    setpage(repo, which="start", page=9)
    setpage(repo, which="start", page=10, old=9)
    assert cfg_path(repo).read_bytes() == HAND_FORMATTED.encode("utf-8")             # round trip restores the file exactly


def test_windows_line_endings_are_kept(repo):
    crlf = HAND_FORMATTED.replace("\n", "\r\n").encode("utf-8")
    cfg_path(repo).write_bytes(crlf)
    setpage(repo, which="end", page=19, old=18)
    assert cfg_path(repo).read_bytes() == crlf.replace(b'"end_page": 18', b'"end_page": 19')


@pytest.mark.parametrize("kwargs,status", [
    (dict(name="Wrong"), 409),                 # a different section is at that position now
    (dict(field="Other"), 409),
    (dict(old=99), 409),                       # the page in the file is no longer what was on screen
    (dict(page=19), 422),                      # start would be after end (18)
    (dict(page=0), 422),
    (dict(page=301), 422),                     # outside the PDF
    (dict(which="middle"), 422),
    (dict(index=7), 409),
])
def test_stale_or_invalid_edits_are_refused_and_change_nothing(repo, kwargs, status):
    before = cfg_path(repo).read_bytes()
    with pytest.raises(EditRefused) as err:
        setpage(repo, **kwargs)
    assert err.value.status == status and cfg_path(repo).read_bytes() == before


def test_a_boolean_or_float_page_is_refused(repo):
    for bad in (True, 11.0):
        with pytest.raises(EditRefused):
            setpage(repo, page=bad)


def test_start_may_equal_end(repo):
    setpage(repo, which="start", page=18)


def test_end_may_not_go_before_start(repo):
    with pytest.raises(EditRefused) as err:
        setpage(repo, which="end", page=9, old=18)
    assert err.value.status == 422


def test_section_without_that_page_key_is_refused(repo):
    text = HAND_FORMATTED.replace('"start_page": 10, ', "")
    cfg_path(repo).write_bytes(text.encode("utf-8"))
    with pytest.raises(EditRefused) as err:
        setpage(repo, which="start", page=11)
    assert err.value.status == 422


class TestWhereEditingIsAllowed:
    def test_editable_inside_a_git_checkout(self, repo):
        src = sub_sections_source(pdf(repo), str(repo), str(repo))
        assert src["editable"] and src["file"] == os.path.join("Granth", "scan_config.json")

    def test_not_editable_when_the_root_is_not_a_git_checkout(self, repo):
        os.rmdir(repo / ".git")
        src = sub_sections_source(pdf(repo), str(repo), str(repo))
        assert not src["editable"] and "git checkout" in src["reason"]
        with pytest.raises(EditRefused) as err:
            setpage(repo)
        assert err.value.status == 403

    def test_not_editable_when_the_config_is_outside_the_configs_repo(self, repo, tmp_path):
        elsewhere = tmp_path / "other-repo"
        (elsewhere / ".git").mkdir(parents=True)
        src = sub_sections_source(pdf(repo), str(repo), str(elsewhere))
        assert not src["editable"] and "not in the configs repo" in src["reason"]

    def test_a_symlink_out_of_the_repo_does_not_count(self, repo, tmp_path):
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "scan_config.json").write_bytes(HAND_FORMATTED.encode("utf-8"))
        os.remove(cfg_path(repo))
        os.symlink(outside / "scan_config.json", cfg_path(repo))
        assert not sub_sections_source(pdf(repo), str(repo), str(repo))["editable"]

    def test_not_editable_without_the_files_own_entry(self, repo):
        src = sub_sections_source(pdf(repo, "Other"), str(repo), str(repo))
        assert not src["editable"] and "own entry" in src["reason"]

    def test_no_root_configured_means_read_only(self, repo):
        assert not sub_sections_source(pdf(repo), str(repo), None)["editable"]

    def test_only_the_deepest_scan_config_holds_the_files_entry(self, repo):
        # get_scan_config replaces the data at every level, so a deeper file without the entry hides a shallower one.
        (repo / "scan_config.json").write_bytes(HAND_FORMATTED.encode("utf-8"))
        (repo / "Granth" / "scan_config.json").write_bytes(b'{"default": {}}')
        src = sub_sections_source(pdf(repo), str(repo), str(repo))
        assert not src["editable"] and src["file"] == os.path.join("Granth", "scan_config.json")


class TestSourcePath:
    def test_deepest_wins(self, repo):
        (repo / "scan_config.json").write_text("{}")
        assert scan_config_source_path(pdf(repo), str(repo)) == str(cfg_path(repo))

    def test_outside_the_base_folder_terminates(self, repo, tmp_path):
        assert scan_config_source_path(str(tmp_path / "elsewhere" / "x.pdf"), str(repo)) is None

    def test_none_when_no_folder_has_one(self, repo):
        os.remove(cfg_path(repo))
        assert scan_config_source_path(pdf(repo), str(repo)) is None


def test_a_failed_write_leaves_the_file_and_no_temp_files(repo, monkeypatch):
    before = cfg_path(repo).read_bytes()
    monkeypatch.setattr(edit.os, "replace", lambda *a: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(OSError):
        setpage(repo)
    assert cfg_path(repo).read_bytes() == before
    assert [p.name for p in (repo / "Granth").iterdir()] == ["scan_config.json"]


def test_file_permissions_are_kept(repo):
    os.chmod(cfg_path(repo), 0o640)
    setpage(repo)
    assert cfg_path(repo).stat().st_mode & 0o777 == 0o640


def test_the_safety_check_catches_an_edit_that_would_change_more(repo, monkeypatch):
    # If the text patch ever touched anything but the one number, nothing may be written.
    real = edit._verify_only_that_number_changed
    monkeypatch.setattr(edit, "_verify_only_that_number_changed",
                        lambda old, new, *a: real(old, new.replace('"One"', '"Uno"'), *a))
    before = cfg_path(repo).read_bytes()
    with pytest.raises(EditRefused):
        setpage(repo)
    assert cfg_path(repo).read_bytes() == before


REAL_REPO = Path(__file__).resolve().parents[3] / "cataloguesearch-configs"


@pytest.mark.skipif(not REAL_REPO.exists(), reason="configs repo not checked out next to this repo")
def test_the_scanner_agrees_with_json_on_every_real_scan_config():
    def plain(node):
        return {"obj": lambda n: {k: plain(v) for k, v in n.value.items()},
                "arr": lambda n: [plain(v) for v in n.value]}.get(node.kind, lambda n: n.value)(node)
    files = list(REAL_REPO.rglob("scan_config.json"))
    assert files
    for f in files:
        text = f.read_text("utf-8")
        assert plain(edit._parse(text, 0)) == json.loads(text), f


def test_a_configs_folder_reached_through_a_symlink_still_works(repo, tmp_path):
    link = tmp_path / "link-to-configs"
    os.symlink(repo, link)
    args = dict(index=0, which="start", page=11, expect={"name": "One", "field": "Adhikaar", "page": 10}, num_pages=300)
    path, subs = set_sub_section_page(str(link / "Granth" / "Book.pdf"), str(link), str(link), **args)
    assert subs[0]["start_page"] == 11 and cfg_path(repo).read_bytes() == HAND_FORMATTED.encode("utf-8").replace(b'"start_page": 10,', b'"start_page": 11,')
    assert os.path.realpath(path) == os.path.realpath(cfg_path(repo))


# ---- remove / merge -----------------------------------------------------------------------------------------------

FOUR = (
    '{\n'
    '  "Book": {\n'
    '    "sub_sections": [\n'
    '      {"field": "A", "name": "One", "start_page": 1, "end_page": 9},\n'
    '      {\n'
    '        "field": "A",\n'
    '        "name": "Two",\n'
    '        "start_page": 10,\n'
    '        "end_page": 19\n'
    '      },\n'
    '      {"name": "Three", "field": "A", "end_page": 29, "start_page": 20},\n'
    '      {"field": "A", "name": "Four", "start_page": 30, "end_page": 39}\n'
    '    ],\n'
    '    "crop": {"top": 5}\n'
    '  }\n'
    '}\n'
)
PAGES = {"One": (1, 9), "Two": (10, 19), "Three": (20, 29), "Four": (30, 39)}


def ref(index, name, field="A"):
    start, end = PAGES[name]
    return {"index": index, "name": name, "field": field, "start_page": start, "end_page": end}


def names(repo):
    return [s["name"] for s in json.loads(cfg_path(repo).read_text("utf-8"))["Book"]["sub_sections"]]


@pytest.fixture
def four(repo):
    cfg_path(repo).write_bytes(FOUR.encode("utf-8"))
    return repo


def remove(repo, *refs, **kw):
    return edit.remove_sub_sections(pdf(repo), str(repo), str(repo), refs=list(refs), **kw)


def merge(repo, name, *refs):
    return edit.merge_sub_sections(pdf(repo), str(repo), str(repo), refs=list(refs), name=name)


@pytest.mark.parametrize("which,expected_names", [
    ([(0, "One")], ["Two", "Three", "Four"]),           # first: the item after it moves up
    ([(1, "Two")], ["One", "Three", "Four"]),           # middle, multi-line item
    ([(3, "Four")], ["One", "Two", "Three"]),           # last: the comma before it goes too
    ([(0, "One"), (2, "Three")], ["Two", "Four"]),      # several at once
])
def test_removing_drops_those_sections_and_their_pages_and_keeps_the_layout(four, which, expected_names):
    _, subs = remove(four, *[ref(i, n) for i, n in which])
    assert [s["name"] for s in subs] == expected_names == names(four)
    text = cfg_path(four).read_text("utf-8")
    assert text.endswith('"crop": {"top": 5}\n  }\n}\n') and '"crop": {"top": 5}' in text        # the rest is untouched
    for _, n in which:
        assert f'"name": "{n}"' not in text


def test_removing_the_last_one_leaves_the_previous_item_formatted_as_before(four):
    remove(four, ref(3, "Four"))
    assert cfg_path(four).read_text("utf-8") == FOUR.replace(
        ',\n      {"field": "A", "name": "Four", "start_page": 30, "end_page": 39}', "")


def test_removing_everything_is_refused(four):
    with pytest.raises(EditRefused) as err:
        remove(four, *[ref(i, n) for i, n in enumerate(PAGES)])
    assert err.value.status == 422 and "every sub-section" in err.value.message and cfg_path(four).read_text("utf-8") == FOUR


@pytest.mark.parametrize("bad", [
    {**ref(1, "Two"), "name": "Deux"},                 # not the section that is at that position
    {**ref(1, "Two"), "end_page": 20},                 # its pages changed since it was shown
    {**ref(1, "Two"), "field": "B"},
    {**ref(9, "Two")},                                 # no longer exists
])
def test_removing_something_that_is_not_what_was_on_screen_is_refused(four, bad):
    with pytest.raises(EditRefused) as err:
        remove(four, bad)
    assert err.value.status == 409 and cfg_path(four).read_text("utf-8") == FOUR


def test_the_same_section_named_twice_is_refused(four):
    with pytest.raises(EditRefused):
        remove(four, ref(1, "Two"), ref(1, "Two"))


def test_merging_runs_from_the_first_start_to_the_last_end_under_the_new_name(four):
    _, subs = merge(four, "Two and Three", ref(1, "Two"), ref(2, "Three"))
    assert subs == [
        {"field": "A", "name": "One", "start_page": 1, "end_page": 9},
        {"field": "A", "name": "Two and Three", "start_page": 10, "end_page": 29},
        {"field": "A", "name": "Four", "start_page": 30, "end_page": 39},
    ]
    text = cfg_path(four).read_text("utf-8")
    assert '"name": "One"' in text and '"crop": {"top": 5}' in text and text.endswith("\n")


def test_merging_all_of_them_leaves_one_section(four):
    _, subs = merge(four, "Whole book", *[ref(i, n) for i, n in enumerate(PAGES)])
    assert subs == [{"field": "A", "name": "Whole book", "start_page": 1, "end_page": 39}]


def test_a_unicode_name_is_written_as_is(four):
    merge(four, "अधिकार १ \"क\"", ref(0, "One"), ref(1, "Two"))
    assert 'अधिकार १ \\"क\\"' in cfg_path(four).read_text("utf-8") and names(four)[0] == 'अधिकार १ "क"'


@pytest.mark.parametrize("name", ["", "   ", "x" * 201])
def test_merging_needs_a_reasonable_name(four, name):
    with pytest.raises(EditRefused) as err:
        merge(four, name, ref(0, "One"), ref(1, "Two"))
    assert err.value.status == 422 and cfg_path(four).read_text("utf-8") == FOUR


def test_only_neighbouring_sections_can_be_merged(four):
    with pytest.raises(EditRefused) as err:
        merge(four, "X", ref(0, "One"), ref(2, "Three"))               # Two is in between
    assert err.value.status == 422 and "neighbouring" in err.value.message and cfg_path(four).read_text("utf-8") == FOUR
    for refs in ([ref(1, "Two"), ref(0, "One")], [ref(1, "Two")]):     # not in file order; a single one
        with pytest.raises(EditRefused) as err:
            merge(four, "X", *refs)
        assert "neighbouring" in err.value.message


def test_sections_of_different_fields_are_not_merged(four):
    cfg_path(four).write_text(FOUR.replace('"field": "A", "name": "Four"', '"field": "B", "name": "Four"'), encoding="utf-8")
    with pytest.raises(EditRefused) as err:
        merge(four, "X", ref(2, "Three"), ref(3, "Four", field="B"))
    assert "different fields" in err.value.message


TWO_PAGE = (
    '{"Book": {"sub_sections": [\n'
    '  {"name": "L", "start_page": 5, "start_side": "right", "end_page": 9, "end_side": "left"},\n'
    '  {"name": "R", "start_page": 9, "start_side": "right", "end_page": 14, "end_side": "right"}\n'
    ']}}\n'
)


def test_merging_two_page_book_sections_takes_the_end_side_of_the_last(four):
    cfg_path(four).write_text(TWO_PAGE, encoding="utf-8")
    r1 = {"index": 0, "name": "L", "field": None, "start_page": 5, "end_page": 9}
    r2 = {"index": 1, "name": "R", "field": None, "start_page": 9, "end_page": 14}
    _, subs = merge(four, "LR", r1, r2)
    assert subs == [{"name": "LR", "start_page": 5, "start_side": "right", "end_page": 14, "end_side": "right"}]


def test_merging_when_only_one_has_an_end_side_is_refused(four):
    cfg_path(four).write_text(TWO_PAGE.replace(', "end_side": "right"', ""), encoding="utf-8")
    r1 = {"index": 0, "name": "L", "field": None, "start_page": 5, "end_page": 9}
    r2 = {"index": 1, "name": "R", "field": None, "start_page": 9, "end_page": 14}
    with pytest.raises(EditRefused) as err:
        merge(four, "LR", r1, r2)
    assert "end_side" in err.value.message


def test_undo_restores_the_file_byte_for_byte(four):
    remove(four, ref(1, "Two"))
    _, subs = edit.undo_last_structural_edit(pdf(four), str(four), str(four))
    assert cfg_path(four).read_text("utf-8") == FOUR and len(subs) == 4
    with pytest.raises(EditRefused) as err:                                   # and only once
        edit.undo_last_structural_edit(pdf(four), str(four), str(four))
    assert err.value.status == 404


def test_undo_after_a_merge(four):
    merge(four, "X", ref(0, "One"), ref(1, "Two"))
    edit.undo_last_structural_edit(pdf(four), str(four), str(four))
    assert cfg_path(four).read_text("utf-8") == FOUR


def test_undo_is_refused_if_the_file_was_changed_since(four):
    remove(four, ref(1, "Two"))
    cfg_path(four).write_text(cfg_path(four).read_text("utf-8").replace('"top": 5', '"top": 6'), encoding="utf-8")
    with pytest.raises(EditRefused) as err:
        edit.undo_last_structural_edit(pdf(four), str(four), str(four))
    assert err.value.status == 409 and '"top": 6' in cfg_path(four).read_text("utf-8")


def test_remove_and_merge_need_the_configs_repo_too(four):
    os.rmdir(four / ".git")
    for call in (lambda: remove(four, ref(1, "Two")), lambda: merge(four, "X", ref(0, "One"), ref(1, "Two"))):
        with pytest.raises(EditRefused) as err:
            call()
        assert err.value.status == 403
    assert cfg_path(four).read_text("utf-8") == FOUR


def test_a_result_that_differs_from_the_plan_is_never_written(four, monkeypatch):
    real = edit._cut_item
    monkeypatch.setattr(edit, "_cut_item", lambda text, subs, i: real(text, subs, i).replace('"crop": {"top": 5}', '"crop": {"top": 9}'))
    with pytest.raises(EditRefused):
        remove(four, ref(1, "Two"))
    assert cfg_path(four).read_text("utf-8") == FOUR
