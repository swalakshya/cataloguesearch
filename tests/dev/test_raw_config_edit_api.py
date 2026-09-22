"""The eval endpoints behind PDF Parser's "Edit scan_config.json" / "Edit config.json" popups, and the "Save"
button that writes the OCR/crop/language controls into scan_config.json."""
import json
import types

import fitz
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.common import raw_config_edit as edit
from eval import api as eval_api

CONFIG = '{\n    "Anuyog": "Dravyanuyog"\n}'
SCAN_CONFIG = '{"Book": {"start_page": 5, "end_page": 20}}'


@pytest.fixture
def env(tmp_path, monkeypatch):
    root = tmp_path / "configs"
    (root / ".git").mkdir(parents=True)
    folder = root / "Granth"
    folder.mkdir()
    (folder / "config.json").write_text(CONFIG, encoding="utf-8")
    (folder / "scan_config.json").write_text(SCAN_CONFIG, encoding="utf-8")
    doc = fitz.open()
    doc.new_page()
    doc.save(str(folder / "Book.pdf"))
    monkeypatch.setattr(eval_api, "Config", lambda *_a, **_k: types.SimpleNamespace(BASE_PDF_PATH=str(root)))
    monkeypatch.delenv("SCAN_CONFIG_EDIT_ROOT", raising=False)
    app = FastAPI()
    app.include_router(eval_api.router)
    return types.SimpleNamespace(client=TestClient(app), root=root, config_json=folder / "config.json", scan_config_json=folder / "scan_config.json")


def hash_of(text):
    return edit._sha(text)


def test_get_config_json(env):
    r = env.client.get("/eval/ocr/raw-config", params={"relative_path": "Granth/Book.pdf", "kind": "config"})
    body = r.json()
    assert r.status_code == 200
    assert body["text"] == CONFIG and body["exists"] and body["editable"] and body["hash"] == hash_of(CONFIG)
    assert body["file"] == "Granth/config.json" or body["file"] == "Granth\\config.json"


def test_get_scan_config_json(env):
    body = env.client.get("/eval/ocr/raw-config", params={"relative_path": "Granth/Book.pdf", "kind": "scan_config"}).json()
    assert body["text"] == SCAN_CONFIG and body["hash"] == hash_of(SCAN_CONFIG)


def test_get_a_missing_config_json_offers_an_empty_object(env):
    env.config_json.unlink()
    body = env.client.get("/eval/ocr/raw-config", params={"relative_path": "Granth/Book.pdf", "kind": "config"}).json()
    assert body["exists"] is False and body["text"].strip() == "{}"


def test_get_rejects_an_unknown_kind(env):
    assert env.client.get("/eval/ocr/raw-config", params={"relative_path": "Granth/Book.pdf", "kind": "nope"}).status_code == 422


def test_get_404s_for_a_missing_pdf(env):
    assert env.client.get("/eval/ocr/raw-config", params={"relative_path": "Granth/Nope.pdf", "kind": "config"}).status_code == 404


def test_get_400s_for_a_path_outside_the_pdf_root(env):
    assert env.client.get("/eval/ocr/raw-config", params={"relative_path": "../../etc/passwd", "kind": "config"}).status_code == 400


def test_set_saves_the_text_and_returns_the_new_hash(env):
    new_text = '{\n    "Anuyog": "Charananuyog",\n    "volume": 2\n}'
    r = env.client.post("/eval/ocr/raw-config", json={
        "relative_path": "Granth/Book.pdf", "kind": "config", "text": new_text, "expected_hash": hash_of(CONFIG)})
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == new_text and body["hash"] == hash_of(new_text) and body["exists"]
    assert env.config_json.read_text("utf-8") == new_text


def test_set_creates_a_missing_file(env):
    env.config_json.unlink()
    r = env.client.post("/eval/ocr/raw-config", json={
        "relative_path": "Granth/Book.pdf", "kind": "config", "text": "{}", "expected_hash": edit.EMPTY_HASH})
    assert r.status_code == 200 and env.config_json.read_text("utf-8") == "{}"


