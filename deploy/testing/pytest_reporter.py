"""Pytest hooks route captured output by node ID, including collection failures."""
import os
from collections import Counter

_remaining = Counter()
_started = set()
from pathlib import Path
from deploy.testing.store import emit

_REPO = Path(__file__).resolve().parents[2]
_root = _REPO


def pytest_configure(config):
    global _root
    _root = Path(config.rootpath)


def report_path(path):
    candidate = (_root / path).resolve()
    return candidate.relative_to(_REPO).as_posix() if candidate.is_relative_to(_REPO) else path


def event(path, kind, **values):
    emit(Path(os.environ['DASHBOARD_TEST_OUTPUT']), 'python', path if path == '__setup__' else report_path(path), kind, **values)


def pytest_collection_finish(session):
    _remaining.clear()
    _remaining.update(item.nodeid.split('::')[0] for item in session.items)
    _started.clear()


def pytest_runtest_logstart(nodeid, location):
    path = nodeid.split('::')[0]
    _started.add(path)
    event(path, 'start')


def pytest_runtest_logfinish(nodeid, location):
    path = nodeid.split('::')[0]
    _remaining[path] -= 1
    if _remaining[path] == 0:
        event(path, 'finish')


def pytest_runtest_logreport(report):
    path = report.nodeid.split('::')[0]
    text = '\n'.join(f'{title}\n{content}' for title, content in report.sections if title.endswith(f' {report.when}'))
    if report.failed or report.skipped:
        text += '\n' + str(report.longrepr)
    if text:
        event(path, 'log', text=f'{report.nodeid} [{report.when}]\n{text}')
    if report.when == 'call' or report.failed or report.skipped:
        event(path, 'test', test=report.nodeid, status=report.outcome, duration=report.duration, text=str(report.longrepr) if report.failed or report.skipped else '', write_log=False)


def pytest_collectreport(report):
    if report.failed:
        event('__setup__', 'error', text=f'Collection failed: {report.nodeid}\n{report.longrepr}')
        event(report.nodeid.split('::')[0], 'error', text=str(report.longrepr))


def pytest_sessionfinish(session, exitstatus):
    for path in sorted(_started):
        if _remaining[path] > 0:
            event(path, 'incomplete', text='Execution ended before every test in this file completed')
