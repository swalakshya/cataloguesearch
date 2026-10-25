"""Local service coordinator: dependency ordering, jobs and verified process ownership."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import threading
import time

from deploy import settings
from deploy.dashboard_updates import read_state, write_state
from deploy.runner import StepSpec, runner
from deploy.services import SERVICE_TYPES
from deploy.services.common import redact_text, sensitive

ORDER = tuple(service.id for service in SERVICE_TYPES)
PORTS = {service.id: service.default_port for service in SERVICE_TYPES if service.default_port is not None}
DEPS = {service.id: service.dependencies for service in SERVICE_TYPES}


class Manager:
    def __init__(self, directory=None):
        self.directory = directory or settings.REPO_ROOT / '.dashboard' / 'services'
        self.ports = PORTS
        self.services = {service.id: service(self) for service in SERVICE_TYPES}
        self._cache = None
        self._cache_at = 0
        self._lock = threading.Lock()
        self._children = {}

    def service(self, service):
        try:
            return self.services[service]
        except KeyError:
            raise ValueError('Unknown local service') from None

    def spec(self, service):
        return self.service(service).spec()

    def _values(self, service):
        return self.service(service).values()

    def configuration(self, service):
        return self.service(service).configuration()

    def reveal(self, service, key):
        return self.service(service).reveal(key)

    def revision(self, service):
        return self.service(service).revision()

    def logs(self, service, cursor=None):
        return self.service(service).logs(cursor)

    def _health(self, service):
        return self.service(service).health()

    def _status_details(self, service):
        return self.service(service).status()

    def secret_values(self):
        values = []
        for service in ORDER:
            try:
                _, configured = self._values(service)
                values.extend(value for key, value in configured.items()
                              if sensitive(key, value) and isinstance(value, str) and value)
            except Exception:
                continue  # A broken config must not prevent masking or other status checks.
        return values

    def redact(self, text):
        return redact_text(text, self.secret_values())

    def _command(self, argv, timeout=15, **kwargs):
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, **kwargs)
        if proc.returncode:
            raise RuntimeError(self.redact(proc.stderr or proc.stdout or 'Command failed')[-1500:])
        return proc.stdout.strip()

    def _local_docker(self):
        host = os.environ.get('DOCKER_HOST')
        if not host:
            host = json.loads(self._command(['docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']))
        if not host.startswith('unix://'):
            raise RuntimeError('Only a local Docker context is allowed for local service controls')

    @staticmethod
    def _identity(pid):
        try:
            proc = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart=', '-o', 'pgid='], capture_output=True, text=True, timeout=3)
            return proc.stdout.strip() if proc.returncode == 0 else None
        except (OSError, subprocess.SubprocessError):
            return None

    def _owned(self, service):
        child = self._children.get(service)
        if child is not None:
            child.poll()  # Reap children that have exited; don't mistake zombies for running services.
        record = read_state(self.directory / f'{service}.json')
        pid = record.get('pid')
        if not isinstance(pid, int) or pid <= 1:
            return None
        actual = self._identity(pid)
        try:
            if actual and actual == record.get('identity') and os.getpgid(pid) == pid:
                return record
        except OSError:
            pass
        return None

    @staticmethod
    def _port_open(port):
        if not port:
            return False
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=.3):
                return True
        except OSError:
            return False

    def _status_one(self, service):
        implementation = self.service(service)
        row = {'id': service, 'name': implementation.name, 'icon': implementation.icon, 'port': implementation.port,
               'dependencies': list(implementation.dependencies), 'update_available': False,
               'capabilities': {'update': implementation.can_update}}
        try:
            row.update(self._status_details(service))
        except Exception as exc:
            row.update(managed=bool(self._owned(service)), status='failed', message=self.redact(str(exc))[:400])
        failure = read_state(self.directory / f'{service}.failure.json').get('message')
        if failure and row['status'] != 'ready':
            row.update(status='failed', message=failure)
        row['actions'] = implementation.actions(row)
        dependents = [self.service(key).name for key in ORDER if key != service and self._depends_on(key, service)]
        row['impact'] = implementation.impact(dependents)
        return row

    def status(self):
        with self._lock:
            if self._cache and time.monotonic() - self._cache_at < 3:
                return self._cache
            with ThreadPoolExecutor(max_workers=5) as pool:
                rows = list(pool.map(self._status_one, ORDER))
            self._cache = {'services': rows, 'checked_at': datetime.now(timezone.utc).isoformat()}
            self._cache_at = time.monotonic()
            return self._cache

    def _wait(self, service, ctx):
        started = time.monotonic()
        timeout = self.service(service).startup_timeout
        deadline = started + timeout
        next_note = started
        last_error = 'Readiness check has not succeeded'
        while time.monotonic() < deadline:
            if ctx.cancelled:
                raise RuntimeError('Startup cancelled. Services already started are left running.')
            try:
                if self._health(service):
                    return
            except Exception as exc:
                last_error = self.redact(str(exc))[:400]
            now = time.monotonic()
            if now >= next_note:
                note = f'Waiting for {service} ({int(now - started)}s / {timeout:g}s): {last_error}'
                ctx.progress(note)
                ctx.log(note)
                next_note = now + 10
            if self.service(service).native and not self._owned(service):
                raise RuntimeError(f'{service} exited before becoming ready. Open its logs.')
            ctx.sleep(1)
        raise RuntimeError(f'{service} did not become ready after {timeout:g}s. Last check: {last_error}. Open its logs.')

    def _start_one(self, service, ctx, prepared=None):
        try:
            return self._launch_one(service, ctx, prepared)
        except Exception as exc:
            write_state(self.directory / f'{service}.failure.json', {'message': self.redact(str(exc))[:400]})
            raise

    def _launch_one(self, service, ctx, prepared=None):
        ctx.progress(f'Starting {service}')
        (self.directory / f'{service}.failure.json').unlink(missing_ok=True)
        self.service(service).start(ctx, prepared)
        ctx.log(f'{service} is ready.')

    def _stop_one(self, service, ctx):
        ctx.progress(f'Stopping {service}; active requests may terminate')
        self.service(service).stop(ctx)
        (self.directory / f'{service}.failure.json').unlink(missing_ok=True)
        ctx.log(f'{service} stopped.')

    def ensure_ready(self, *services, ctx):
        """Start required local services in dependency order inside the caller's job."""
        for service in services:
            self.service(service)  # Validate all targets before starting anything.
        needed = {target for target in ORDER if any(self._depends_on(service, target) for service in services)}
        try:
            for target in ORDER:
                if target in needed:
                    if ctx.cancelled:
                        raise RuntimeError('Service startup cancelled. Services already started are left running.')
                    self._start_one(target, ctx)
        finally:
            self._cache_at = 0

    def perform(self, service, action, ctx):
        if service not in (*ORDER, 'all') or action not in ('start', 'stop', 'restart', 'update'):
            raise ValueError('Unknown local service action')
        if action == 'update' and (service == 'all' or not self.service(service).can_update):
            raise ValueError('Only API, UI and chat have local code updates')
        try:
            if action == 'update':
                self.ensure_ready(*DEPS[service], ctx=ctx)
                self.service(service).update(ctx)
                return
            targets = ORDER if service == 'all' else tuple(s for s in ORDER if self._depends_on(s, service))
            restore = {target for target in targets if target == service or self._port_open(PORTS.get(target))
                       or (self.service(target).native and self._owned(target))} if action == 'restart' else set()
            if action in ('stop', 'restart'):
                for target in reversed(targets):
                    if service == 'all' and self.service(target).preserve_on_stop_all:
                        continue  # Stop development preserves the runtime and unrelated containers.
                    self._stop_one(target, ctx)
            if action in ('start', 'restart'):
                needed = set(ORDER) if service == 'all' else {s for s in ORDER if self._depends_on(service, s)}
                if action == 'restart':
                    needed.update(restore)
                self.ensure_ready(*needed, ctx=ctx)
        finally:
            self._cache_at = 0

    def _depends_on(self, service, dependency):
        return service == dependency or any(self._depends_on(parent, dependency) for parent in DEPS[service])

    def start_action(self, service, action):
        def execute(ctx):
            try:
                self.perform(service, action, ctx)
                ctx.summary(f'{action.capitalize()} completed')
                return 0
            except Exception as exc:
                if service != 'all':
                    write_state(self.directory / f'{service}.failure.json', {'message': self.redact(str(exc))[:400]})
                ctx.log(self.redact(str(exc)))
                ctx.summary(self.redact(str(exc))[:180])
                return 1
        return runner.start('services', f'{action.capitalize()} {service}', [StepSpec('services', f'{action.capitalize()} {service}', execute)], {})


manager = Manager()
