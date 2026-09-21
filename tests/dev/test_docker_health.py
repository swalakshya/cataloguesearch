"""Docker light (green / yellow / red), the restart job, and that job-start endpoints refuse while Docker is not green."""
import subprocess
import time
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deploy import docker_health, docker_restart, guard, settings
from deploy.api import router as deploy_router
from deploy.jobs_api import router as jobs_router
from ingest import status
from ingest.api import router as discover_router


# ---- the probe ------------------------------------------------------------------------------------------------------

_REAL_CHECK = docker_health.check


def fake_docker(monkeypatch, *, delay=0.0, code=0, stderr="", raises=None):
    def run(argv, **kw):
        assert argv == ["docker", "ps", "-q"] and kw["timeout"] == settings.DOCKER_TIMEOUT_SECONDS
        time.sleep(delay)
        if raises:
            raise raises
        return types.SimpleNamespace(returncode=code, stdout="", stderr=stderr)
    monkeypatch.setattr(docker_health.subprocess, "run", run)


def probe(monkeypatch, **kw):
    fake_docker(monkeypatch, **kw)
    return _REAL_CHECK()


def test_a_quick_answer_is_green(monkeypatch):
    r = probe(monkeypatch)
    assert r["status"] == "ok" and r["seconds"] < settings.DOCKER_SLOW_SECONDS


def test_a_slow_answer_is_yellow(monkeypatch):
    monkeypatch.setattr(settings, "DOCKER_SLOW_SECONDS", 0.05)
    r = probe(monkeypatch, delay=0.1)
    assert r["status"] == "slow" and "struggling" in r["message"]


def test_no_answer_is_red(monkeypatch):
    r = probe(monkeypatch, raises=subprocess.TimeoutExpired("docker", 12))
    assert r["status"] == "down" and "stuck" in r["message"]


def test_an_error_is_red_with_the_reason(monkeypatch):
    r = probe(monkeypatch, code=1, stderr="Cannot connect to the Docker daemon at unix:///var/run/docker.sock\n")
    assert r["status"] == "down" and "Cannot connect" in r["message"]


def test_a_missing_docker_command_is_red(monkeypatch):
    r = probe(monkeypatch, raises=FileNotFoundError())
    assert r["status"] == "down" and "not found" in r["message"]


def test_results_are_cached_for_a_few_seconds_and_only_one_probe_runs_at_a_time(monkeypatch):
    calls = []
    monkeypatch.setattr(docker_health, "check", lambda: calls.append(1) or {"status": "ok", "seconds": 0.1, "message": "m", "checked_at": "t"})
    docker_health.forget()
    docker_health.get(); docker_health.get()
    assert len(calls) == 1                                                   # second call served from cache
    docker_health.get(fresh=True)
    assert len(calls) == 2
    docker_health._lock.acquire()                                            # a probe is "running" (a stuck docker ps)
    try:
        assert docker_health.get(fresh=True)["status"] == "ok" and len(calls) == 2   # answered from what we knew, no second probe
        docker_health.forget()
        assert docker_health.get(fresh=True)["status"] == "checking"         # nothing known yet
    finally:
        docker_health._lock.release()


# ---- the endpoints --------------------------------------------------------------------------------------------------

@pytest.fixture
def client(jobs_env, monkeypatch):
    monkeypatch.setattr(status, "scan", lambda: {"categories": [{"folders": [
        {"dir": "Granth/A", "runnable": True, "pending": 1, "counts": {"not_indexed": 1}}]}]})
    app = FastAPI()
    guard.install(app)
    for router in (deploy_router, jobs_router, discover_router):
        app.include_router(router, prefix="/api")
    return TestClient(app)


def set_docker(monkeypatch, state):
    monkeypatch.setattr(docker_health, "check", lambda: {"status": state, "seconds": 9.0, "message": f"docker is {state}", "checked_at": "t"})
    docker_health.forget()


def started_runs(client):
    return client.get("/api/jobs/runs").json()["runs"]


@pytest.fixture
def no_real_jobs(monkeypatch):
    """Endpoints that pass the Docker check must not start real builds; they return a fake run id."""
    from deploy import actions, gc
    from ingest import jobs
    monkeypatch.setattr("deploy.api.start_deploy", lambda *a, **k: "run-x")
    monkeypatch.setattr(gc, "start_cleanup", lambda *a, **k: "run-x")
    monkeypatch.setattr(jobs, "start_discover", lambda *a, **k: "run-x")
    monkeypatch.setattr(jobs, "start_cleanup", lambda *a, **k: "run-x")


