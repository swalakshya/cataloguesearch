"""Deploy selections are tested without Docker, SSH, or production writes."""
import asyncio
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from deploy import actions, api, settings


def test_pull_restart_only_selected_services(monkeypatch):
    monkeypatch.setattr(settings, 'PROD_DIR', '~/deploy folder')
    cmds = actions.commands_for('pull_restart', {'build_services': ['cataloguesearch-chat']})
    assert len(cmds) == 2
    pull, restart = [cmd.argv[-1] for cmd in cmds]
    assert '"$HOME"' in pull
    assert "'deploy folder'" in pull
    assert 'docker-compose --env-file .env.prod -f docker-compose.prod.yml pull cataloguesearch-chat' in pull
    assert 'up -d --no-deps --no-build --force-recreate cataloguesearch-chat' in restart
    assert 'cataloguesearch-api' not in pull + restart
    assert ' down' not in pull + restart


def test_both_actions_run_build_before_restart(monkeypatch):
    start = Mock(return_value='run')
    monkeypatch.setattr(actions.runner, 'start', start)
    actions.start_deploy(['pull_restart', 'build'], {'build_services': ['cataloguesearch-api']})
    assert [s.name for s in start.call_args.args[2]] == ['build', 'pull_restart']


def test_failed_pull_does_not_restart(monkeypatch):
    monkeypatch.setattr(actions.db, 'update_step', Mock())
    ctx = Mock(run_id='run')
    ctx.run.return_value = 1
    result = actions._spec('pull_restart', {'build_services': ['cataloguesearch-api']}).fn(ctx)
    assert result == 1
    assert ctx.run.call_count == 1


@pytest.mark.parametrize('services', [[], ['not-a-service']])
def test_invalid_service_selection_rejected_before_run(monkeypatch, services):
    monkeypatch.setattr(api.checks, 'build_services', lambda: ['cataloguesearch-api'])
    start = Mock()
    monkeypatch.setattr(api, 'start_deploy', start)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(api.start_run(api.StartRunRequest(actions=['pull_restart'], build_services=services)))
    assert exc.value.status_code == 422
    start.assert_not_called()


def test_pull_only_does_not_require_local_docker(monkeypatch):
    monkeypatch.setattr(api.checks, 'build_services', lambda: ['cataloguesearch-api'])
    health = Mock(side_effect=AssertionError('local Docker must not be probed'))
    monkeypatch.setattr(api, '_require_docker', health)
    start = Mock(return_value='run')
    monkeypatch.setattr(api, 'start_deploy', start)
    result = asyncio.run(api.start_run(api.StartRunRequest(actions=['pull_restart'], build_services=['cataloguesearch-api'])))
    assert result == {'run_id': 'run'}
    assert start.call_args.args[1]['build_services'] == ['cataloguesearch-api']
    health.assert_not_called()
