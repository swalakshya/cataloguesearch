import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
import threading
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deploy import dashboard_static, dashboard_updates as updates, guard


def test_source_changes_are_detected_without_git_or_external_services(tmp_path):
    (tmp_path / 'deploy').mkdir()
    code = tmp_path / 'deploy' / 'example.py'
    code.write_text('value = 1')
    (tmp_path / 'frontend' / 'src').mkdir(parents=True)
    view = tmp_path / 'frontend' / 'src' / 'view.jsx'
    view.write_text('old UI')
    before = updates.revisions(tmp_path)
    code.write_text('value = 2')
    after = updates.revisions(tmp_path)
    assert after['backend'] != before['backend']
    assert after['frontend'] == before['frontend']
    view.write_text('new UI')
    assert updates.revisions(tmp_path)['frontend'] != before['frontend']


@pytest.fixture
def dashboard(tmp_path, monkeypatch):
    monkeypatch.setattr(updates, 'revisions', lambda: {'backend': 'new', 'frontend': 'old'})
    monkeypatch.setattr(updates, 'background_jobs', lambda: ['Deployment'])
    coordinator = updates.UpdateCoordinator(tmp_path / 'state.json', {'backend': 'old', 'frontend': 'old'}, True)
    app = FastAPI()
    guard.install(app)
    updates.install(app, coordinator)
    @app.post('/api/test/start')
    async def start():
        return {'started': True}
    @app.post('/api/test/cancel')
    async def cancel():
        return {'cancelled': True}
    with TestClient(app) as client:
        yield client, coordinator


def test_updates_only_start_on_click_and_block_new_work(dashboard):
    client, coordinator = dashboard
    assert client.get('/api/dashboard/status').json()['available']
    assert coordinator.phase() == 'idle'
    assert client.post('/api/test/start').status_code == 200
    assert client.post('/api/dashboard/update').status_code == 202
    assert coordinator.phase() == 'waiting'
    assert client.post('/api/test/start').status_code == 503
    assert client.post('/api/test/cancel').status_code == 200
    assert client.get('/api/dashboard/status').status_code == 200


def test_update_origin_guard(dashboard):
    client, coordinator = dashboard
    assert client.post('/api/dashboard/update', headers={'Origin': 'http://evil.example'}).status_code == 403
    assert coordinator.phase() == 'idle'
    assert client.post('/api/dashboard/update', headers={'Origin': 'http://localhost:4000'}).status_code == 202


def test_drain_waits_for_jobs_and_requests(tmp_path, monkeypatch):
    coordinator = updates.UpdateCoordinator(tmp_path / 'state.json', {}, True)
    coordinator.request()
    busy = ['OCR job']
    monkeypatch.setattr(updates, 'background_jobs', lambda: list(busy))
    async def exercise():
        task = asyncio.create_task(coordinator.drain())
        await asyncio.sleep(0)
        assert coordinator.phase() == 'waiting'
        busy.clear()
        coordinator.requests = 1
        await asyncio.sleep(1.05)
        assert coordinator.phase() == 'waiting'
        coordinator.requests = 0
        await asyncio.sleep(1.05)
        assert coordinator.phase() == 'ready'
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(exercise())


def test_eval_jobs_are_included_without_initializing_services(monkeypatch):
    import sys
    monkeypatch.setattr(updates.runner, 'active_run_id', lambda: None)
    manager = SimpleNamespace(lock=threading.Lock(), jobs={'id': {'status': 'queued'}})
    monkeypatch.setitem(sys.modules, 'eval.ocr', SimpleNamespace(_service_instance=SimpleNamespace(job_manager=manager)))
    monkeypatch.setitem(sys.modules, 'eval.load_test.api', SimpleNamespace(_state={'running': True}))
    assert updates.background_jobs() == ['Evaluation OCR job', 'Load test']


