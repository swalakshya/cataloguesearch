"""Local lifecycle tests use only disposable processes; no providers or Docker."""
import json
from unittest.mock import Mock

import pytest

from deploy import local_services as local


@pytest.fixture
def manager(tmp_path, monkeypatch):
    root = tmp_path / 'catalogue'
    chat = tmp_path / 'chat'
    for path in (root / 'backend', root / 'frontend' / 'src', chat / 'service' / 'src'):
        path.mkdir(parents=True)
    (root / '.env.local').write_text('JWT_SECRET=shared-secret-value\nGEMINI_API_KEY=private-key-value\n')
    (chat / 'service' / '.env.local').write_text('JWT_SECRET=wrong-secret\nEXTERNAL_API_BASE_URL=https://production.example\n')
    monkeypatch.setattr(local.settings, 'REPO_ROOT', root)
    monkeypatch.setattr(local.settings, 'CHAT_REPO_DIR', chat)
    monkeypatch.setattr(local.shutil, 'which', lambda binary: '/bin/' + binary)
    return local.Manager(tmp_path / 'state')


def test_native_services_use_local_endpoints_and_shared_auth(manager):
    api = manager.spec('api')
    chat = manager.spec('chat')
    ui = manager.spec('ui')
    assert '--reload' not in api['command']
    assert api['env']['OPENSEARCH_HOST'] == 'localhost'
    assert chat['env']['EXTERNAL_API_BASE_URL'] == 'http://localhost:8000'
    assert chat['env']['JWT_SECRET'] == api['env']['JWT_SECRET'] == 'shared-secret-value'
    assert ui['env']['REACT_APP_API_BASE_URL'] == 'http://localhost:8000/api'
    assert ui['env']['REACT_APP_LLM_API_BASE_URL'] == 'http://localhost:8012'


def test_config_is_masked_and_reveal_is_explicit(manager):
    config = manager.configuration('chat')
    rows = {row['key']: row for row in config['values']}
    assert rows['env.JWT_SECRET']['value'] == '••••••••'
    assert 'private-key-value' not in json.dumps(config)
    assert 'shared-secret-value' not in json.dumps(config)
    assert manager.reveal('chat', 'env.JWT_SECRET') == 'shared-secret-value'
    with pytest.raises(ValueError):
        manager.reveal('chat', '../../.ssh/id_rsa')


def test_updates_are_from_local_source_and_config(manager):
    code = local.settings.REPO_ROOT / 'backend' / 'example.py'
    code.write_text('before')
    before = manager.revision('api')
    code.write_text('after')
    assert manager.revision('api') != before
    before = manager.revision('chat')
    (local.settings.CHAT_REPO_DIR / 'service' / '.env.local').write_text('JWT_SECRET=changed')
    assert manager.revision('chat') != before


def test_start_order_and_stop_order(manager, monkeypatch):
    starts, stops = [], []
    monkeypatch.setattr(manager, '_start_one', lambda service, ctx: starts.append(service))
    monkeypatch.setattr(manager, '_stop_one', lambda service, ctx: stops.append(service))
    manager.perform('all', 'start', Mock(cancelled=False))
    assert starts == ['docker', 'opensearch', 'api', 'chat', 'ui']
    manager.perform('api', 'stop', Mock(cancelled=False))
    assert stops == ['ui', 'chat', 'api']


def test_external_process_is_never_terminated(manager, monkeypatch):
    monkeypatch.setattr(manager, '_owned', lambda service: None)
    monkeypatch.setattr(manager, '_port_open', lambda port: True)
    kill = Mock()
    monkeypatch.setattr(local.os, 'killpg', kill)
    with pytest.raises(RuntimeError, match='outside the dashboard'):
        manager._stop_one('api', Mock())
    kill.assert_not_called()


def test_remote_docker_context_is_rejected(manager, monkeypatch):
    monkeypatch.delenv('DOCKER_HOST', raising=False)
    monkeypatch.setattr(manager, '_command', lambda *a, **kw: '"ssh://production"')
    with pytest.raises(RuntimeError, match='local Docker'):
        manager._local_docker()


