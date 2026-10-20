"""Append-only runner events; bounded, isolated logs for each test file."""
import hashlib
import json
import os
from pathlib import Path
import re
import threading
from datetime import datetime, timezone
from deploy.services.common import redact_text, sensitive


def file_id(suite, path):
    return hashlib.sha256(f'{suite}:{path}'.encode()).hexdigest()[:24]


def emit(directory, suite, path, kind, write_log=True, **payload):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    secrets = [v for k, v in os.environ.items() if sensitive(k, v)]
    if payload.get('text'):
        text = redact_text(str(payload['text']), secrets)
        if write_log:
            log = directory / f'{file_id(suite, path)}.log'
            # Keep a bounded tail on disk as well as in the viewer.
            if log.exists() and log.stat().st_size > 5_000_000:
                with log.open('rb') as stream:
                    stream.seek(-2_500_000, 2)
                    tail = stream.read()
                log.write_bytes(tail)
            with log.open('a') as stream:
                stream.write(text[-1_000_000:] + '\n')
        payload['text'] = text[:16000] if kind in ('test', 'error', 'phase') else ''
    event = dict(suite=suite, path=path, kind=kind, **payload)
    with (directory / f'events-{suite}.jsonl').open('a') as stream:
        stream.write(json.dumps(event, default=str) + '\n')


class RunStore:
    def __init__(self, base):
        self.base = Path(base)
        self._cache = {}
        self._lock = threading.RLock()

    def directory(self, run):
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', run):
            raise ValueError('Invalid run ID')
        return self.base / run

    def create(self, run, files):
        directory = self.directory(run)
        directory.mkdir(parents=True, exist_ok=True)
        rows = [dict(row, id=file_id(row['suite'], row['path'])) for row in files]
        for suite in sorted({r['suite'] for r in files}):
            rows.append(dict(suite=suite, path='__setup__', id=file_id(suite, '__setup__')))
        manifest = dict(id=run, created=datetime.now(timezone.utc).isoformat(), files=rows)
        (directory / 'manifest.json').write_text(json.dumps(manifest))

    def snapshot(self, run):
        with self._lock:
            directory = self.directory(run)
            if run not in self._cache:
                data = json.loads((directory / 'manifest.json').read_text())
                for row in data['files']:
                    row.update(status='pending', counts={}, duration=0, cases={})
                self._cache[run] = (data, {})
                if len(self._cache) > 20:
                    self._cache.pop(next(iter(self._cache)))
            data, offsets = self._cache[run]
            rows = {(r['suite'], r['path']): r for r in data['files']}
            for stream_path in directory.glob('events-*.jsonl'):
                with stream_path.open() as stream:
                    stream.seek(offsets.get(stream_path.name, 0))
                    while True:
                        start = stream.tell()
                        line = stream.readline()
                        if not line or not line.endswith('\n'):
                            stream.seek(start)
                            break
                        try:
                            e = json.loads(line)
                        except ValueError:
                            continue
                        if e['suite'] == 'python' and ('python', e['path']) not in rows and ('python', 'tests/' + e['path']) in rows:
                            legacy_log_id = file_id('python', e['path'])
                            e['path'] = 'tests/' + e['path']
                            rows[('python', e['path'])]['log_id'] = legacy_log_id
                        key = (e['suite'], e['path'])
                        if key not in rows:
                            row = dict(suite=key[0], path=key[1], id=file_id(*key), status='pending', counts={}, duration=0, cases={})
                            data['files'].append(row)
                            rows[key] = row
                        row = rows[key]
                        kind = e['kind']
                        if kind == 'phase':
                            row['phase'] = e.get('text', '')
                        elif kind == 'log':
                            if e.get('activity'):
                                row['activity'] = e['activity']
                        elif kind == 'start' and row['status'] == 'pending':
                            row['status'] = 'running'
                        elif kind == 'test':
                            case = e['test']
                            previous = row['cases'].get(case, {})
                            # Teardown errors must not erase a call failure; setup success must not erase a call result.
                            if previous.get('status') != 'failed':
                                row['cases'][case] = dict(name=case, status=e['status'], text=e.get('text', ''), duration=e.get('duration', 0))
                            row['counts'] = {s: sum(c['status'] == s for c in row['cases'].values()) for s in ('passed', 'failed', 'skipped')}
                            row['duration'] = sum(c['duration'] for c in row['cases'].values())
                            if row['counts']['failed']:
                                row['status'] = 'failed'
                        elif kind == 'incomplete':
                            if row['status'] != 'failed':
                                row.update(status='interrupted', reason=e.get('text', 'Incomplete execution'))
                        elif kind == 'error':
                            row.update(status='failed', reason=e.get('text', 'Runner error'))
                        elif kind == 'finish':
                            if row['status'] != 'failed':
                                row['status'] = 'succeeded' if row['counts'].get('passed') else 'skipped'
                        elif kind == 'suite_end':
                            for item in data['files']:
                                if item['suite'] != e['suite']:
                                    continue
                                if item['status'] == 'pending' and e['status'] != 'passed' and item['path'] != '__setup__':
                                    item.update(status='blocked', reason='Suite could not execute this file; see suite setup')
                                elif item['status'] in ('pending', 'running'):
                                    item['status'] = ('succeeded' if item['path'] == '__setup__' and e['status'] == 'passed'
                                                      else 'failed' if item['counts'].get('failed') else 'skipped')
                                    item['reason'] = 'Not executed or skipped; see suite setup' if item['status'] == 'skipped' else ''
                    offsets[stream_path.name] = stream.tell()
            # A killed worker cannot emit its final event. Reflect the shared job state.
            try:
                from deploy import db
                job = db.get_run(run)
                terminal = job and job['status'] not in ('pending', 'running')
            except Exception:
                terminal = False
            result = dict(data, files=[{k: v for k, v in row.items() if k != "cases"} for row in data["files"]])
            for row in result['files']:
                if terminal and row['status'] in ('pending', 'running'):
                    row['status'] = 'interrupted'
                    row['reason'] = 'Run ended before this file completed'
                row.pop('cases', None)
            return result

    def details(self, run, identifier, include_text=True):
        self.snapshot(run)
        with self._lock:
            row = next((r for r in self._cache[run][0]['files'] if r['id'] == identifier), None)
            if row is None:
                raise ValueError('Unknown test file')
            path = self.directory(run) / f'{row.get("log_id", identifier)}.log'
            text = ''
            if include_text and path.exists():
                with path.open('rb') as stream:
                    stream.seek(max(0, path.stat().st_size - 5_000_000))
                    text = stream.read().decode(errors='replace')
            return dict(row, cases=list(row['cases'].values()), text=text)
