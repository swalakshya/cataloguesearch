"""Subprocess boundary: clean test environments, suite preparation and reports."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
from deploy.services.common import RUNTIME_ENV, dotenv, redact_text, sensitive
from deploy.testing.store import emit
from deploy.testing.manager import ROOT, roots
from deploy.testing.coverage import python_coverage, istanbul_coverage, node_coverage


def environment(suite, directory):
    env = {k: v for k, v in os.environ.items() if k in RUNTIME_ENV or k in ('DOCKER_HOST', 'DOCKER_CONTEXT') or k.startswith('LC_')}
    env.update(ROOT_DIR=str(ROOT), TEST_BASE_DIR=str(ROOT / 'tests'), TEST_DATA_DIR=str(ROOT / 'tests/data'))
    envfile = ROOT / 'tests/.env' if suite == 'python' else roots()['chat'] / '.env.test'
    if suite != 'frontend':
        env.update(dotenv(envfile, env))
    env.update(ROOT_DIR=str(ROOT), TEST_BASE_DIR=str(ROOT / 'tests'), TEST_DATA_DIR=str(ROOT / 'tests/data'),
               DASHBOARD_TEST_OUTPUT=str(directory), DASHBOARD_TEST_SUITE=suite,
               DASHBOARD_TEST_COVERAGE=str(directory / suite), PYTHONUNBUFFERED='1',
               PYTHONPATH=str(ROOT), COVERAGE_FILE=str(directory / suite / '.coverage'),
               DEPLOY_DATA_DIR=str(directory / 'isolated-jobs'), TEST_MODE='true',
               TEST_SNAPSHOTS_DIR=str(ROOT / '.dashboard/test-snapshots'), BROWSER='none', CI='true')
    if suite == 'python':
        env['CONFIG_PATH'] = str(ROOT / 'tests/data/configs/test_config.yaml')
    return env


def execute(argv, cwd, env, directory, suite):
    secrets = [v for k, v in env.items() if sensitive(k, v)]
    # Inherit the shared runner's process group so cancellation kills children too.
    proc = subprocess.Popen(argv, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace')
    for line in proc.stdout:
        text = redact_text(line.rstrip(), secrets)
        print(text, flush=True)
        emit(directory, suite, '__setup__', 'log', text=text, activity=text[-300:])
    return proc.wait()


def prepare_python(env, directory):
    if not (ROOT / 'tests/.env').is_file():
        raise RuntimeError('Missing tests/.env. Configure test credentials before running the full Python suite.')
    emit(directory, 'python', '__setup__', 'phase', text='Checking local Docker and OpenSearch image')
    host = env.get('DOCKER_HOST')
    if not host:
        host = json.loads(subprocess.check_output(
            ['docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
            env=env, text=True, timeout=10))
    if not host.startswith('unix://'):
        raise RuntimeError('Tests require a local Docker context; remote Docker endpoints are refused.')
    env['DOCKER_HOST'] = host
    env.pop('DOCKER_CONTEXT', None)
    # The local image may be AMD64 on an ARM laptop (OrbStack supports emulation).
    # Match the image we actually have rather than forcing the laptop architecture.
    try:
        image_platform = subprocess.check_output(
            ['docker', 'image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}',
             'swalakshya/cataloguesearch:opensearch'], env=env, text=True, stderr=subprocess.PIPE, timeout=15).strip()
    except subprocess.CalledProcessError as exc:
        raise RuntimeError('The local OpenSearch image is missing. Build swalakshya/cataloguesearch:opensearch before running Python tests.') from exc
    if image_platform not in ('linux/amd64', 'linux/arm64'):
        raise RuntimeError(f'Unsupported local OpenSearch image platform: {image_platform}')
    env['DOCKER_PLATFORM'] = image_platform
    emit(directory, 'python', '__setup__', 'log', text=f'Using existing OpenSearch image ({image_platform})')
    emit(directory, 'python', '__setup__', 'phase', text='Starting test OpenSearch')
    if execute(['docker', 'compose', '--env-file', str(ROOT / 'tests/.env'), '-f', 'docker-compose.test.yml',
                'up', '-d', '--no-build', '--pull', 'never', 'opensearch-test'], ROOT, env, directory, 'python'):
        raise RuntimeError('Cannot start opensearch-test. See the Docker Compose error above for the cause.')
    emit(directory, 'python', '__setup__', 'phase', text='Waiting for test OpenSearch to become healthy (up to 150 seconds)')
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen('http://127.0.0.1:19200/_cluster/health', timeout=3) as response:
                if json.load(response).get('status') in ('yellow', 'green'):
                    return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError('Test OpenSearch did not become healthy on localhost:19200 within 150 seconds')


def save_coverage(suite, directory, env):
    out = directory / suite
    if suite == 'python':
        from coverage import Coverage
        cov = Coverage(data_file=env['COVERAGE_FILE'], config_file=str(ROOT / '.coveragerc'))
        cov.load()
        cov.json_report(outfile=str(out / 'coverage.json'), show_contexts=True)
        cov.html_report(directory=str(out / 'html'))
        data = python_coverage(json.loads((out / 'coverage.json').read_text()))
        for file in data['files']:
            file['tests'] = [f'tests/{test}' if not test.startswith('tests/') and (ROOT / 'tests' / test).is_file() else test for test in file['tests']]
        data['exclusions'] = (ROOT / '.coveragerc').read_text()
    elif suite == 'frontend':
        data = istanbul_coverage(json.loads((out / 'coverage-final.json').read_text()), roots()[suite])
        data['exclusions'] = 'Test files and src/setupTests.js; non-JavaScript assets and dependencies.'
    else:
        data = node_coverage(json.loads((out / 'node-coverage.json').read_text()), roots()[suite])
        data['exclusions'] = 'Only service/src/**/*.js; tests, dependencies, scripts and MCP code are outside this runner.'
    # Save the exact covered sources so old reports stay meaningful after local edits.
    for file in data['files']:
        path = (roots()[suite] / file['path']).resolve()
        if path.is_relative_to(roots()[suite].resolve()) and path.is_file():
            file['source'] = path.read_text(errors='replace')
            file['sha256'] = hashlib.sha256(file['source'].encode()).hexdigest()
    temporary = out / 'normalized.tmp'
    temporary.write_text(json.dumps(data))
    temporary.replace(out / 'normalized.json')


def main():
    suite, directory = sys.argv[1], Path(sys.argv[2]).resolve()
    out = directory / suite
    out.mkdir(parents=True, exist_ok=True)
    env = environment(suite, directory)
    # Reporter redaction uses the same clean environment as the test runner.
    os.environ.clear()
    os.environ.update(env)
    emit(directory, suite, '__setup__', 'start')
    code = 1
    try:
        if suite == 'python':
            prepare_python(env, directory)
            argv = [sys.executable, '-m', 'pytest', 'tests', '--run-all', '-p', 'deploy.testing.pytest_reporter',
                    '--cov=backend', '--cov=deploy', '--cov=eval', '--cov=ingest', '--cov=utils', '--cov-branch',
                    '--cov-context=test', f'--cov-report=json:{out / "coverage.json"}', '--tb=short']
        elif suite == 'frontend':
            argv = ['node', 'node_modules/vitest/vitest.mjs', 'run', '--config', 'vite.testing.config.mjs']
        else:
            manifest = json.loads((directory / 'manifest.json').read_text())
            tests = [f['path'] for f in manifest['files'] if f['suite'] == suite and f['path'] != '__setup__']
            if not tests:
                raise RuntimeError('Chat test files were not found in the sibling repository')
            argv = ['node', '--test', '--test-concurrency=1', '--experimental-test-coverage', '--test-coverage-include-all',
                    '--test-coverage-include=src/**/*.js', f'--test-reporter={ROOT / "deploy/testing/node_reporter.mjs"}', *tests]
        emit(directory, suite, '__setup__', 'phase', text='Collecting and running tests; shared fixtures may prepare models, indexes and bookmark caches' if suite == 'python' else 'Running tests')
        code = execute(argv, roots()[suite], env, directory, suite)
        emit(directory, suite, '__setup__', 'phase', text='Generating coverage report')
        try:
            save_coverage(suite, directory, env)
        except Exception as exc:
            reason = redact_text(f'Coverage unavailable or incomplete: {exc}', [v for k, v in env.items() if sensitive(k, v)])
            (out / 'coverage-error.txt').write_text(reason)
            emit(directory, suite, '__setup__', 'error', text=reason)
            if code == 0:
                code = 1
        if code:
            emit(directory, suite, '__setup__', 'error', text=f'{suite} runner exited with code {code}. See individual file failures and setup output.')
    except Exception as exc:
        emit(directory, suite, '__setup__', 'error', text=str(exc))
        print(redact_text(str(exc), [v for k, v in env.items() if sensitive(k, v)]), flush=True)
    finally:
        emit(directory, suite, '__setup__', 'suite_end', status='passed' if code == 0 else 'failed')
    return code


if __name__ == '__main__':
    sys.exit(main())
