#!/usr/bin/env python3
"""Serve prepared BGE packages, register/deploy them, and check live inference."""
import argparse
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def request(base, method, path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = Request(base.rstrip('/') + path, data=data, method=method,
                  headers={'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=60) as response:
            return json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f'{method} {path}: {exc.code}: {exc.read().decode()}') from exc


def poll(base, task_id, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = request(base, 'GET', '/_plugins/_ml/tasks/' + task_id)
        if result['state'] == 'COMPLETED':
            return result
        if result['state'] in ('FAILED', 'COMPLETED_WITH_ERROR', 'CANCELLED'):
            raise RuntimeError('ML task failed: ' + json.dumps(result))
        time.sleep(2)
    raise TimeoutError('ML task timed out: ' + task_id)


def find_model(base, manifest):
    result = request(base, 'POST', '/_plugins/_ml/models/_search', {
        'size': 100, 'query': {'term': {'model_content_hash_value': manifest['model_content_hash_value']}}})
    matches = [hit for hit in result['hits']['hits']
               if hit['_source'].get('name') == manifest['name']
               and hit['_source'].get('algorithm') == manifest['function_name']
               and 'model_config' in hit['_source']]
    # OpenSearch assigns model_version itself; artifact version is not stored
    # as `version`. Reuse by name/function/checksum, preferring deployed models.
    matches.sort(key=lambda hit: (hit['_source'].get('model_state') != 'DEPLOYED',
                                  hit['_source'].get('created_time', 0), hit['_id']))
    return matches[0]['_id'] if matches else None


def ensure_group(base, name):
    result = request(base, 'POST', '/_plugins/_ml/model_groups/_search', {
        'size': 100, 'query': {'match_phrase': {'name': name}}})
    matches = [hit for hit in result['hits']['hits'] if hit['_source'].get('name') == name]
    if matches:
        return matches[0]['_id']
    return request(base, 'POST', '/_plugins/_ml/model_groups/_register', {'name': name})['model_group_id']


def ensure_deployed(base, model_id, timeout):
    # Persistent metadata can still say DEPLOYED just after a restart; check
    # the in-memory node profile before deciding to skip deployment.
    profile = request(base, 'GET', '/_plugins/_ml/profile/models/' + model_id)
    if any(node.get('models', {}).get(model_id, {}).get('model_state') == 'DEPLOYED'
           for node in profile.get('nodes', {}).values()):
        return
    tasks = request(base, 'POST', '/_plugins/_ml/tasks/_search', {
        'size': 10, 'sort': [{'create_time': 'desc'}], 'query': {'bool': {'filter': [
            {'term': {'model_id': model_id}}, {'term': {'task_type': 'DEPLOY_MODEL'}}]}}})
    active = [hit for hit in tasks['hits']['hits']
              if hit['_source'].get('state') in ('CREATED', 'RUNNING')]
    if active:
        poll(base, active[0]['_id'], timeout)
    else:
        task = request(base, 'POST', '/_plugins/_ml/models/' + model_id + '/_deploy', {})
        poll(base, task['task_id'], timeout)


def verify(base, model_id, manifest, fixture):
    kind = manifest['function_name'].lower()
    payload = {'text_docs': [item['text'] for item in fixture], 'return_number': True}
    if kind == 'text_similarity':
        payload['query_text'] = fixture[0]['text_pair']
    result = request(base, 'POST', f'/_plugins/_ml/_predict/{kind}/{model_id}', payload)
    name = 'sentence_embedding' if kind == 'text_embedding' else 'similarity'
    tensors = [tensor['data'] for inference in result['inference_results']
               for tensor in inference['output'] if tensor['name'] == name]
    if len(tensors) != len(fixture):
        raise RuntimeError('Unexpected prediction count: ' + json.dumps(result))
    for actual, item in zip(tensors, fixture):
        expected = item['expected']
        if len(actual) != len(expected) or not all(
                math.isfinite(a) and math.isclose(a, e, rel_tol=1e-3, abs_tol=1e-4)
                for a, e in zip(actual, expected)):
            raise RuntimeError(f'OpenSearch/Python predictions differ for {item["text"]!r}')


def load_packages(root, model='both'):
    packages = []
    slugs = {'reranker': 'bge-reranker-base', 'embedding': 'bge-m3'}
    for slug in slugs.values() if model == 'both' else [slugs[model]]:
        directory = root / slug
        manifest = json.loads((directory / 'manifest.json').read_text())
        digest = hashlib.sha256()
        with (directory / 'model.zip').open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != manifest['model_content_hash_value']:
            raise ValueError(f'Checksum mismatch for {slug}')
        fixture = json.loads((directory / 'fixture.json').read_text())
        limit = 1024 if slug == 'bge-m3' else 512
        if not fixture or any(item.get('context_limit') != limit for item in fixture) or not any(
                item.get('raw_tokens', 0) > limit and item.get('input_tokens') == limit for item in fixture):
            raise ValueError(f'{slug}: missing long-context references; run scripts/prepare_opensearch_fixtures.py')
        packages.append((slug, manifest, fixture))
    return packages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=['embedding', 'reranker', 'both'], default='both')
    parser.add_argument('--opensearch-url', default='http://localhost:9200')
    parser.add_argument('--models-dir', type=Path, default=Path('models/opensearch'))
    parser.add_argument('--bind', default='0.0.0.0', help='Package server bind address')
    parser.add_argument('--port', type=int, default=8081)
    parser.add_argument('--model-base-url', default='http://host.docker.internal:8081',
                        help='URL OpenSearch uses to reach the temporary package server')
    parser.add_argument('--timeout', type=int, default=600)
    args = parser.parse_args()
    root = args.models_dir.resolve()
    packages = load_packages(root, args.model)  # Fail before changing cluster settings.
    server = ThreadingHTTPServer((args.bind, args.port), partial(SimpleHTTPRequestHandler, directory=str(root)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        request(args.opensearch_url, 'PUT', '/_cluster/settings', {'persistent': {
            'plugins.ml_commons.allow_registering_model_via_url': True,
            'plugins.ml_commons.only_run_on_ml_node': False,
        }})
        ids_path = root / 'model-ids.json'
        ids = json.loads(ids_path.read_text()) if ids_path.exists() else {}
        for slug, manifest, fixture in packages:
            model_id = find_model(args.opensearch_url, manifest)
            if not model_id:
                print(f'{slug}: registering package', flush=True)
                registration = dict(manifest)
                registration['model_group_id'] = ensure_group(args.opensearch_url, manifest['name'])
                registration['url'] = args.model_base_url.rstrip('/') + '/' + slug + '/model.zip'
                task = request(args.opensearch_url, 'POST', '/_plugins/_ml/models/_register', registration)
                model_id = poll(args.opensearch_url, task['task_id'], args.timeout)['model_id']
            print(f'{slug}: using model {model_id}', flush=True)
            ensure_deployed(args.opensearch_url, model_id, args.timeout)
            verify(args.opensearch_url, model_id, manifest, fixture)
            ids[slug] = model_id
            print(f'{slug}: deployed and prediction parity verified ({model_id})')
        ids_path.write_text(json.dumps(ids, indent=2))
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
