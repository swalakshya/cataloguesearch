"""OrbStack runtime adapter."""
import json
import os
from pathlib import Path
import shutil
from deploy import docker_health, settings
from deploy.services.base import Service
from deploy.log_stream import file_feed


class DockerService(Service):
    id, name = 'docker', 'Docker / OrbStack'
    icon = '🐳'
    preserve_on_stop_all = True
    confirmation = 'This stops Docker and all its local containers, plus dependent managed services. Continue?'

    def spec(self):
        root = settings.REPO_ROOT
        cwd = root
        command = []
        configured = {'runtime': 'OrbStack', 'command': settings.ORB_BIN or shutil.which('orb') or 'orb',
                      'DOCKER_HOST': os.environ.get('DOCKER_HOST', 'Current local Docker context')}
        sources = []
        daemon_config = Path.home() / '.orbstack' / 'config' / 'docker.json'
        if daemon_config.is_file():
            configured['engine'] = json.loads(daemon_config.read_text())
            sources.append(daemon_config)
        return self.make_spec(configured, cwd, command, sources)

    def impact(self, dependents):
        return 'Stop/Restart affects every local container and dependent service.'

    def health(self):
        return bool(self.manager._command(['docker', 'info', '--format', '{{.ServerVersion}}'], timeout=3))

    def status(self):
        try:
            return {'status': 'ready' if self.manager._health(self.id) else 'unhealthy', 'managed': True}
        except Exception as exc:
            return {'status': 'stopped', 'managed': True, 'message': self.manager.redact(str(exc))[:400]}

    def start(self, ctx, prepared=None):
        self.manager._local_docker()
        try:
            if self.manager._health(self.id):
                return
        except Exception:
            pass
        self.manager._command([settings.ORB_BIN or shutil.which('orb') or 'orb', 'start'], timeout=90)
        self.manager._wait(self.id, ctx)

    def stop(self, ctx):
        self.manager._local_docker()
        self.manager._command([settings.ORB_BIN or shutil.which('orb') or 'orb', 'stop'], timeout=90)
        docker_health.forget()

    def logs(self, cursor=None):
        path = Path.home() / '.orbstack' / 'log' / 'vmgr.log'
        return self.log_result(**file_feed(path, cursor, 'No OrbStack runtime log exists yet. Logs appear after Docker has been started.'))
