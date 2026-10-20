"""Preserve local XLM-R tokenization when avoiding Transformers' Mistral warning."""
import json
import logging
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize('model_type, expected_options', [('xlm-roberta', {'fix_mistral_regex': False}), ('mistral', {})])
def test_mistral_override_only_applies_to_xlm_roberta(tmp_path, monkeypatch, model_type, expected_options):
    from backend.common import reranker
    (tmp_path / 'config.json').write_text(json.dumps({'model_type': model_type}))
    session = SimpleNamespace(get_inputs=lambda: [SimpleNamespace(name='input_ids')],
                              get_outputs=lambda: [SimpleNamespace(name='logits')])
    monkeypatch.setattr(reranker.ort, 'InferenceSession', lambda *args, **kwargs: session)
    calls = []
    monkeypatch.setattr(reranker.AutoTokenizer, 'from_pretrained', lambda path, **kwargs: calls.append(kwargs))
    reranker.ONNXReranker(str(tmp_path))
    assert calls == [expected_options]


def test_real_xlm_roberta_encoding_is_unchanged_and_has_no_mistral_warning(monkeypatch, caplog):
    from backend.common import reranker
    path = Path(__file__).resolve().parents[2] / 'models/bge-reranker-base-onnx'
    if not (path / 'tokenizer.json').is_file():
        pytest.skip('Local reranker tokenizer is not installed')
    # The reference load intentionally uses the old behavior; keep its known warning
    # out of normal test-run logs, then check the new loader at the usual level.
    with caplog.at_level(logging.ERROR, logger='transformers.tokenization_utils_base'):
        baseline = reranker.AutoTokenizer.from_pretrained(str(path))
    samples = ['What is machine learning?', 'धर्म और अहिंसा', 'ધર્મ અને અહિંસા']
    expected = baseline(samples)['input_ids']
    caplog.clear()
    session = SimpleNamespace(get_inputs=lambda: [SimpleNamespace(name='input_ids')],
                              get_outputs=lambda: [SimpleNamespace(name='logits')])
    monkeypatch.setattr(reranker.ort, 'InferenceSession', lambda *args, **kwargs: session)
    actual = reranker.ONNXReranker(str(path)).tokenizer
    assert actual(samples)['input_ids'] == expected
    assert type(actual.backend_tokenizer.pre_tokenizer).__name__ == 'Metaspace'
    assert not any('incorrect regex pattern' in record.message for record in caplog.records)
