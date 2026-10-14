"""Local OpenSearch container adapter; container state precedes health state."""
import json
import re
import subprocess
import urllib.request
import yaml
from deploy import settings
from deploy.services.base import Service
from deploy.services.common import dotenv
from deploy.log_stream import docker_feed


class OpenSearchService(Service):
    id, name = 'opensearch', 'OpenSearch'
    icon = '🔎'
    dependencies = ('docker',)
    default_port = 9200
    startup_timeout = 180

    def spec(self):
        root = settings.REPO_ROOT
        common = dotenv(root / '.env.local')
        cwd = root
        command = []
        sources = [root / '.env.local']
        compose_path = root / 'docker-compose.yml'
        compose = yaml.safe_load(compose_path.read_text()) if compose_path.is_file() else {}
        configured = (compose.get('services') or {}).get('opensearch', {})
        sources.append(root / 'docker-compose.yml')
        def expand(match):
            name, default = match.group(1), match.group(2)
            return common.get(name) or default or ''
        def interpolate(value):
            if isinstance(value, dict):
                return {key: interpolate(item) for key, item in value.items()}
            if isinstance(value, list):
                return [interpolate(item) for item in value]
            return re.sub(r'\$\{([A-Z_0-9]+)(?::-(.*?))?\}', expand, value) if isinstance(value, str) else value
        configured = interpolate(configured)
        environment = configured.get('environment')
        if isinstance(environment, list):
            configured['environment'] = dict(item.partition('=')[::2] for item in environment)
        return self.make_spec(configured, cwd, command, sources)

    def health(self):
        with urllib.request.urlopen(f'http://127.0.0.1:{self.port}/_cluster/health', timeout=1) as response:
            return json.load(response).get('status') in ('yellow', 'green')

    def status(self):
        self.manager._local_docker()
        proc = subprocess.run(['docker', 'inspect', '--format', '{{json .State}}', settings.OPENSEARCH_CONTAINER],
                              capture_output=True, text=True, timeout=5)
        if proc.returncode:
            return {'status': 'stopped', 'managed': True, 'running': False, 'message': self.manager.redact(proc.stderr)[:400]}
        state = json.loads(proc.stdout)
        if not state.get('Running'):
            return {'status': 'starting' if state.get('Restarting') else 'stopped', 'managed': True, 'running': False}
        try:
            if self.manager._health(self.id):
                return {'status': 'ready', 'managed': True, 'running': True}
        except Exception:
            pass
        return {'status': 'unhealthy' if (state.get('Health') or {}).get('Status') == 'unhealthy' else 'starting', 'managed': True, 'running': True,
                'message': 'Container is running; waiting for OpenSearch to answer.'}

    def start(self, ctx, prepared=None):
        self.manager._local_docker()
        self.manager._command(['docker', 'compose', '--env-file', str(settings.REPO_ROOT / '.env.local'),
                              '-f', str(settings.REPO_ROOT / 'docker-compose.yml'), 'up', '-d', '--no-build', '--pull', 'never', 'opensearch'], timeout=90)
        self.manager._wait(self.id, ctx)

    def stop(self, ctx):
        self.manager._local_docker()
        try:
            self.manager._health('docker')
        except Exception:
            ctx.log('Docker is already stopped; OpenSearch does not need stopping.')
            return
        try:
            self.manager._command(['docker', 'inspect', settings.OPENSEARCH_CONTAINER], timeout=5)
        except RuntimeError as exc:
            if 'No such' in str(exc):
                ctx.log('OpenSearch container does not exist; nothing to stop.')
                return
            raise
        self.manager._command(['docker', 'stop', settings.OPENSEARCH_CONTAINER], timeout=45)

    def logs(self, cursor=None):
        self.manager._local_docker()
        return self.log_result(**docker_feed(settings.OPENSEARCH_CONTAINER, cursor))
