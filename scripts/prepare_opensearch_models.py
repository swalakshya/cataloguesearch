#!/usr/bin/env python3
"""Export CPU FP32 BGE models and package them for OpenSearch ML Commons."""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import zipfile

MODELS = {
    'embedding': ('BAAI/bge-m3', 'TEXT_EMBEDDING', 8192),
    'reranker': ('BAAI/bge-reranker-base', 'TEXT_SIMILARITY', 512),
}


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def prepare(kind, output, revision):
    # Keep ML dependencies out of --help and the runtime registration script.
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    from transformers import AutoModel, AutoModelForSequenceClassification, AutoTokenizer

    model_name, function, max_length = MODELS[kind]
    slug = model_name.split('/')[-1]
    destination = output / slug
    destination.mkdir(parents=True, exist_ok=True)
    if (destination / 'manifest.json').exists():
        raise ValueError(f'{destination} already has a manifest; choose a new output directory.')
    tokenizer = AutoTokenizer.from_pretrained(model_name, revision=revision)
    cls = AutoModel if kind == 'embedding' else AutoModelForSequenceClassification
    model = cls.from_pretrained(model_name, revision=revision, attn_implementation='eager').cpu().float().eval()
    resolved_revision = model.config._commit_hash
    if not resolved_revision:
        raise ValueError('Could not resolve the model revision.')

    class Wrapper(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder = model

        def forward(self, input_ids, attention_mask):
            result = self.encoder(input_ids=input_ids, attention_mask=attention_mask, return_dict=True)
            if kind == 'embedding':
                return result.last_hidden_state
            # Existing API returns sigmoid(logits), not raw logits.
            return torch.sigmoid(result.logits)

    wrapper = Wrapper().eval()
    example = tokenizer(['आत्मा क्या है?', 'આત્મા શું છે?'],
                        ['આત્મા ચેતન છે.', 'आत्मा चेतन है।'] if kind == 'reranker' else None,
                        padding=True, return_tensors='pt')
    samples = ['आत्मा चेतन है।', 'આત્મા ચેતન છે.', 'What is the nature of the soul?']
    fixture = []
    with tempfile.TemporaryDirectory(dir=destination) as temp:
        work = Path(temp)
        graph = work / 'model.onnx'
        batch = torch.export.Dim('batch', min=1)
        sequence = torch.export.Dim('sequence', min=2, max=max_length)
        torch.onnx.export(
            wrapper, (example['input_ids'], example['attention_mask']), str(graph),
            input_names=['input_ids', 'attention_mask'],
            output_names=['token_embeddings' if kind == 'embedding' else 'similarity'],
            dynamic_shapes=({0: batch, 1: sequence}, {0: batch, 1: sequence}),
            opset_version=18, dynamo=True, external_data=True,
        )
        exported = onnx.load(str(graph), load_external_data=False)
        # OpenSearch 3.6 ships ONNX Runtime 1.16.3 (maximum ONNX IR 9).
        # This graph uses opset 18 and no IR 10 features.
        exported.ir_version = 9
        if kind == 'reranker':
            # OpenSearch 3.6's TextSimilarityTranslator always supplies this
            # tensor. XLM-R does not use it, but the ONNX interface must accept it.
            exported.graph.input.append(onnx.helper.make_tensor_value_info(
                'token_type_ids', onnx.TensorProto.INT64, ['batch', 'sequence']))
        onnx.save(exported, str(graph))
        onnx.checker.check_model(str(graph))
        tokenizer.save_pretrained(work)
        # DJL reads tokenizer.json directly, rather than tokenizer_config.json.
        tokenizer.backend_tokenizer.enable_truncation(max_length=max_length)
        tokenizer.backend_tokenizer.save(str(work / 'tokenizer.json'))
        session = ort.InferenceSession(str(graph), providers=['CPUExecutionProvider'])
        for text in samples:
            inputs = tokenizer(samples[0] if kind == 'reranker' else text,
                               text if kind == 'reranker' else None,
                               truncation=True, max_length=max_length, return_tensors='pt')
            with torch.no_grad():
                expected = wrapper(inputs['input_ids'], inputs['attention_mask']).numpy()
            feed = {name: inputs[name].numpy() for name in ('input_ids', 'attention_mask')}
            if kind == 'reranker':
                feed['token_type_ids'] = np.zeros_like(feed['input_ids'])
            actual = session.run(None, feed)[0]
            if kind == 'embedding':
                expected = expected[:, 0, :]
                actual = actual[:, 0, :]
                expected /= np.linalg.norm(expected, axis=-1, keepdims=True)
                actual /= np.linalg.norm(actual, axis=-1, keepdims=True)
            np.testing.assert_allclose(actual, expected, rtol=1e-3, atol=1e-4)
            fixture.append({'text': text, 'text_pair': samples[0] if kind == 'reranker' else None,
                            'expected': expected.reshape(-1).tolist()})
        del session
        archive = destination / 'model.zip'
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as package:
            for item in sorted(work.iterdir()):
                if item.is_file():
                    package.write(item, item.name)
    config = {'model_type': model.config.model_type, 'framework_type': 'huggingface_transformers',
              'embedding_dimension': model.config.hidden_size,
              'all_config': json.dumps(model.config.to_dict())}
    if kind == 'embedding':
        config.update(pooling_mode='CLS', normalize_result=True)
    manifest = {'name': model_name, 'version': 'fp32-ir9-' + resolved_revision,
                'model_format': 'ONNX', 'function_name': function, 'model_config': config,
                'model_content_hash_value': sha256(archive),
                'model_content_size_in_bytes': archive.stat().st_size}
    (destination / 'fixture.json').write_text(json.dumps(fixture, ensure_ascii=False, indent=2))
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    # The production image enforces 1024 embedding / 512 reranking tokens.
    # Include long references so readiness detects an unpatched translator.
    from prepare_opensearch_fixtures import prepare_fixtures
    prepare_fixtures(destination)
    print(f'Prepared and locally validated {destination}')


def main(default_model='both'):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=[*MODELS, 'both'], default=default_model)
    parser.add_argument('--output', type=Path, default=Path('models/opensearch'))
    parser.add_argument('--revision', default='main', help='Hugging Face revision; resolved commit is recorded')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for kind in MODELS if args.model == 'both' else [args.model]:
        prepare(kind, args.output, args.revision)


if __name__ == '__main__':
    main()
