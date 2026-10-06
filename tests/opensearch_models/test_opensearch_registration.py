"""Check model reuse, task failures, and inference parity enforcement."""
import importlib.util
from pathlib import Path
from unittest.mock import patch

import pytest

SPEC = importlib.util.spec_from_file_location(
    'registration', Path(__file__).resolve().parents[2] / 'scripts/register_opensearch_models.py')
registration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(registration)


def test_find_model_ignores_chunks_and_other_functions():
    manifest = {'name': 'BAAI/bge-m3', 'version': 'fp32-commit', 'model_content_hash_value': 'hash', 'function_name': 'TEXT_EMBEDDING'}
    hits = [
        {'_id': 'chunk', '_source': manifest},
        {'_id': 'old', '_source': {**manifest, 'algorithm': 'TEXT_SIMILARITY', 'model_config': {}}},
        {'_id': 'model', '_source': {**manifest, 'algorithm': 'TEXT_EMBEDDING', 'model_version': '1', 'model_config': {}}},
    ]
    with patch.object(registration, 'request', return_value={'hits': {'hits': hits}}):
        assert registration.find_model('http://localhost:9200', manifest) == 'model'


def test_task_failure_is_not_silently_accepted():
    with patch.object(registration, 'request', return_value={'state': 'FAILED', 'error': 'out of memory'}):
        with pytest.raises(RuntimeError, match='out of memory'):
            registration.poll('http://localhost:9200', 'task', 1)


def test_prediction_checks_query_and_score():
    response = {'inference_results': [{'output': [{'name': 'similarity', 'data': [0.7]}]}]}
    fixture = [{'text': 'document', 'text_pair': 'query', 'expected': [0.7]}]
    with patch.object(registration, 'request', return_value=response) as call:
        registration.verify('http://localhost:9200', 'model', {'function_name': 'TEXT_SIMILARITY'}, fixture)
        assert call.call_args.args[3]['query_text'] == 'query'
        assert call.call_args.args[3]['text_docs'] == ['document']
    fixture[0]['expected'] = [0.2]
    with patch.object(registration, 'request', return_value=response):
        with pytest.raises(RuntimeError, match='predictions differ'):
            registration.verify('http://localhost:9200', 'model', {'function_name': 'TEXT_SIMILARITY'}, fixture)


def test_deployment_checks_memory_profile_after_restart():
    responses = [
        {'nodes': {'node': {'models': {}}}},
        {'hits': {'hits': []}},
        {'task_id': 'deploy-task'},
    ]
    with patch.object(registration, 'request', side_effect=responses) as call, \
            patch.object(registration, 'poll') as poll:
        registration.ensure_deployed('http://localhost:9200', 'model', 60)
        assert call.call_args.args[2] == '/_plugins/_ml/models/model/_deploy'
        poll.assert_called_once_with('http://localhost:9200', 'deploy-task', 60)
