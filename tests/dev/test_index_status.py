from backend.crawler import index_status as s
from ingest import status as st


def test_classify_index_status():
    assert s.classify_index_status({}, "h") == "never_indexed"
    assert s.classify_index_status({"config_hash": None, "ocr_checksum": "x"}, "h") == "ocr_only"
    assert s.classify_index_status({"config_hash": None, "ocr_checksum": None}, "h") == "never_indexed"
    assert s.classify_index_status({"config_hash": "h"}, "h") == "indexed"
    assert s.classify_index_status({"config_hash": "old"}, "h") == "stale"


def test_discover_maps_states_to_not_indexed_ocred_indexed_and_counts_stale_as_indexed():
    assert st._MAP == {"never_indexed": "not_indexed", "ocr_only": "ocred", "stale": "indexed", "indexed": "indexed"}
    assert st.PENDING == ("not_indexed", "ocred")


def test_walk_pdfs_skips_hidden_and_ignored_folders(tmp_path):
    for p in ("a/x.pdf", "a/sub/y.PDF", ".hidden/z.pdf", "skip/w.pdf", "b/notes.txt"):
        (tmp_path / p).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / p).write_text("x")
    (tmp_path / "skip" / "_ignore").write_text("")
    assert sorted(p.replace(str(tmp_path) + "/", "") for p in s.walk_pdfs(str(tmp_path))) == ["a/sub/y.PDF", "a/x.pdf"]


def test_terminal_scan_config_dir_is_the_deepest_one(tmp_path):
    (tmp_path / "Granth" / "Work").mkdir(parents=True)
    (tmp_path / "Granth" / "scan_config.json").write_text("{}")
    (tmp_path / "Granth" / "Work" / "scan_config.json").write_text("{}")
    (tmp_path / "Granth" / "Work" / "a.pdf").write_text("x")
    (tmp_path / "loose.pdf").write_text("x")
    assert s.terminal_scan_config_dir(str(tmp_path / "Granth" / "Work" / "a.pdf"), str(tmp_path)) == "Granth/Work"
    assert s.terminal_scan_config_dir(str(tmp_path / "loose.pdf"), str(tmp_path)) == ""
