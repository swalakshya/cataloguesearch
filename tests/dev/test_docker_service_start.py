"""Discover's Docker dependency shares the navbar recovery, without touching a real VM."""
from unittest.mock import Mock

import pytest

from deploy import docker_health, docker_restart, local_services


@pytest.fixture
def service(tmp_path, monkeypatch):
    manager = local_services.Manager(tmp_path)
    monkeypatch.setattr(manager, '_local_docker', Mock())
    return manager.service('docker')


def test_ready_docker_is_reused(service, monkeypatch):
    monkeypatch.setattr(docker_health, 'check', lambda: {'status': 'ok', 'message': 'Docker answers'})
    restart = Mock()
    monkeypatch.setattr(docker_restart, '_restart', restart)
    service.start(Mock(cancelled=False))
    restart.assert_not_called()


@pytest.mark.parametrize('state', ['down', 'slow'], ids=['unresponsive', 'sluggish'])
def test_unhealthy_docker_uses_navbar_recovery_in_current_job(service, monkeypatch, state):
    monkeypatch.setattr(docker_health, 'check', lambda: {'status': state, 'message': 'Docker not ready'})
    restart = Mock(return_value=0)
    monkeypatch.setattr(docker_restart, '_restart', restart)
    ctx = Mock(cancelled=False)
    service.start(ctx)
    restart.assert_called_once_with(ctx)
    ctx.log.assert_any_call('Docker not ready')


def test_recovery_failure_stops_service_preparation(service, monkeypatch):
    monkeypatch.setattr(docker_health, 'check', lambda: {'status': 'down', 'message': 'Docker not ready'})
    monkeypatch.setattr(docker_restart, '_restart', Mock(return_value=1))
    with pytest.raises(RuntimeError, match='recovery failed'):
        service.start(Mock(cancelled=False))


def test_cancelled_start_does_not_restart_runtime(service, monkeypatch):
    check, restart = Mock(), Mock()
    monkeypatch.setattr(docker_health, 'check', check)
    monkeypatch.setattr(docker_restart, '_restart', restart)
    with pytest.raises(RuntimeError, match='cancelled'):
        service.start(Mock(cancelled=True))
    check.assert_not_called()
    restart.assert_not_called()


def test_status_uses_the_same_probe_as_navbar(service, monkeypatch):
    monkeypatch.setattr(docker_health, 'get', lambda: {'status': 'ok'})
    assert service.health()
    monkeypatch.setattr(docker_health, 'get', lambda: {'status': 'slow'})
    assert not service.health()


def test_start_runs_stop_start_and_readiness_checks(service, monkeypatch):
    results = iter([
        {'status': 'down', 'message': 'Docker is stuck'},
        {'status': 'ok', 'message': 'Docker answers', 'seconds': .1},
    ])
    monkeypatch.setattr(docker_health, 'check', lambda: next(results))
    monkeypatch.setattr(docker_restart.settings, 'ORB_BIN', '/test/orb')
    commands = []
    monkeypatch.setattr(docker_restart, '_run', lambda ctx, argv, timeout: commands.append(argv) or 0)
    monkeypatch.setattr(docker_restart, '_opensearch_state', lambda: 'healthy')
    ctx = Mock(cancelled=False)
    service.start(ctx)
    assert commands == [['/test/orb', 'stop'], ['/test/orb', 'start']]
    ctx.progress.assert_any_call('Waiting for Docker to answer', index=3, of=4)