@pytest.mark.parametrize("patch,status", [
    ({"expected_hash": "0" * 64}, 409),
    ({"text": "{not json"}, 422),
    ({"text": "[1, 2]"}, 422),
    ({"kind": "nope"}, 422),
    ({"relative_path": "Granth/Nope.pdf"}, 404),
    ({"relative_path": "../../etc/passwd"}, 400),
])
def test_set_refuses_bad_requests_and_changes_nothing(env, patch, status):
    body = {"relative_path": "Granth/Book.pdf", "kind": "config", "text": '{"x": 1}', "expected_hash": hash_of(CONFIG)}
    r = env.client.post("/eval/ocr/raw-config", json={**body, **patch})
    assert r.status_code == status and env.config_json.read_text("utf-8") == CONFIG


def test_set_is_read_only_when_the_configs_are_not_a_git_checkout(env):
    (env.root / ".git").rmdir()
    assert env.client.get("/eval/ocr/raw-config", params={"relative_path": "Granth/Book.pdf", "kind": "config"}).json()["editable"] is False
    r = env.client.post("/eval/ocr/raw-config", json={
        "relative_path": "Granth/Book.pdf", "kind": "config", "text": "{}", "expected_hash": hash_of(CONFIG)})
    assert r.status_code == 403 and env.config_json.read_text("utf-8") == CONFIG


CROP = {"top": 9, "bottom": 4, "left": 0, "right": 0}
CONTROLS = {"crop": CROP, "language": "hi", "ocr_engine": "llm", "multi_page": False}


def test_controls_endpoint_writes_values_into_the_entry(env):
    hash_ = env.client.get("/eval/ocr/raw-config", params={"relative_path": "Granth/Book.pdf", "kind": "scan_config"}).json()["hash"]
    r = env.client.post("/eval/ocr/scan-config/controls", json={"relative_path": "Granth/Book.pdf", "values": CONTROLS, "expected_hash": hash_})
    assert r.status_code == 200
    body = r.json()
    assert body["entry"]["start_page"] == 5 and {k: body["entry"][k] for k in CONTROLS} == CONTROLS
    on_disk = json.loads(env.scan_config_json.read_text("utf-8"))
    assert on_disk["Book"]["start_page"] == 5   # untouched
    assert {k: on_disk["Book"][k] for k in CONTROLS} == CONTROLS


def test_controls_endpoint_removes_keys(env):
    env.scan_config_json.write_text('{"Book": {"language": "hi", "llm_model": "gemini-2.5-pro"}}', encoding="utf-8")
    hash_ = env.client.get("/eval/ocr/raw-config", params={"relative_path": "Granth/Book.pdf", "kind": "scan_config"}).json()["hash"]
    r = env.client.post("/eval/ocr/scan-config/controls", json={
        "relative_path": "Granth/Book.pdf", "values": {}, "remove_keys": ["llm_model"], "expected_hash": hash_})
    assert r.status_code == 200
    assert json.loads(env.scan_config_json.read_text("utf-8"))["Book"] == {"language": "hi"}


def test_controls_endpoint_refuses_a_stale_hash(env):
    before = env.scan_config_json.read_text("utf-8")
    r = env.client.post("/eval/ocr/scan-config/controls", json={
        "relative_path": "Granth/Book.pdf", "values": CONTROLS, "expected_hash": "0" * 64})
    assert r.status_code == 409 and env.scan_config_json.read_text("utf-8") == before


def test_controls_endpoint_refuses_outside_the_configs_repo(env):
    (env.root / ".git").rmdir()
    r = env.client.post("/eval/ocr/scan-config/controls", json={
        "relative_path": "Granth/Book.pdf", "values": CONTROLS, "expected_hash": edit.EMPTY_HASH})
    assert r.status_code == 403


def test_controls_endpoint_refuses_setting_and_removing_the_same_key(env):
    hash_ = env.client.get("/eval/ocr/raw-config", params={"relative_path": "Granth/Book.pdf", "kind": "scan_config"}).json()["hash"]
    r = env.client.post("/eval/ocr/scan-config/controls", json={
        "relative_path": "Granth/Book.pdf", "values": {"language": "hi"}, "remove_keys": ["language"], "expected_hash": hash_})
    assert r.status_code == 422


def test_controls_endpoint_404s_for_a_missing_pdf(env):
    r = env.client.post("/eval/ocr/scan-config/controls", json={
        "relative_path": "Granth/Nope.pdf", "values": CONTROLS, "expected_hash": edit.EMPTY_HASH})
    assert r.status_code == 404
