"""HTTP layer: the origin guard and input validation. Nothing here may start a real job."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deploy import guard
from deploy.api import router as deploy_router
from deploy.jobs_api import router as jobs_router
from ingest import status
from ingest.api import router as discover_router


@pytest.fixture
def client(jobs_env, monkeypatch):
    monkeypatch.setattr(status, "scan", lambda: {"categories": [{"folders": [
        {"dir": "Granth/A", "runnable": True, "pending": 1, "counts": {"not_indexed": 1}}]}]})
    app = FastAPI()
    guard.install(app)
    for router in (deploy_router, jobs_router, discover_router):
        app.include_router(router, prefix="/api")
    return TestClient(app)


@pytest.mark.parametrize("path", ["/api/deploy/config", "/api/discover/status", "/api/jobs/runs"])
def test_foreign_origin_is_rejected_on_every_job_route(client, path):
    assert client.get(path, headers={"Origin": "http://evil.example"}).status_code == 403


def test_the_dev_frontend_origin_and_plain_requests_are_allowed(client):
    assert client.get("/api/jobs/runs", headers={"Origin": "http://localhost:3000"}).status_code == 200
    assert client.get("/api/jobs/runs").status_code == 200


def test_a_foreign_page_cannot_start_a_restore(client):
    r = client.post("/api/deploy/runs", json={"actions": ["restore_prod"]}, headers={"Origin": "http://evil.example", "Content-Type": "text/plain"})
    assert r.status_code == 403 and client.get("/api/jobs/runs").json()["runs"] == []


def test_discover_rejects_bad_requests_without_creating_a_run(client):
    post = lambda path, body: client.post(f"/api/discover/{path}", json=body)  # noqa: E731
    assert post("cleanup", {"folder": "Granth/A"}).status_code == 422                         # no confirmation
    assert post("cleanup", {"folder": "../etc", "confirm": True}).status_code == 422          # unknown folder
    assert post("runs", {"mode": "nuke"}).status_code == 422
    assert post("runs", {"mode": "reindex"}).status_code == 422                               # needs explicit folders
    assert post("runs", {"folders": ["nope"], "mode": "ocr"}).status_code == 422
    assert client.get("/api/jobs/runs").json()["runs"] == []


def test_deploy_rejects_unknown_actions_and_services(client):
    assert client.post("/api/deploy/runs", json={"actions": ["rm_rf"]}).status_code == 422
    assert client.post("/api/deploy/runs", json={"actions": ["build"], "build_services": ["nope"]}).status_code == 422


def test_log_endpoint_only_serves_known_steps(client):
    assert client.get("/api/jobs/runs/nope/log", params={"step": "x"}).status_code == 404


def test_run_label_names_the_two_opensearch_steps_as_one_job():
    from deploy.actions import _run_label
    assert _run_label(["copy_snapshots", "restore_prod"]) == "Deploy OpenSearch to prod"
    assert _run_label(["build", "copy_snapshots", "restore_prod"]) == "Build & push images → Deploy OpenSearch to prod"
    assert _run_label(["restore_prod"]) == "Restore snapshots on prod"
    assert _run_label(["copy_snapshots"]) == "Create snapshots & copy to prod"
