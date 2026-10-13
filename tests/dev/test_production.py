"""Production visibility never invokes renewal, deployment, or apt update."""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest

from deploy import api, production, production_probe as probe


@pytest.fixture(autouse=True)
def clear_status_cache():
    production.forget()
    yield
    production.forget()


def test_ssh_failure_is_reported(monkeypatch):
    monkeypatch.setattr(production.subprocess, 'run', Mock(return_value=Mock(returncode=255, stderr='Permission denied')))
    report = production.status()
    assert not report['reachable']
    assert report['error'] == 'Permission denied'


@pytest.mark.parametrize('stdout', ['garbage', '[]', '{}'])
def test_invalid_probe_response(monkeypatch, stdout):
    monkeypatch.setattr(production.subprocess, 'run', Mock(return_value=Mock(returncode=0, stdout=stdout)))
    assert not production.status()['reachable']


def test_endpoint_and_ssh_probe(monkeypatch):
    payload = dict(system={}, updates={}, certificates=[], renewal={}, endpoints=[])
    run = Mock(return_value=Mock(returncode=0, stdout=json.dumps(payload)))
    monkeypatch.setattr(production.subprocess, 'run', run)
    report = asyncio.run(api.production_status())
    assert report['reachable']
    assert run.call_args.args[0][-1] == 'python3 -'
    assert 'def collect()' in run.call_args.kwargs['input']
    assert all(route.methods == {'GET'} for route in api.router.routes if route.path == '/deploy/production')


@pytest.mark.parametrize('offset,expired', [(8, False), (-1, True)])
def test_certificate_expiry_and_domains(monkeypatch, offset, expired):
    expires = datetime.now(timezone.utc) + timedelta(days=offset, hours=1)
    output = ('notBefore=Jul 24 00:40:16 2026 GMT\n'
              f'notAfter={expires.strftime("%b %d %H:%M:%S %Y GMT")}\n'
              "issuer=C = US, O = Let's Encrypt, CN = YE2\n"
              'X509v3 Subject Alternative Name:\n    DNS:swalakshya.me, DNS:www.swalakshya.me')
    monkeypatch.setattr(probe, 'command', lambda *a, **kw: output)
    cert = probe.certificate(b'der certificate', der=True)
    assert cert['expired'] is expired
    assert cert['days_remaining'] == offset
    assert cert['domains'] == ['swalakshya.me', 'www.swalakshya.me']


def test_partial_failure_and_disk_mismatch(monkeypatch):
    monkeypatch.setattr(probe, 'system', lambda: {'ubuntu': 'Ubuntu 24.04'})
    monkeypatch.setattr(probe, 'updates', Mock(side_effect=PermissionError('denied')))
    monkeypatch.setattr(probe, 'renewal', lambda: {'service': {'Result': 'exit-code'}})
    monkeypatch.setattr(probe, 'disk_certificates', lambda: [{'domains': ['swalakshya.me'], 'fingerprint': 'new'}])
    monkeypatch.setattr(probe, 'served', lambda host: {'domain': host, 'fingerprint': 'old', 'valid': True})
    report = probe.collect()
    assert report['updates']['error'] == 'denied'
    assert report['system']['ubuntu'] == 'Ubuntu 24.04'
    assert report['endpoints'][0]['matches_disk'] is False
    assert report['endpoints'][1]['matches_disk'] is None


def test_cached_updates_do_not_refresh_apt(monkeypatch):
    command = Mock(return_value='Listing...\nfoo/noble-security 1 amd64 [upgradable from: 0]\nbar/noble-updates 2 amd64 [upgradable from: 1]')
    monkeypatch.setattr(probe, 'command', command)
    assert probe.updates()['pending'] == 2
    assert probe.updates()['security'] == 1
    assert command.call_args.args[0] == ['apt', 'list', '--upgradable']


def test_served_validation_failure_still_reads_expiry(monkeypatch):
    import ssl
    verified = Mock()
    verified.wrap_socket.side_effect = ssl.SSLCertVerificationError('certificate expired')
    fallback = Mock()
    fallback.wrap_socket.return_value.__enter__ = Mock(return_value=Mock(getpeercert=Mock(return_value=b'der')))
    fallback.wrap_socket.return_value.__exit__ = Mock(return_value=False)
    sock = Mock()
    sock.__enter__ = Mock(return_value=sock)
    sock.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(probe.socket, 'create_connection', lambda *a, **kw: sock)
    monkeypatch.setattr(probe.ssl, 'create_default_context', lambda: verified)
    monkeypatch.setattr(probe.ssl, 'SSLContext', lambda *a: fallback)
    monkeypatch.setattr(probe, 'certificate', lambda *a, **kw: {'expired': True, 'days_remaining': -1})
    result = probe.served('swalakshya.me')
    assert result['valid'] is False
    assert result['expired'] is True
    assert 'certificate expired' in result['validation_error']
