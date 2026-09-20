"""Tests for the local dev tooling (deploy / discover job engine). Pure unit tests: no OpenSearch, no Docker."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


@pytest.fixture(scope="session", autouse=True)
def ensure_opensearch_running():
    """Overrides tests/conftest.py's autouse fixture, which starts an OpenSearch container these tests don't use."""
    yield


@pytest.fixture
def jobs_env(tmp_path, monkeypatch):
    """A fresh job database + log folder for each test, with the runner reset."""
    import time
    from deploy import runner, settings
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    runner.startup()
    yield runner
    # never leave a job running into the next test (the runner is a process-wide singleton)
    rid = runner.runner.active_run_id()
    if rid:
        runner.runner.cancel(rid)
        for _ in range(100):
            if not runner.runner.active_run_id():
                break
            time.sleep(0.1)


def wait_done(rid, timeout=20):
    import time
    from deploy import db
    for _ in range(int(timeout * 10)):
        run = db.get_run(rid)
        if run["status"] != "running":
            return run
        time.sleep(0.1)
    raise AssertionError(f"run {rid} still running after {timeout}s")