@pytest.mark.parametrize("state", ["slow", "down"])
@pytest.mark.parametrize("request_", [
    ("post", "/api/deploy/runs", {"actions": ["build"]}),
    ("post", "/api/deploy/runs", {"actions": ["copy_snapshots", "restore_prod"]}),
    ("post", "/api/deploy/gc/run", {"target": "local", "categories": [{"id": "dangling_images"}]}),
    ("post", "/api/discover/runs", {"mode": "index"}),
    ("post", "/api/discover/runs", {"mode": "reindex", "folders": ["Granth/A"]}),
    ("post", "/api/discover/cleanup", {"folder": "Granth/A", "confirm": True}),
])
def test_jobs_that_need_docker_are_refused_when_it_is_yellow_or_red(client, monkeypatch, no_real_jobs, state, request_):
    set_docker(monkeypatch, state)
    method, url, body = request_
    r = client.request(method, url, json=body)
    assert r.status_code == 503 and "Restart it from the Docker light" in r.json()["detail"] and state.replace("down", "not responding").replace("slow", "slow") in r.json()["detail"]
    assert started_runs(client) == []


@pytest.mark.parametrize("request_", [
    ("post", "/api/deploy/runs", {"actions": ["restore_prod"]}),                              # only ssh to prod
    ("post", "/api/deploy/gc/run", {"target": "prod", "categories": [{"id": "dangling_images"}], "confirm": True}),
    ("post", "/api/discover/runs", {"mode": "ocr", "folders": ["Granth/A"]}),                 # OCR does not touch OpenSearch
])
def test_jobs_that_do_not_need_local_docker_are_not_blocked(client, monkeypatch, no_real_jobs, request_):
    set_docker(monkeypatch, "down")
    method, url, body = request_
    assert client.request(method, url, json=body).status_code == 202


def test_green_docker_lets_jobs_start(client, monkeypatch, no_real_jobs):
    set_docker(monkeypatch, "ok")
    assert client.post("/api/deploy/runs", json={"actions": ["build"]}).status_code == 202


def test_a_refusal_probes_fresh_instead_of_trusting_an_old_green(client, monkeypatch, no_real_jobs):
    set_docker(monkeypatch, "ok")
    assert client.get("/api/deploy/docker").json()["status"] == "ok"                          # cached green
    monkeypatch.setattr(docker_health, "check", lambda: {"status": "down", "seconds": 12.0, "message": "stuck", "checked_at": "t"})
    assert client.post("/api/deploy/runs", json={"actions": ["build"]}).status_code == 503     # Docker got stuck meanwhile


def test_status_endpoint_reports_health_and_what_is_running(client, monkeypatch):
    set_docker(monkeypatch, "slow")
    body = client.get("/api/deploy/docker").json()
    assert body["status"] == "slow" and body["seconds"] == 9.0 and body["restarting"] is False and body["active_run_id"] is None


def test_docker_endpoints_are_behind_the_origin_guard(client):
    assert client.get("/api/deploy/docker", headers={"Origin": "http://evil.example"}).status_code == 403
    assert client.post("/api/deploy/docker/restart", headers={"Origin": "http://evil.example"}).status_code == 403
    assert started_runs(client) == []


def test_restart_starts_a_docker_job_and_is_refused_while_another_job_runs(client, monkeypatch):
    gate = []
    import threading
    release = threading.Event()
    monkeypatch.setattr(docker_restart, "_restart", lambda ctx: (release.wait(5), 0)[1])
    r = client.post("/api/deploy/docker/restart")
    assert r.status_code == 202
    body = client.get("/api/deploy/docker").json()
    assert body["restarting"] is True and body["active_kind"] == "docker"
    second = client.post("/api/deploy/docker/restart")
    assert second.status_code == 409 and "Cancel it first" in second.json()["detail"]
    release.set()


# ---- the restart job itself -----------------------------------------------------------------------------------------

class Ctx:
    def __init__(self, cancelled=False):
        self.logs, self.steps, self.summary_text, self.cancelled = [], [], None, cancelled

    def log(self, line): self.logs.append(line)
    def progress(self, label, **kw): self.steps.append(label)
    def summary(self, text): self.summary_text = text
    def sleep(self, seconds): return not self.cancelled


