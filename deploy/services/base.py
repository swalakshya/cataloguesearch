"""Public contract for one local service; dependency orchestration lives outside it."""
from abc import ABC, abstractmethod
from datetime import datetime, timezone
import os
from deploy.services.common import RUNTIME_ENV, flatten, sensitive


class Service(ABC):
    id = ''
    name = ''
    icon = '⚙️'
    dependencies = ()
    default_port = None
    can_update = False
    native = False
    startup_timeout = 60
    confirmation = None
    preserve_on_stop_all = False

    def __init__(self, manager):
        self.manager = manager

    @property
    def port(self):
        return self.manager.ports.get(self.id)

    @property
    def directory(self):
        return self.manager.directory

    @abstractmethod
    def spec(self):
        """Return the next-start command, environment and configuration sources."""

    @abstractmethod
    def start(self, ctx, prepared=None):
        """Start this service only."""

    @abstractmethod
    def stop(self, ctx):
        """Stop this service only."""

    @abstractmethod
    def health(self):
        """Probe readiness without starting anything."""

    @abstractmethod
    def status(self):
        """Return observed lifecycle state and ownership."""

    @abstractmethod
    def logs(self, cursor=None):
        """Return existing logs without starting anything."""

    def make_spec(self, configured, cwd, command, sources):
        environment = {k: v for k, v in os.environ.items() if k in RUNTIME_ENV or k.startswith('LC_')}
        return {'command': command, 'cwd': cwd, 'env': {**environment, **configured} if self.native else {},
                'configured': configured, 'sources': sources, 'port': self.port}

    def values(self):
        spec = self.manager.spec(self.id)
        return spec, flatten(spec['configured'], 'env' if self.native else 'settings')

    def configuration(self):
        spec, values = self.values()
        return {'sources': [str(path) for path in spec['sources']], 'directory': str(spec['cwd']),
                'command': spec['command'], 'note': 'Configured values for the next start. Running processes keep their existing environment until restarted.',
                'values': [{'key': key, 'secret': sensitive(key, value),
                            'value': '••••••••' if sensitive(key, value) and value else value}
                           for key, value in sorted(values.items())]}

    def reveal(self, key):
        _, values = self.values()
        if key not in values or not sensitive(key, values[key]):
            raise ValueError('Unknown secret setting')
        return values[key]

    def update(self, ctx):
        raise ValueError('This service does not support source updates')

    def log_result(self, text, **metadata):
        return {**metadata, 'text': self.manager.redact(text), 'checked_at': datetime.now(timezone.utc).isoformat()}

    def impact(self, dependents):
        if not dependents:
            return ''
        names = ', '.join(dependents[:-1]) + ' and ' + dependents[-1] if len(dependents) > 1 else dependents[0]
        return f'Stop also stops {names}. Restart restores dependents that were already running.'

    def actions(self, state):
        """Single source of truth for UI availability; ownership is rechecked at execution."""
        result = []
        for action in ('start', 'stop', 'restart', *(['update'] if self.can_update else [])):
            reason = None
            if action == 'start' and (state.get('running') or state['status'] in ('ready', 'starting')):
                reason = 'Already running' if state['status'] == 'ready' else 'Already starting'
            elif action != 'start' and state.get('external'):
                reason = 'Started outside the dashboard; stop it in its terminal first'
            elif action != 'start' and not state.get('managed', True):
                reason = 'Service is stopped'
            elif action in ('stop', 'restart') and state['status'] == 'stopped':
                reason = 'Service is stopped'
            elif action == 'update' and not state.get('update_available'):
                reason = 'No local changes available'
            result.append({'id': action, 'label': action.capitalize(), 'enabled': reason is None,
                           'reason': reason, 'confirmation': self.confirmation if action in ('stop', 'restart') else None})
        return result
