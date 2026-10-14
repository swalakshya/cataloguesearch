"""Native process lifecycle shared by API, Chat and the built application UI."""
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from deploy import settings
from deploy.dashboard_updates import write_state
from deploy.services.base import Service
from deploy.services.common import sensitive
from deploy.log_stream import file_feed


class ProcessService(Service):
    native = True
    can_update = True
    health_path = '/'

    def health(self):
        with urllib.request.urlopen(f'http://127.0.0.1:{self.port}{self.health_path}', timeout=1) as response:
            return response.status == 200

    def source_paths(self):
        return []

    def revision(self):
        paths = self.source_paths() + self.manager.spec(self.id)['sources']
        digest = hashlib.sha256()
        for path in sorted(set(paths)):
            if path.is_file() and '__pycache__' not in path.parts and '.test.' not in path.name:
                digest.update(str(path).encode())
                digest.update(path.read_bytes())
        digest.update(json.dumps(self.manager.spec(self.id)['configured'], sort_keys=True).encode())
        return digest.hexdigest()

    def prepare(self, ctx):
        version = self.manager.revision(self.id)
        return self.manager.spec(self.id), version

    def after_start(self):
        pass

    def update(self, ctx):
        self.manager._stop_one(self.id, ctx)
        self.manager._start_one(self.id, ctx)

    def start(self, ctx, prepared=None):
        m, service = self.manager, self.id
        if m._owned(service):
            m._wait(service, ctx)
            return
        if m._port_open(self.port):
            try:
                if m._health(service):
                    ctx.log(f'{service} is already running outside the dashboard; reusing it without taking ownership.')
                    return
            except Exception:
                pass
            raise RuntimeError(f'Port {self.port} is occupied outside the dashboard. Stop that process first.')
        spec, version = prepared or self.prepare(ctx)
        m.directory.mkdir(parents=True, exist_ok=True)
        if version != m.revision(service):
            raise RuntimeError('Source changed during preparation. Start again to use a consistent version.')
        if ctx.cancelled:
            raise RuntimeError('Startup cancelled before launching the service.')
        child_environment = {**spec['env'],
                             'PYTHONPATH': str(settings.REPO_ROOT) + os.pathsep + spec['env'].get('PYTHONPATH', '')}
        environment = {**child_environment, 'LOCAL_SERVICE_DIRECTORY': str(m.directory),
                       'PYTHONPATH': child_environment['PYTHONPATH'] + os.pathsep + os.environ.get('PYTHONPATH', '')}
        process = subprocess.Popen([sys.executable, '-m', 'deploy.local_process', service], cwd=settings.REPO_ROOT,
                                   env=environment, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, start_new_session=True)
        m._children[service] = process
        snapshot = {'command': spec['command'], 'cwd': str(spec['cwd']), 'env': child_environment, 'secrets': m.secret_values() + [value for key, value in child_environment.items() if sensitive(key, value) and isinstance(value, str) and value]}
        try:
            process.stdin.write(json.dumps(snapshot).encode())
            process.stdin.close()
        except Exception:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise
        identity = m._identity(process.pid)
        if not identity:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise RuntimeError(f'{service} could not start. Open its logs.')
        write_state(m.directory / f'{service}.json', {'pid': process.pid, 'identity': identity, 'revision': version, 'started_at': time.time()})
        m._wait(service, ctx)
        self.after_start()

    def stop(self, ctx):
        m, service = self.manager, self.id
        record = m._owned(service)
        if not record:
            if m._port_open(self.port):
                raise RuntimeError(f'{service} was started outside the dashboard; stop it in its terminal first.')
            return
        pid = record['pid']
        os.killpg(pid, signal.SIGTERM)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline and m._owned(service):
            time.sleep(.1)
        if m._owned(service):
            os.killpg(pid, signal.SIGKILL)
        deadline = time.monotonic() + 5
        while m._owned(service) or m._port_open(self.port):
            if time.monotonic() >= deadline:
                raise RuntimeError(f'{service} has not fully stopped; restart was cancelled. Open its logs.')
            time.sleep(.05)
        (m.directory / f'{service}.json').unlink(missing_ok=True)

    def status(self):
        m, service = self.manager, self.id
        row = {'update_available': False}
        owned = m._owned(service)
        row['managed'] = bool(owned)
        row['external'] = not owned and m._port_open(self.port)
        row['running'] = bool(owned) or row['external']
        try:
            healthy = m._health(service)
            row['status'] = 'ready' if healthy else 'unhealthy'
        except Exception as exc:
            row['status'] = ('failed' if time.time() - owned.get('started_at', 0) > self.startup_timeout else 'starting') if owned else 'unhealthy' if m._port_open(self.port) else 'stopped'
            row['message'] = m.redact(str(exc))[:400]
        if owned:
            row['pid'] = owned['pid']
            row['update_available'] = owned['revision'] != m.revision(service)
        elif m._port_open(self.port):
            row['message'] = 'Started outside the dashboard. Stop it in its terminal before using Stop, Restart or Update here.'
        else:
            row['message'] = 'Start to load the current local code and configuration.'
        return row

    def logs(self, cursor=None):
        return self.log_result(**file_feed(self.directory / f'{self.id}.log', cursor))
