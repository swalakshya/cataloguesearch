import asyncio
import json
import shlex
import subprocess
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deploy import api, production_logs as logs


@pytest.mark.parametrize('service', logs.SERVICES)
def test_service_selection_and_stderr_logs(monkeypatch, service):
    run = Mock(return_value=Mock(returncode=0, stdout=json.dumps({'text': 'error on application stderr\n', 'truncated': False})))
    monkeypatch.setattr(logs.subprocess, 'run', run)
    result = logs.snapshot(service, 100, '5m')
    assert result['reachable']
    assert result['text'] == 'error on application stderr\n'
    assert json.loads(shlex.split(run.call_args.args[0][-1])[-1]) == [logs.SERVICES[service], 100, '5m']
    assert 'stderr=subprocess.STDOUT' in run.call_args.kwargs['input']
    assert '--follow' not in run.call_args.kwargs['input']


@pytest.mark.parametrize('kwargs', [{'service': 'chat; touch /tmp/bad'}, {'lines': 501}, {'lines': 0}, {'since': 'all; reboot'}])
def test_invalid_input_never_calls_ssh(monkeypatch, kwargs):
    run = Mock()
    monkeypatch.setattr(logs.subprocess, 'run', run)
    with pytest.raises(ValueError):
        logs.snapshot(**kwargs)
    run.assert_not_called()


@pytest.mark.parametrize('result', [
    Mock(returncode=255, stderr='SSH unavailable'),
    Mock(returncode=0, stdout=json.dumps({'error': 'No such container'})),
    Mock(returncode=0, stdout='not json'),
])
def test_read_failures_are_reported(monkeypatch, result):
    monkeypatch.setattr(logs.subprocess, 'run', Mock(return_value=result))
    report = logs.snapshot()
    assert report['reachable'] is False
    assert report['error']
    assert report['text'] == ''


def test_ssh_timeout(monkeypatch):
    monkeypatch.setattr(logs.subprocess, 'run', Mock(side_effect=subprocess.TimeoutExpired('ssh', 30)))
    assert logs.snapshot()['reachable'] is False


def test_api_validates_limits_before_ssh(monkeypatch):
    app = FastAPI()
    app.include_router(api.router, prefix='/api')
    probe = Mock(return_value={'reachable': True, 'text': '', 'truncated': False})
    monkeypatch.setattr(logs, 'snapshot', probe)
    with TestClient(app) as client:
        assert client.get('/api/deploy/production/logs?service=unknown').status_code == 422
        assert client.get('/api/deploy/production/logs?lines=501').status_code == 422
        assert client.get('/api/deploy/production/logs?since=all').status_code == 422
        probe.assert_not_called()
        response = client.get('/api/deploy/production/logs?service=api&lines=500&since=1h')
        assert response.status_code == 200
        probe.assert_called_once_with('api', 500, '1h')


def test_remote_probe_caps_output_and_preserves_failure_code(monkeypatch, capsys):
    import sys
    monkeypatch.setattr(sys, 'argv', ['-', json.dumps(['cataloguesearch-chat', 500, '15m'])])
    monkeypatch.setattr(subprocess, 'run', Mock(return_value=Mock(returncode=0, stdout=b'x' * (logs.MAX_BYTES + 100))))
    exec(logs._REMOTE_PROBE, {})
    data = json.loads(capsys.readouterr().out)
    assert data['truncated'] is True
    assert len(data['text']) == logs.MAX_BYTES
    monkeypatch.setattr(subprocess, 'run', Mock(return_value=Mock(returncode=1, stdout=b'No such container')))
    exec(logs._REMOTE_PROBE, {})
    assert json.loads(capsys.readouterr().out)['error'] == 'No such container'
