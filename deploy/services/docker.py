"""OrbStack runtime adapter."""
import json
import os
from pathlib import Path
import shutil
from deploy import docker_health, docker_restart, settings
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
        return docker_health.get()['status'] == docker_health.OK

    def status(self):
        try:
            return {'status': 'ready' if self.manager._health(self.id) else 'unhealthy', 'managed': True}
        except Exception as exc:
            return {'status': 'stopped', 'managed': True, 'message': self.manager.redact(str(exc))[:400]}

    def start(self, ctx, prepared=None):
        self.manager._local_docker()
        if ctx.cancelled:
            raise RuntimeError('Docker startup cancelled')
        ctx.log('Checking Docker responsiveness…')
        for attempt in range(3):
            result = docker_health.check()
            ctx.log(result['message'])
            if ctx.cancelled:
                raise RuntimeError('Docker startup cancelled')
            if result['status'] != docker_health.SLOW:
                break
            if attempt < 2:
                ctx.progress(f'Docker is slow; checking again ({attempt + 2}/3)')
                if not ctx.sleep(2):
                    raise RuntimeError('Docker startup cancelled')
        if result['status'] in (docker_health.OK, docker_health.SLOW):
            if result['status'] == docker_health.SLOW:
                ctx.log('Docker is responding slowly; continuing without restarting the runtime.')
            docker_health.forget()
            return
        ctx.log('Docker is not ready; recovering OrbStack using the navbar restart procedure.')
        # Run inside the current service/Discover job, preserving its logs and cancellation.
        # `orb start` alone cannot recover a running but unresponsive VM.
        if docker_restart._restart(ctx, wait_for_opensearch=False) != 0:
            raise RuntimeError('Docker startup cancelled' if ctx.cancelled else
                               'OrbStack recovery failed. See the startup log for details.')

    def stop(self, ctx):
        self.manager._local_docker()
        self.manager._command([settings.ORB_BIN or shutil.which('orb') or 'orb', 'stop'], timeout=90)
        docker_health.forget()

    def logs(self, cursor=None):
        path = Path.home() / '.orbstack' / 'log' / 'vmgr.log'
        return self.log_result(**file_feed(path, cursor, 'No OrbStack runtime log exists yet. Logs appear after Docker has been started.'))
