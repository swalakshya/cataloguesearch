"""The two eval endpoints behind the verifier's SET button, against a real (tiny) PDF and a fake configs repo."""
import json
import types

import fitz
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from eval import api as eval_api

CONFIG = ('{"Book": {"sub_sections": [{"field": "F", "name": "One", "start_page": 2, "end_page": 4}]}}\n')


@pytest.fixture
def env(tmp_path, monkeypatch):
    root = tmp_path / "configs"
    (root / ".git").mkdir(parents=True)
    folder = root / "Granth"
    folder.mkdir()
    (folder / "scan_config.json").write_text(CONFIG, encoding="utf-8")
    doc = fitz.open()
    for _ in range(6):
        doc.new_page()
    doc.save(str(folder / "Book.pdf"))
    monkeypatch.setattr(eval_api, "Config", lambda *_a, **_k: types.SimpleNamespace(BASE_PDF_PATH=str(root)))
    monkeypatch.setattr(eval_api, "get_merged_config", lambda *a, **k: {})
    monkeypatch.delenv("SCAN_CONFIG_EDIT_ROOT", raising=False)
    app = FastAPI()
    app.include_router(eval_api.router)
    return types.SimpleNamespace(client=TestClient(app), root=root, cfg=folder / "scan_config.json")


BODY = {"relative_path": "Granth/Book.pdf", "index": 0, "which": "start", "page": 3, "expect_name": "One", "expect_field": "F", "expect_page": 2}


def test_the_scan_config_response_says_whether_sub_sections_are_editable(env):
    cfg = env.client.get("/eval/ocr/scan-config", params={"relative_path": "Granth/Book.pdf"}).json()
    assert cfg["sub_sections"][0]["start_page"] == 2
    assert cfg["sub_sections_source"]["editable"] is True and cfg["sub_sections_source"]["file"].endswith("scan_config.json")


def test_set_changes_the_file_and_returns_the_new_sub_sections(env):
    r = env.client.post("/eval/ocr/scan-config/sub-section-page", json=BODY)
    assert r.status_code == 200 and r.json()["sub_sections"][0]["start_page"] == 3
    assert env.cfg.read_text("utf-8") == CONFIG.replace('"start_page": 2', '"start_page": 3')


@pytest.mark.parametrize("patch,status", [
    ({"expect_page": 9}, 409), ({"expect_name": "Two"}, 409), ({"page": 5}, 422), ({"page": 7}, 422),   # 6-page PDF
    ({"which": "x"}, 422), ({"index": -1}, 422), ({"relative_path": "Granth/Nope.pdf"}, 404),
    ({"relative_path": "../../etc/passwd"}, 400),
])
def test_bad_requests_are_refused_with_the_right_status_and_change_nothing(env, patch, status):
    r = env.client.post("/eval/ocr/scan-config/sub-section-page", json={**BODY, **patch})
    assert r.status_code == status and env.cfg.read_text("utf-8") == CONFIG


def test_read_only_when_the_configs_are_not_a_git_checkout(env):
    (env.root / ".git").rmdir()
    assert env.client.get("/eval/ocr/scan-config", params={"relative_path": "Granth/Book.pdf"}).json()["sub_sections_source"]["editable"] is False
    r = env.client.post("/eval/ocr/scan-config/sub-section-page", json=BODY)
    assert r.status_code == 403 and env.cfg.read_text("utf-8") == CONFIG


THREE = ('{"Book": {"sub_sections": [\n'
         '  {"field": "F", "name": "One", "start_page": 1, "end_page": 2},\n'
         '  {"field": "F", "name": "Two", "start_page": 3, "end_page": 4},\n'
         '  {"field": "F", "name": "Three", "start_page": 5, "end_page": 6}\n]}}\n')
REF = lambda i, n, a, b: {"index": i, "name": n, "field": "F", "start_page": a, "end_page": b}  # noqa: E731
BASE = "/eval/ocr/scan-config/sub-sections"
PATH = "Granth/Book.pdf"


def test_remove_then_undo(env):
    env.cfg.write_text(THREE, encoding="utf-8")
    r = env.client.post(f"{BASE}/remove", json={"relative_path": PATH, "items": [REF(1, "Two", 3, 4)]})
    assert r.status_code == 200 and [s["name"] for s in r.json()["sub_sections"]] == ["One", "Three"]
    assert env.cfg.read_text("utf-8") == THREE.replace('  {"field": "F", "name": "Two", "start_page": 3, "end_page": 4},\n', "")
    r = env.client.post(f"{BASE}/undo", json={"relative_path": PATH})
    assert r.status_code == 200 and len(r.json()["sub_sections"]) == 3 and env.cfg.read_text("utf-8") == THREE


def test_merge_uses_the_name_and_joins_the_pages(env):
    env.cfg.write_text(THREE, encoding="utf-8")
    r = env.client.post(f"{BASE}/merge", json={"relative_path": PATH, "name": "Two + Three", "items": [REF(1, "Two", 3, 4), REF(2, "Three", 5, 6)]})
    assert r.status_code == 200
    assert r.json()["sub_sections"][1] == {"field": "F", "name": "Two + Three", "start_page": 3, "end_page": 6}


@pytest.mark.parametrize("path,body,status", [
    ("remove", {"items": [REF(1, "Two", 3, 5)]}, 409),                                             # pages changed
    ("remove", {"items": [REF(0, "One", 1, 2), REF(1, "Two", 3, 4), REF(2, "Three", 5, 6)]}, 422),  # would remove all
    ("remove", {"items": []}, 422),
    ("merge", {"name": "X", "items": [REF(0, "One", 1, 2), REF(2, "Three", 5, 6)]}, 422),            # not neighbours
    ("merge", {"name": " ", "items": [REF(0, "One", 1, 2), REF(1, "Two", 3, 4)]}, 422),              # no name
    ("merge", {"name": "X", "items": [REF(0, "One", 1, 2)]}, 422),
    ("undo", {}, 404),                                                                                # nothing to undo
])
def test_refused_edits_change_nothing(env, path, body, status):
    env.cfg.write_text(THREE, encoding="utf-8")
    r = env.client.post(f"{BASE}/{path}", json={"relative_path": PATH, **body})
    assert r.status_code == status and env.cfg.read_text("utf-8") == THREE


def test_remove_and_merge_are_refused_outside_the_configs_repo(env):
    env.cfg.write_text(THREE, encoding="utf-8")
    (env.root / ".git").rmdir()
    for path, body in (("remove", {"items": [REF(1, "Two", 3, 4)]}),
                       ("merge", {"name": "X", "items": [REF(0, "One", 1, 2), REF(1, "Two", 3, 4)]}), ("undo", {})):
        assert env.client.post(f"{BASE}/{path}", json={"relative_path": PATH, **body}).status_code == 403
    assert env.cfg.read_text("utf-8") == THREE


def test_paths_outside_the_pdf_folder_are_rejected(env):
    r = env.client.post(f"{BASE}/remove", json={"relative_path": "../../etc/passwd", "items": [REF(0, "x", 1, 2)]})
    assert r.status_code == 400
