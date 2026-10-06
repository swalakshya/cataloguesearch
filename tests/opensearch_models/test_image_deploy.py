"""The deploy UI must push the same bundled image that production pulls."""
from deploy import actions


def test_opensearch_build_uses_models_override_after_base():
    commands = actions.commands_for(actions.BUILD, {'build_services': ['opensearch']})
    assert len(commands) == 2
    assert commands[0].argv[:5] == ['docker', 'build', '--platform', 'linux/amd64', '-f']
    assert 'docker/opensearch/Dockerfile' in commands[0].argv
    assert 'docker-compose.models.yml' in commands[1].argv
    assert commands[1].argv[-3:] == ['build', '--push', 'opensearch']


def test_api_only_build_does_not_require_models():
    commands = actions.commands_for(actions.BUILD, {'build_services': ['cataloguesearch-api']})
    assert len(commands) == 1
    assert 'docker-compose.models.yml' not in commands[0].argv
