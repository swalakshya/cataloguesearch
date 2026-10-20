"""Discover local tests and run suites through the dashboard's exclusive job queue."""
from pathlib import Path
import shutil
import sys
from deploy import settings
from deploy.runner import runner, StepSpec, Cmd
from deploy.testing.store import RunStore, file_id

ROOT = settings.REPO_ROOT
BASE = ROOT / '.dashboard' / 'testing'
store = RunStore(BASE)
SUITES = ('python', 'frontend', 'chat')


def roots():
    return dict(python=ROOT, frontend=ROOT / 'frontend', chat=settings.CHAT_REPO_DIR / 'service')


def discover():
    result = []
    for path in sorted((ROOT / 'tests').rglob('*.py')):
        if path.name.startswith('test_') or path.name.endswith('_test.py'):
            result.append(dict(suite='python', path=path.relative_to(ROOT).as_posix()))
    for path in sorted((ROOT / 'frontend' / 'src').rglob('*')):
        if path.name.endswith(('.test.js', '.test.jsx')):
            result.append(dict(suite='frontend', path=path.relative_to(ROOT / 'frontend').as_posix()))
    chat = roots()['chat']
    for path in sorted((chat / 'test').rglob('*.test.js')):
        result.append(dict(suite='chat', path=path.relative_to(chat).as_posix()))
    return [dict(row, id=file_id(row['suite'], row['path']), status='pending', counts={}, duration=0) for row in result]


def inventory():
    files = discover()
    return dict(files=files, suites=[dict(id=s, count=sum(f['suite'] == s for f in files),
        available=bool(sum(f['suite'] == s for f in files)),
        environment='tests/.env' if s == 'python' else 'service/.env.test' if s == 'chat' else 'Vitest / jsdom') for s in SUITES],
        requirements=['Python: Docker running, local OpenSearch image, test dependencies and tests/.env.',
                      'Full Python tests include slow/integration tests and can call Gemini, Ollama and OCR tooling.',
                      'Frontend and Chat: installed local Node dependencies; Chat integration tests are enabled.',
                      'Only opensearch-test is managed here (localhost:19200); its data and snapshots are separate.'])


def start(suites):
    files = [f for f in discover() if f['suite'] in suites]
    def initialize(ctx):
        store.create(ctx.run_id, files)
        # Retain ten completed report directories; never delete the active run.
        previous = sorted((p for p in BASE.iterdir() if p.is_dir() and p.name != ctx.run_id), key=lambda p: p.stat().st_mtime, reverse=True)
        for path in previous[9:]:
            shutil.rmtree(path)
        ctx.summary(f'{len(files)} test files discovered')
        return 0
    steps = [StepSpec('inventory', 'Discover test files', initialize)]
    for suite in suites:
        def execute(ctx, suite=suite):
            return ctx.run(Cmd([sys.executable, '-m', 'deploy.testing.worker', suite, str(store.directory(ctx.run_id))],
                               f'Run {suite} tests with coverage', cwd=ROOT))
        steps.append(StepSpec(suite, f'{suite.title()} tests & coverage', execute, continue_on_fail=True))
    return runner.start('testing', 'Tests & Coverage', steps, dict(suites=suites))