@pytest.fixture
def restart_env(monkeypatch):
    calls = []
    monkeypatch.setattr(docker_restart.shutil, "which", lambda name: "/usr/local/bin/orb" if name == "orb" else None)
    monkeypatch.setattr(settings, "ORB_BIN", "")
    monkeypatch.setattr(docker_restart, "_run", lambda ctx, argv, timeout: calls.append(argv[1:]) or 0)
    monkeypatch.setattr(docker_restart, "POLL", 0)
    monkeypatch.setattr(docker_restart, "_opensearch_state", lambda: "healthy")
    monkeypatch.setattr(docker_health, "check", lambda: {"status": "ok", "seconds": 0.4, "message": "docker ps answers in 0.4s.", "checked_at": "t"})
    return calls


def test_restart_stops_then_starts_then_waits_for_docker_and_opensearch(restart_env):
    ctx = Ctx()
    assert docker_restart._restart(ctx) == 0
    assert restart_env == [["stop"], ["start"]]
    assert ctx.steps == ["Stopping OrbStack", "Starting OrbStack", "Waiting for Docker to answer", "Waiting for opensearch-node"]
    assert ctx.summary_text == "Docker answers again (0.4s); OpenSearch healthy"


def test_restart_keeps_going_when_orb_stop_hangs(restart_env, monkeypatch):
    monkeypatch.setattr(docker_restart, "_run", lambda ctx, argv, timeout: restart_env.append(argv[1:]) or (None if argv[1] == "stop" else 0))
    ctx = Ctx()
    assert docker_restart._restart(ctx) == 0
    assert restart_env == [["stop"], ["start"]] and any("did not finish" in line for line in ctx.logs)


def test_restart_waits_while_docker_is_still_slow_then_succeeds(restart_env, monkeypatch):
    answers = iter(["down", "slow", "ok"])
    monkeypatch.setattr(docker_health, "check", lambda: {"status": next(answers), "seconds": 1.0, "message": "m", "checked_at": "t"})
    assert docker_restart._restart(Ctx()) == 0


def test_restart_fails_with_advice_when_docker_never_recovers(restart_env, monkeypatch):
    monkeypatch.setattr(docker_restart, "DOCKER_WAIT", 0)
    monkeypatch.setattr(docker_health, "check", lambda: {"status": "down", "seconds": 12.0, "message": "stuck", "checked_at": "t"})
    ctx = Ctx()
    assert docker_restart._restart(ctx) == 1
    assert ctx.summary_text == "Docker did not recover" and any("menu bar" in line for line in ctx.logs)


def test_a_missing_opensearch_container_is_not_an_error(restart_env, monkeypatch):
    monkeypatch.setattr(docker_restart, "_opensearch_state", lambda: None)
    ctx = Ctx()
    assert docker_restart._restart(ctx) == 0 and "no local OpenSearch container" in ctx.summary_text


def test_an_opensearch_container_that_is_down_is_reported_with_the_command_to_start_it(restart_env, monkeypatch):
    monkeypatch.setattr(docker_restart, "_opensearch_state", lambda: "exited")
    ctx = Ctx()
    assert docker_restart._restart(ctx) == 0
    assert any("docker compose up -d opensearch-node" in line for line in ctx.logs)


def test_restart_needs_the_orb_command(restart_env, monkeypatch):
    monkeypatch.setattr(docker_restart.shutil, "which", lambda name: None)
    ctx = Ctx()
    assert docker_restart._restart(ctx) == 1 and ctx.summary_text == "orb not found" and restart_env == []


def test_cancelling_stops_the_restart_between_commands(restart_env, monkeypatch):
    monkeypatch.setattr(docker_restart, "_run", lambda ctx, argv, timeout: None)
    assert docker_restart._restart(Ctx(cancelled=True)) == 1


def test_run_kills_a_command_that_outlives_its_time_limit(tmp_path):
    ctx = Ctx()
    started = time.monotonic()
    assert docker_restart._run(ctx, ["sleep", "30"], timeout=0.5) is None
    assert time.monotonic() - started < 5
    assert docker_restart._run(ctx, ["echo", "hello"], timeout=5) == 0 and "hello" in ctx.logs
