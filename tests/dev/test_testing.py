import json
from pathlib import Path

from deploy.testing.store import RunStore, file_id, emit
from deploy.testing.coverage import python_coverage, summarize


def test_file_events_preserve_failures_and_logs_are_separate(tmp_path):
    store = RunStore(tmp_path)
    store.create('abc123', [{'suite': 'python', 'path': 'tests/a.py'}, {'suite': 'python', 'path': 'tests/b.py'}])
    emit(tmp_path / 'abc123', 'python', 'tests/a.py', 'start')
    emit(tmp_path / 'abc123', 'python', 'tests/a.py', 'test', test='a::first', status='failed', text='first failed')
    emit(tmp_path / 'abc123', 'python', 'tests/a.py', 'test', test='a::second', status='passed', text='second passed')
    emit(tmp_path / 'abc123', 'python', 'tests/a.py', 'finish')
    data = store.snapshot('abc123')
    rows = {row['path']: row for row in data['files']}
    assert rows['tests/a.py']['status'] == 'failed'
    assert rows['tests/a.py']['counts']['passed'] == 1
    assert rows['tests/b.py']['status'] == 'pending'
    assert 'first failed' in store.details('abc123', file_id('python', 'tests/a.py'))['text']
    assert store.details('abc123', file_id('python', 'tests/b.py'))['text'] == ''


def test_suite_failure_leaves_unexecuted_files_explicitly_blocked(tmp_path):
    store = RunStore(tmp_path)
    store.create('abc123', [{'suite': 'chat', 'path': 'test/a.test.js'}])
    emit(tmp_path / 'abc123', 'chat', '__setup__', 'error', text='Missing Node')
    emit(tmp_path / 'abc123', 'chat', '__setup__', 'suite_end', status='blocked')
    rows = store.snapshot('abc123')['files']
    assert next(row for row in rows if row['path'] == '__setup__')['status'] == 'failed'
    assert next(row for row in rows if row['path'] != '__setup__')['status'] == 'blocked'


def test_python_coverage_includes_missing_lines_and_context_attribution():
    payload = {'files': {'backend/example.py': {'summary': {'num_statements': 4, 'covered_lines': 1, 'num_branches': 2, 'covered_branches': 0},
               'executed_lines': [1], 'missing_lines': [2, 3, 4], 'contexts': {'1': ['tests/test_example.py::test_one|run']}}}}
    data = python_coverage(payload)
    assert data['files'][0]['missing_lines'] == [2, 3, 4]
    assert data['files'][0]['tests'] == ['tests/test_example.py']
    assert summarize(data['files'])['lines']['pct'] == 25


def test_run_paths_cannot_escape_report_directory(tmp_path):
    store = RunStore(tmp_path)
    import pytest
    with pytest.raises(ValueError):
        store.snapshot('../../private')


def test_partial_event_is_only_consumed_after_newline(tmp_path):
    store = RunStore(tmp_path)
    store.create('abc123', [{'suite': 'python', 'path': 'tests/a.py'}])
    events = tmp_path / 'abc123/events-python.jsonl'
    event = json.dumps(dict(suite='python', path='tests/a.py', kind='start'))
    events.write_text(event[:20])
    assert store.snapshot('abc123')['files'][0]['status'] == 'pending'
    with events.open('a') as stream:
        stream.write(event[20:] + '\n')
    assert store.snapshot('abc123')['files'][0]['status'] == 'running'


def test_test_environment_does_not_inherit_live_config(tmp_path, monkeypatch):
    from deploy.testing.worker import environment
    monkeypatch.setenv('CONFIG_PATH', '/production/config.yaml')
    monkeypatch.setenv('SESSION_DB_PATH', '/production/chat.sqlite')
    monkeypatch.setenv('REACT_APP_API_BASE_URL', 'https://production.example/api')
    env = environment('python', tmp_path)
    assert env['CONFIG_PATH'].endswith('tests/data/configs/test_config.yaml')
    assert env['TEST_BASE_DIR'].endswith('/tests')
    assert 'SESSION_DB_PATH' not in env
    assert 'REACT_APP_API_BASE_URL' not in env
    assert env['DEPLOY_DATA_DIR'].startswith(str(tmp_path))


