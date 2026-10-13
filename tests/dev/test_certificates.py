"""Renewal job orchestration and migration safeguards; no production writes."""
from pathlib import Path
from unittest.mock import Mock
import asyncio
import subprocess

import pytest
from fastapi import HTTPException

from deploy import api, certificates, certificate_maintenance as maintenance
from deploy.runner import Busy


def test_confirmation_and_shared_job_lock(monkeypatch):
    start = Mock(side_effect=Busy('existing-run'))
    monkeypatch.setattr(certificates, 'start_renewal', start)
    with pytest.raises(HTTPException) as error:
        asyncio.run(api.renew_certificate(api.RenewCertificateRequest(confirmation='wrong')))
    assert error.value.status_code == 422
    start.assert_not_called()
    with pytest.raises(HTTPException) as error:
        asyncio.run(api.renew_certificate(api.RenewCertificateRequest(confirmation='prod')))
    assert error.value.status_code == 409


def test_steps_are_serial_and_do_not_need_local_docker(monkeypatch):
    start = Mock(return_value='renewal')
    monkeypatch.setattr(certificates.runner, 'start', start)
    assert certificates.start_renewal() == 'renewal'
    assert start.call_args.args[0] == 'certificates'
    assert [step.name for step in start.call_args.args[2]] == ['prepare', 'renew', 'verify']


@pytest.mark.parametrize('message', ['Certificate not found', 'No such authorization'])
def test_staging_missing_resource_retries_but_validation_error_does_not(monkeypatch, message):
    run = Mock(side_effect=[Mock(returncode=1, stdout='', stderr=message), Mock(returncode=0, stdout='Test passed', stderr='')])
    monkeypatch.setattr(maintenance.subprocess, 'run', run)
    sleep = Mock()
    monkeypatch.setattr(maintenance.time, 'sleep', sleep)
    maintenance.reconfigure_webroot()
    assert run.call_count == 2
    sleep.assert_called_once_with(15)
    run.reset_mock(side_effect=True)
    run.return_value = Mock(returncode=1, stdout='Some challenges have failed', stderr='')
    with pytest.raises(RuntimeError, match='webroot test failed'):
        maintenance.reconfigure_webroot()
    assert run.call_count == 1


@pytest.mark.parametrize('messages', [
    ['Certificate not found'] * 3,
    ['No such authorization'] * 3,
    ['Certificate not found', 'No such authorization', 'Certificate not found'],
])
def test_staging_retries_are_bounded(monkeypatch, messages):
    run = Mock(side_effect=[Mock(returncode=1, stdout=message, stderr='') for message in messages])
    monkeypatch.setattr(maintenance.subprocess, 'run', run)
    sleep = Mock()
    monkeypatch.setattr(maintenance.time, 'sleep', sleep)
    with pytest.raises(RuntimeError):
        maintenance.reconfigure_webroot()
    assert run.call_count == 3
    assert [call.args[0] for call in sleep.call_args_list] == [15, 30]


def test_hook_backups_are_not_executable(tmp_path):
    hook = tmp_path / 'reload-nginx.sh'
    hook.write_text('old hook')
    hook.chmod(0o755)
    maintenance.write_hook(hook, maintenance.DEPLOY_HOOK)
    backup = tmp_path / 'reload-nginx.sh.before-webroot'
    assert backup.read_text() == 'old hook'
    assert backup.stat().st_mode & 0o111 == 0
    assert hook.stat().st_mode & 0o111


def test_nginx_migration_preserves_https_and_rolls_back_invalid_config(monkeypatch):
    original = '''http {
    server {
        listen 80;
        return 301 https://$host$request_uri;
    }
    server {
        listen 80;
        return 301 https://swalakshya.me/chat;
    }
    server {
        listen 443 ssl;
        return 301 https://swalakshya.me/chat;
    }
}'''
    commands = []
    def fake_run(argv, **kwargs):
        commands.append((argv, kwargs.get('input')))
        if 'cat' in argv:
            return Mock(returncode=0, stdout=original)
        if argv[-2:] == ['nginx', '-t'] and sum(args[-2:] == ['nginx', '-t'] for args, _ in commands) == 1:
            return Mock(returncode=1, stderr='Invalid config')
        return Mock(returncode=0, stdout='')
    monkeypatch.setattr(subprocess, 'run', fake_run)
    monkeypatch.setattr(Path, 'mkdir', lambda *a, **kw: None)
    with pytest.raises(RuntimeError, match='Invalid config'):
        exec(maintenance.PRE_HOOK, {})
    writes = [data for argv, data in commands if 'tee' in argv]
    assert len(writes) == 2
    assert writes[0].count('root /etc/letsencrypt/webroot;') == 2
    assert 'listen 443 ssl;\n        return 301 https://swalakshya.me/chat;' in writes[0]
    assert writes[1] == original