def test_service_update_restarts_immediately(manager, monkeypatch):
    events = []
    monkeypatch.setattr(manager, '_stop_one', lambda service, ctx: events.append(('stop', service)))
    monkeypatch.setattr(manager, '_start_one', lambda service, ctx: events.append(('start', service)))
    manager.perform('chat', 'update', Mock(cancelled=False))
    assert events == [('stop', 'chat'), ('start', 'chat')]


def test_logs_redact_secrets(manager):
    manager.directory.mkdir(parents=True)
    path = manager.directory / 'chat.log'
    path.write_text('JWT=shared-secret-value key=private-key-value normal message\n')
    result = manager.logs('chat')
    assert 'normal message' in result['text']
    assert 'shared-secret-value' not in result['text']
    assert 'private-key-value' not in result['text']


def test_compose_environment_secrets_are_not_exposed(manager):
    (local.settings.REPO_ROOT / 'docker-compose.yml').write_text('services:\n  opensearch:\n    environment:\n      - OPENSEARCH_INITIAL_ADMIN_PASSWORD=hidden-password\n')
    config = manager.configuration('opensearch')
    assert 'hidden-password' not in json.dumps(config)


def test_api_validates_services_and_protects_secret_reveal(manager, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from deploy import guard, local_services_api
    monkeypatch.setattr(local_services_api, 'manager', manager)
    start = Mock(return_value='job')
    monkeypatch.setattr(manager, 'start_action', start)
    app = FastAPI()
    guard.install(app)
    app.include_router(local_services_api.router)
    with TestClient(app) as client:
        assert client.post('/api/local-services/actions', json={'service': 'production', 'action': 'start'}).status_code == 422
        assert client.post('/api/local-services/actions', json={'service': 'docker', 'action': 'stop'}).status_code == 422
        assert client.post('/api/local-services/actions', json={'service': 'docker', 'action': 'update'}).status_code == 422
        start.assert_not_called()
        assert client.post('/api/local-services/actions', json={'service': 'api', 'action': 'update'}).status_code == 202
        response = client.get('/api/local-services/chat/config')
        assert response.headers['cache-control'] == 'no-store'
        assert 'shared-secret-value' not in response.text
        path = '/api/local-services/chat/config/reveal'
        assert client.post(path, json={'key': 'env.JWT_SECRET'}, headers={'Origin': 'https://evil.example'}).status_code == 403
        assert client.post(path, json={'key': 'env.JWT_SECRET'}, headers={'Origin': 'http://localhost:4000'}).json()['value'] == 'shared-secret-value'


def test_stale_pid_record_is_not_owned(manager, monkeypatch):
    manager.directory.mkdir(parents=True)
    (manager.directory / 'api.json').write_text(json.dumps({'pid': 123, 'identity': 'old-process'}))
    monkeypatch.setattr(manager, '_identity', lambda _: 'new-process')
    assert manager._owned('api') is None


def test_process_ownership_survives_dashboard_restart(manager, monkeypatch):
    manager.directory.mkdir(parents=True)
    (manager.directory / 'api.json').write_text(json.dumps({'pid': 123, 'identity': 'same-process', 'revision': 'code'}))
    monkeypatch.setattr(local.Manager, '_identity', staticmethod(lambda _: 'same-process'))
    monkeypatch.setattr(local.os, 'getpgid', lambda pid: pid)
    fresh = local.Manager(manager.directory)
    assert fresh._owned('api')['revision'] == 'code'


def test_native_start_uses_detached_supervisor_and_no_shell(manager, monkeypatch):
    monkeypatch.setattr(manager, '_owned', lambda _: None)
    monkeypatch.setattr(manager, '_port_open', lambda _: False)
    monkeypatch.setattr(manager, '_identity', lambda _: 'identity')
    monkeypatch.setattr(manager, '_wait', lambda *args: None)
    process = Mock(pid=123)
    popen = Mock(return_value=process)
    monkeypatch.setattr(local.subprocess, 'Popen', popen)
    manager._start_one('chat', Mock(cancelled=False))
    assert popen.call_args.args[0][-3:] == ['-m', 'deploy.local_process', 'chat']
    assert popen.call_args.kwargs['start_new_session'] is True
    assert 'shell' not in popen.call_args.kwargs
    assert 'shared-secret-value' not in (manager.directory / 'chat.json').read_text()


def test_rotating_log_supervisor_runs_only_selected_command(tmp_path, monkeypatch):
    import os
    import sys
    from deploy import local_process
    monkeypatch.setenv('LOCAL_SERVICE_DIRECTORY', str(tmp_path))
    monkeypatch.setattr(sys, 'argv', ['local_process', 'chat'])
    monkeypatch.setattr(local_process.signal, 'signal', Mock())
    import io
    monkeypatch.setattr(sys, 'stdin', io.StringIO(json.dumps({
        'command': [sys.executable, '-c', 'print("local service test output")'],
        'cwd': str(tmp_path), 'env': dict(os.environ), 'secrets': [],
    })))
    assert local_process.main() == 0
    assert 'local service test output' in (tmp_path / 'chat.log').read_text()


def test_docker_log_view_does_not_start_orbstack(manager, monkeypatch, tmp_path):
    monkeypatch.setattr(local.Path, 'home', staticmethod(lambda: tmp_path))
    path = tmp_path / '.orbstack' / 'log' / 'vmgr.log'
    path.parent.mkdir(parents=True)
    path.write_text('Runtime stopped')
    command = Mock(side_effect=AssertionError('Log viewing must not invoke orb'))
    monkeypatch.setattr(manager, '_command', command)
    assert manager.logs('docker')['text'] == 'Runtime stopped'
    command.assert_not_called()


def test_removed_env_values_are_not_inherited(manager, monkeypatch):
    monkeypatch.setenv('DELETED_APP_SETTING', 'stale')
    monkeypatch.setenv('JWT_SECRET', 'stale-secret')
    spec = manager.spec('api')
    assert 'DELETED_APP_SETTING' not in spec['env']
    assert spec['env']['JWT_SECRET'] == 'shared-secret-value'
    (local.settings.REPO_ROOT / '.env.local').write_text('')
    assert 'JWT_SECRET' not in manager.spec('api')['env']


def test_embedded_credentials_are_masked_and_revealable(manager):
    with (local.settings.REPO_ROOT / '.env.local').open('a') as stream:
        stream.write('DATABASE_URL=postgres://alice:private@localhost/db\nOPTIONS=token=another-private-value\n')
    config = manager.configuration('api')
    assert 'alice:private' not in json.dumps(config)
    assert 'another-private-value' not in json.dumps(config)
    assert manager.reveal('api', 'env.DATABASE_URL') == 'postgres://alice:private@localhost/db'
    assert 'alice:private' not in local.redact_text('Connecting postgres://alice:private@localhost/db')
    assert 'another-private-value' not in local.redact_text('token=another-private-value')


def test_failed_service_does_not_hide_other_statuses(manager, monkeypatch):
    monkeypatch.setattr(manager, '_owned', lambda _: None)
    monkeypatch.setattr(manager, '_port_open', lambda _: False)
    monkeypatch.setattr(manager, '_health', lambda _: True)
    details = manager._status_details
    def status(service):
        if service == 'chat':
            raise ValueError('Invalid chat configuration')
        return details(service)
    monkeypatch.setattr(manager, '_status_details', status)
    rows = {row['id']: row for row in manager.status()['services']}
    assert rows['chat']['status'] == 'failed'
    assert rows['api']['status'] == 'ready'


def test_startup_timeout_reports_failed(manager, monkeypatch):
    import time
    monkeypatch.setattr(manager, '_owned', lambda _: {'pid': 12, 'revision': manager.revision('api'), 'started_at': time.time() - 200})
    monkeypatch.setattr(manager, '_health', Mock(side_effect=OSError('Not ready')))
    assert manager._status_one('api')['status'] == 'failed'


def test_ui_build_failure_keeps_running_ui(manager, monkeypatch):
    stop = Mock()
    monkeypatch.setattr(manager, '_stop_one', stop)
    monkeypatch.setattr(manager, '_command', Mock(side_effect=RuntimeError('Build failed')))
    with pytest.raises(RuntimeError, match='Build failed'):
        manager.perform('ui', 'update', Mock(cancelled=False))
    stop.assert_not_called()


def test_ui_build_precedes_stop_and_uses_prepared_release(manager, monkeypatch):
    events = []
    prepared = ({'command': ['serve', 'release']}, 'revision')
    monkeypatch.setattr(manager.service('ui'), 'prepare', lambda ctx: events.append('build') or prepared)
    monkeypatch.setattr(manager, '_stop_one', lambda *a: events.append('stop'))
    start = Mock(side_effect=lambda *a, **kw: events.append('start'))
    monkeypatch.setattr(manager, '_start_one', start)
    manager.perform('ui', 'update', Mock(cancelled=False))
    assert events == ['build', 'stop', 'start']
    assert start.call_args.kwargs['prepared'] == prepared


def test_real_lifecycle_update_stop_and_persisted_log_masking(manager, monkeypatch):
    """Real detached supervisor and HTTP process on an ephemeral loopback port."""
    import os
    from pathlib import Path
    import socket
    import sys
    import time
    from types import SimpleNamespace
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    monkeypatch.setitem(local.PORTS, 'api', port)
    monkeypatch.setenv('PYTHONPATH', str(Path(local.__file__).resolve().parents[1]))
    code = f'''import signal
from http.server import BaseHTTPRequestHandler, HTTPServer
signal.signal(signal.SIGTERM, signal.SIG_IGN)
print("shared-secret-value postgres://alice:private@localhost/db", flush=True)
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b"ready")
HTTPServer(("127.0.0.1", {port}), Handler).serve_forever()
'''
    original = manager.spec
    def spec(service):
        value = original(service)
        if service == 'api':
            value.update(command=[sys.executable, '-u', '-c', code], cwd=manager.directory.parent)
        return value
    monkeypatch.setattr(manager, 'spec', spec)
    ctx = SimpleNamespace(cancelled=False, sleep=time.sleep, progress=lambda *_: None, log=lambda *_: None)
    try:
        manager._start_one('api', ctx)
        first = manager._owned('api')['pid']
        manager.perform('api', 'update', ctx)
        assert manager._owned('api')['pid'] != first
        assert manager._health('api')
        manager._stop_one('api', ctx)
        assert manager._owned('api') is None
        assert not manager._port_open(port)
        saved = (manager.directory / 'api.log').read_text()
        assert 'shared-secret-value' not in saved
        assert 'alice:private' not in saved
        assert '[masked]' in saved
    finally:
        record = manager._owned('api')
        if record:
            os.killpg(record['pid'], local.signal.SIGKILL)
            manager._children['api'].wait(timeout=5)


def test_file_interpolation_does_not_reintroduce_deleted_secrets(manager, monkeypatch):
    monkeypatch.setenv('REMOVED_SECRET', 'stale-secret')
    (local.settings.REPO_ROOT / '.env.local').write_text('LABEL=${REMOVED_SECRET:-clean-default}\n')
    assert manager.spec('api')['env']['LABEL'] == 'clean-default'


def test_bearer_authorization_is_fully_masked():
    assert 'private-value' not in local.redact_text('Authorization: Bearer private-value')


def test_start_all_failure_is_recorded_for_the_failed_service(manager, monkeypatch):
    monkeypatch.setattr(manager, '_launch_one', Mock(side_effect=RuntimeError('Could not launch chat')))
    with pytest.raises(RuntimeError):
        manager._start_one('chat', Mock(cancelled=False))
    assert local.read_state(manager.directory / 'chat.failure.json')['message'] == 'Could not launch chat'


def test_config_change_during_snapshot_never_launches_mismatched_revision(manager, monkeypatch):
    monkeypatch.setattr(manager, '_owned', lambda _: None)
    monkeypatch.setattr(manager, '_port_open', lambda _: False)
    original = manager.spec
    version = ['before']
    monkeypatch.setattr(manager, 'revision', lambda _: version[0])
    def spec(service):
        value = original(service)
        (local.settings.REPO_ROOT / '.env.local').write_text('JWT_SECRET=new-value\n')
        version[0] = 'after'
        return value
    monkeypatch.setattr(manager, 'spec', spec)
    popen = Mock()
    monkeypatch.setattr(local.subprocess, 'Popen', popen)
    with pytest.raises(RuntimeError, match='Source changed'):
        manager._start_one('api', Mock(cancelled=False))
    popen.assert_not_called()


def test_backend_returns_actions_and_disabled_reasons(manager, monkeypatch):
    monkeypatch.setattr(manager, '_status_details', lambda _: {'status': 'ready', 'managed': True, 'update_available': True})
    docker = manager._status_one('docker')
    actions = {action['id']: action for action in docker['actions']}
    assert not actions['start']['enabled']
    assert actions['start']['reason'] == 'Already running'
    assert actions['stop']['confirmation']
    assert 'update' not in actions
    api = manager._status_one('api')
    assert next(action for action in api['actions'] if action['id'] == 'update')['enabled']
    monkeypatch.setattr(manager, '_status_details', lambda _: {'status': 'ready', 'managed': False, 'external': True, 'update_available': True})
    external = manager._status_one('api')
    assert all(not action['enabled'] for action in external['actions'])


def test_stopped_container_ignores_stale_starting_health(manager, monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(manager, '_local_docker', lambda: None)
    monkeypatch.setattr(local.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=0, stdout=json.dumps({
        'Running': False, 'Status': 'exited', 'Health': {'Status': 'starting'},
    })))
    status = manager._status_one('opensearch')
    assert status['status'] == 'stopped'
    actions = {action['id']: action for action in status['actions']}
    assert actions['start']['enabled']
    assert not actions['stop']['enabled']


def test_running_container_reports_starting_until_http_ready(manager, monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(manager, '_local_docker', lambda: None)
    monkeypatch.setattr(local.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=0, stdout=json.dumps({
        'Running': True, 'Status': 'running', 'Health': {'Status': 'starting'},
    })))
    monkeypatch.setattr(manager, '_health', Mock(side_effect=OSError('Not ready')))
    status = manager._status_one('opensearch')
    assert status['status'] == 'starting'
    assert not next(action for action in status['actions'] if action['id'] == 'start')['enabled']
    monkeypatch.setattr(manager, '_health', lambda _: True)
    assert manager._status_one('opensearch')['status'] == 'ready'


def test_real_ui_launch_from_frontend_directory_finds_dashboard_modules(tmp_path, monkeypatch):
    """Exercise the UI's actual command and supervisor, without Node or app services."""
    from pathlib import Path
    import socket
    import time
    import urllib.request
    from types import SimpleNamespace
    monkeypatch.setattr(local.settings, 'REPO_ROOT', Path(local.__file__).resolve().parents[1])
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    monkeypatch.setitem(local.PORTS, 'ui', port)
    manager = local.Manager(tmp_path / 'state')
    build = tmp_path / 'build'
    build.mkdir()
    (build / 'index.html').write_text('<html>UI launch regression check</html>')
    spec = manager.spec('ui')
    spec['env'].pop('PYTHONPATH', None)  # The launcher must supply the module path.
    spec['command'][-1] = str(build)
    spec['command'].extend(['--port', str(port)])
    monkeypatch.setattr(manager, 'revision', lambda _: 'version')
    ctx = SimpleNamespace(cancelled=False, sleep=time.sleep, progress=lambda *_: None, log=lambda *_: None)
    try:
        manager._start_one('ui', ctx, prepared=(spec, 'version'))
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=3) as response:
            assert b'UI launch regression check' in response.read()
    finally:
        if manager._owned('ui'):
            manager._stop_one('ui', ctx)