def test_api_guards_test_runs_and_log_paths(tmp_path, monkeypatch, jobs_env):
    from fastapi.testclient import TestClient
    from dev import app
    from deploy.testing import manager
    monkeypatch.setattr(manager, 'store', RunStore(tmp_path))
    manager.store.create('abc123', [{'suite': 'python', 'path': 'tests/a.py'}])
    emit(tmp_path / 'abc123', 'python', 'tests/a.py', 'log', text='file only')
    client = TestClient(app)
    assert client.post('/api/testing/runs', json={}, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.post('/api/testing/runs', json={'suites': []}).status_code == 422
    assert client.post('/api/testing/runs', json={'suites': ['unknown']}).status_code == 422
    identifier = file_id('python', 'tests/a.py')
    response = client.get(f'/api/testing/runs/abc123/files/{identifier}/logs')
    assert response.status_code == 200
    assert response.json()['text'] == 'file only\n'
    assert client.get('/api/testing/runs/abc123/files/unknown/logs').status_code == 404
    assert client.get('/api/testing/runs/abc123/coverage/frontend').json()['available'] is False


def test_pytest_reporter_routes_failures_skips_and_setup_logs(tmp_path):
    import os
    import subprocess
    import sys
    root = Path(__file__).resolve().parents[2]
    samples = tmp_path / 'sample_tests'
    samples.mkdir()
    (samples / 'test_a.py').write_text('def test_a():\n    print("file A output")\n    assert False, "A failed"\n')
    (samples / 'test_b.py').write_text('import pytest\n@pytest.mark.skip(reason="sample skip")\ndef test_b(): pass\n')
    store = RunStore(tmp_path / 'reports')
    store.create('abc123', [{'suite': 'python', 'path': 'test_a.py'}, {'suite': 'python', 'path': 'test_b.py'}])
    env = dict(os.environ, PYTHONPATH=str(root), DASHBOARD_TEST_OUTPUT=str(tmp_path / 'reports/abc123'))
    result = subprocess.run([sys.executable, '-m', 'pytest', str(samples), '--confcutdir', str(samples), '-p', 'deploy.testing.pytest_reporter', '-q'],
                            cwd=samples, env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 1, result.stdout + result.stderr
    rows = {row['path']: row for row in store.snapshot('abc123')['files']}
    assert rows['test_a.py']['status'] == 'failed'
    assert rows['test_b.py']['status'] == 'skipped'
    a = store.details('abc123', file_id('python', 'test_a.py'))
    b = store.details('abc123', file_id('python', 'test_b.py'))
    assert a['text'].count('file A output\n') == 1
    assert a['text'].count('AssertionError: A failed') == 1
    assert 'file A output' not in b['text']


def test_remote_docker_is_refused_before_test_container_changes(tmp_path, monkeypatch):
    import pytest
    from deploy.testing import worker
    called = []
    monkeypatch.setattr(worker, 'execute', lambda *args: called.append(args))
    with pytest.raises(RuntimeError, match='local Docker'):
        worker.prepare_python({'DOCKER_HOST': 'ssh://production.example'}, tmp_path)
    assert called == []


def test_cancelled_job_marks_unfinished_files_interrupted(tmp_path, monkeypatch):
    from deploy import db
    store = RunStore(tmp_path)
    store.create('abc123', [{'suite': 'python', 'path': 'tests/a.py'}])
    emit(tmp_path / 'abc123', 'python', 'tests/a.py', 'start')
    monkeypatch.setattr(db, 'get_run', lambda _: {'status': 'cancelled'})
    assert store.snapshot('abc123')['files'][0]['status'] == 'interrupted'


def test_completed_file_updates_before_suite_ends(tmp_path):
    from deploy.testing import pytest_reporter as reporter
    from types import SimpleNamespace
    from unittest.mock import patch
    store = RunStore(tmp_path)
    store.create('abc123', [{'suite': 'python', 'path': 'tests/a.py'}, {'suite': 'python', 'path': 'tests/b.py'}])
    with patch.dict('os.environ', {'DASHBOARD_TEST_OUTPUT': str(tmp_path / 'abc123')}):
        reporter.pytest_collection_finish(SimpleNamespace(items=[SimpleNamespace(nodeid='tests/a.py::a'), SimpleNamespace(nodeid='tests/b.py::b')]))
        reporter.pytest_runtest_logstart('tests/a.py::a', None)
        emit(tmp_path / 'abc123', 'python', 'tests/a.py', 'test', test='a', status='passed')
        reporter.pytest_runtest_logfinish('tests/a.py::a', None)
        rows = {r['path']: r['status'] for r in store.snapshot('abc123')['files']}
        assert rows['tests/a.py'] == 'succeeded'
        assert rows['tests/b.py'] == 'pending'


def test_opensearch_uses_local_image_platform_instead_of_laptop(tmp_path, monkeypatch):
    import io
    from deploy.testing import worker
    commands = []
    monkeypatch.setattr(worker.subprocess, 'check_output', lambda argv, **kw: 'linux/amd64\n')
    monkeypatch.setattr(worker, 'execute', lambda argv, cwd, env, *args: commands.append((argv, dict(env))) or 0)
    monkeypatch.setattr(worker.urllib.request, 'urlopen', lambda *args, **kw: io.StringIO('{"status":"green"}'))
    env = {'DOCKER_HOST': 'unix:///local/docker.sock', 'DOCKER_PLATFORM': 'linux/arm64'}
    worker.prepare_python(env, tmp_path)
    assert commands[0][1]['DOCKER_PLATFORM'] == 'linux/amd64'
    assert commands[0][0][-1] == 'opensearch-test'
    assert '--no-build' in commands[0][0]
    assert '--remove-orphans' not in commands[0][0]


def test_pytest_root_paths_match_discovered_files(monkeypatch):
    from deploy.testing import pytest_reporter as reporter
    monkeypatch.setattr(reporter, '_root', reporter._REPO / 'tests')
    assert reporter.report_path('backend/integration_test.py') == 'tests/backend/integration_test.py'
    assert reporter.report_path('accuracy/test_accuracy_mode.py') == 'tests/accuracy/test_accuracy_mode.py'


def test_old_worker_paths_update_existing_rows_and_keep_their_logs(tmp_path):
    store = RunStore(tmp_path)
    store.create('abc123', [{'suite': 'python', 'path': 'tests/backend/a.py'}])
    emit(tmp_path / 'abc123', 'python', 'backend/a.py', 'start')
    emit(tmp_path / 'abc123', 'python', 'backend/a.py', 'log', text='existing worker output')
    rows = store.snapshot('abc123')['files']
    assert len(rows) == 2  # One discovered file and one setup row, without duplicates.
    assert rows[0]['status'] == 'running'
    assert 'existing worker output' in store.details('abc123', file_id('python', 'tests/backend/a.py'))['text']


def test_setup_phase_and_activity_are_exposed(tmp_path):
    store = RunStore(tmp_path)
    store.create('abc123', [{'suite': 'python', 'path': 'tests/a.py'}])
    emit(tmp_path / 'abc123', 'python', '__setup__', 'phase', text='Waiting for test OpenSearch')
    emit(tmp_path / 'abc123', 'python', '__setup__', 'log', text='Preparing bookmark cache', activity='Preparing bookmark cache')
    setup = next(f for f in store.snapshot('abc123')['files'] if f['path'] == '__setup__')
    assert setup['phase'] == 'Waiting for test OpenSearch'
    assert setup['activity'] == 'Preparing bookmark cache'