def test_static_routes_need_no_application_api_or_docker(tmp_path, monkeypatch):
    releases = tmp_path / 'releases'
    release = releases / 'test'
    release.mkdir(parents=True)
    (release / 'dashboard.html').write_text('<html>Standalone dev dashboard</html>')
    (release / 'bundle.js').write_text('console.log("dashboard")')
    monkeypatch.setattr(dashboard_static, 'RUNTIME', tmp_path)
    monkeypatch.setenv('DASHBOARD_RELEASE', 'test')
    app = FastAPI()
    @app.get('/api/example')
    async def example():
        return {'ok': True}
    dashboard_static.install(app)
    with TestClient(app) as client:
        assert 'Standalone dev dashboard' in client.get('/dev').text
        assert client.get('/deploy?tab=production').status_code == 200
        assert client.get('/dev').headers['cache-control'] == 'no-store'
        assert client.get('/api/example').json() == {'ok': True}
        assert client.get('/api/missing').status_code == 404
        assert client.get('/missing.js').status_code == 404
        assert client.get('/dashboard-assets/test/bundle.js').status_code == 200


def test_launcher_uses_only_virtualenv_for_normal_start(monkeypatch):
    import dashboard
    run = Mock()
    monkeypatch.setattr(dashboard.subprocess, 'Popen', run)
    monkeypatch.setattr(dashboard, 'ROOT', Path('/repo'))
    dashboard.launch({'release': 'built', 'frontend': 'ui'}, {'backend': 'code'}, 4000)
    argv = run.call_args.args[0]
    assert argv[1:4] == ['-m', 'uvicorn', 'dev:app']
    assert '--reload' not in argv
    assert argv[argv.index('--port') + 1] == '4000'
    assert json.loads(run.call_args.kwargs['env']['DASHBOARD_REVISION']) == {'backend': 'code', 'frontend': 'ui'}


def test_restart_port_check_accepts_closed_connections_but_rejects_live_listener():
    import dashboard
    import socket
    with socket.socket() as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(('127.0.0.1', 0))
        port = server.getsockname()[1]
        server.listen()
        with pytest.raises(OSError):
            dashboard.check_port(port)
        with socket.create_connection(('127.0.0.1', port), timeout=2) as client:
            connection, _ = server.accept()
            # Server closes first, leaving the server port in TIME_WAIT.
            connection.close()
            assert client.recv(1) == b''
    dashboard.check_port(port)


def test_missing_npm_does_not_change_current_release(tmp_path, monkeypatch):
    import dashboard
    monkeypatch.setattr(dashboard, 'RUNTIME', tmp_path)
    monkeypatch.setattr(dashboard.shutil, 'which', lambda _: None)
    manifest = tmp_path / 'current.json'
    manifest.write_text('{"release":"working"}')
    with pytest.raises(RuntimeError, match='existing dashboard remains available'):
        dashboard.build_assets({'frontend': 'changed'})
    assert json.loads(manifest.read_text())['release'] == 'working'


def test_backend_is_validated_without_starting_services(monkeypatch):
    import dashboard
    run = Mock()
    monkeypatch.setattr(dashboard.subprocess, 'run', run)
    dashboard.validate_backend({'release': 'candidate'})
    assert run.call_args.args[0][0] == dashboard.sys.executable
    assert 'import dev' in run.call_args.args[0][2]
    assert run.call_args.kwargs['env']['DASHBOARD_RELEASE'] == 'candidate'
    assert run.call_args.kwargs['check'] is True


def test_real_dev_app_starts_without_docker_or_node(jobs_env, monkeypatch, tmp_path):
    import subprocess
    import dev
    monkeypatch.setenv('LOAD_TEST_DB_PATH', str(tmp_path / 'load-tests.db'))
    monkeypatch.setenv('LOGS_DIR', str(tmp_path / 'logs'))
    monkeypatch.setattr(subprocess, 'run', Mock(side_effect=FileNotFoundError('external binary unavailable')))
    with TestClient(dev.app) as client:
        assert client.get('/api/jobs/runs').status_code == 200
        assert client.get('/api/dashboard/status').json() == {'enabled': False}
