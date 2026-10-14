"""Application-specific commands, configuration and source tracking."""
import shutil
import sys
import uuid
import yaml
from deploy import settings
from deploy.services.common import dotenv, flatten
from deploy.services.process import ProcessService


def package_sources(base):
    return [base / name for name in ('package.json', 'package-lock.json', 'vite.config.mjs',
            'tailwind.config.js', 'postcss.config.js', 'index.html')]


def folder_sources(folders):
    return [path for folder in folders for path in folder.rglob('*')]


class APIService(ProcessService):
    id, name = 'api', 'API'
    icon = '⚙️'
    dependencies = ('opensearch',)
    default_port = 8000
    startup_timeout = 180
    health_path = '/api/metadata'

    def spec(self):
        root = settings.REPO_ROOT
        common = dotenv(root / '.env.local')
        configured = dict(common)
        cwd = root
        sources = [root / '.env.local']
        configured.update(OPENSEARCH_HOST='localhost', OPENSEARCH_PORT='9200', ENVIRONMENT='local',
                          CHAT_ADMIN_BASE_URL='http://localhost:8012', PYTHONUNBUFFERED='1',
                          SESSION_COOKIE_DOMAIN='', SESSION_COOKIE_SECURE='false', API_HOST='127.0.0.1', API_PORT='8000')
        command = [sys.executable, '-m', 'uvicorn', 'backend.api.search_api:app', '--host', '127.0.0.1',
                   '--port', '8000', '--timeout-graceful-shutdown', '0']
        origins = configured.get('CORS_ALLOWED_ORIGINS', '').split(',')
        configured['CORS_ALLOWED_ORIGINS'] = ','.join(dict.fromkeys([*filter(None, origins), 'http://localhost:3000', 'http://127.0.0.1:3000']))
        return self.make_spec(configured, cwd, command, sources)

    def source_paths(self):
        root = settings.REPO_ROOT
        return folder_sources([root / 'backend', root / 'utils', root / 'configs']) + list(root.glob('requirements*.txt'))

    def values(self):
        spec, values = super().values()
        for name in ('config.yaml', 'opensearch-config.yaml'):
            path = settings.REPO_ROOT / 'configs' / name
            if path.is_file():
                values.update(flatten(yaml.safe_load(path.read_text()), name))
                spec['sources'].append(path)
        return spec, values


class ChatService(ProcessService):
    id, name = 'chat', 'Chat'
    icon = '💬'
    dependencies = ('api',)
    default_port = 8012
    health_path = '/v1/health'

    def spec(self):
        root = settings.REPO_ROOT
        common = dotenv(root / '.env.local')
        chat = settings.CHAT_REPO_DIR / 'service'
        configured = dict(common)
        sources = [root / '.env.local']
        configured.update(dotenv(chat / '.env.local', common))
        # The local API issues the cookies verified by chat. Its auth values
        # must win over stale/different values in the chat env file.
        for key in ('JWT_SECRET', 'ADMIN_KEY', 'CORS_ALLOWED_ORIGINS'):
            if key in common:
                configured[key] = common[key]
        configured.update(EXTERNAL_API_BASE_URL='http://localhost:8000', LLM_SERVICE_PORT='8012',
                          SESSION_COOKIE_DOMAIN='', SESSION_COOKIE_SECURE='false')
        configured.setdefault('CHAT_DB_PATH', './data/cataloguesearch-chat.db')
        cwd = chat
        sources.append(chat / '.env.local')
        command = [shutil.which('node') or 'node', '--input-type=module', '-e',
                   'import {createServer} from "./src/server.js"; createServer({host:"127.0.0.1"}).start().catch(e=>{console.error(e);process.exit(1)});']
        origins = configured.get('CORS_ALLOWED_ORIGINS', '').split(',')
        configured['CORS_ALLOWED_ORIGINS'] = ','.join(dict.fromkeys([*filter(None, origins), 'http://localhost:3000', 'http://127.0.0.1:3000']))
        return self.make_spec(configured, cwd, command, sources)

    def source_paths(self):
        base = settings.CHAT_REPO_DIR / 'service'
        return folder_sources([base / 'src', base / 'prompts_sets', base / 'prompts_sets_guj_search']) + package_sources(base)


class UIService(ProcessService):
    id, name = 'ui', 'Application UI'
    icon = '🖥️'
    dependencies = ('api', 'chat')
    default_port = 3000

    def spec(self):
        root = settings.REPO_ROOT
        common = dotenv(root / '.env.local')
        configured = dict(common)
        sources = [root / '.env.local']
        for name in ('.env', '.env.local', '.env.production', '.env.production.local'):
            path = root / 'frontend' / name
            configured.update(dotenv(path, configured))
            sources.append(path)
        configured.update(REACT_APP_API_BASE_URL='http://localhost:8000/api',
                          REACT_APP_LLM_API_BASE_URL='http://localhost:8012', REACT_APP_DEV_TOOLS='false')
        cwd = root / 'frontend'
        command = [sys.executable, '-m', 'deploy.local_ui_server', '--directory', str(self.directory / 'ui-build')]
        return self.make_spec(configured, cwd, command, sources)

    def prepare(self, ctx):
        version = self.manager.revision('ui')
        spec = self.manager.spec('ui')
        destination = self.directory / 'ui-builds' / uuid.uuid4().hex
        ctx.progress('Building application UI from local files; the running UI stays available')
        try:
            self.manager._command([shutil.which('npm') or 'npm', 'run', 'build', '--', '--outDir', str(destination), '--emptyOutDir'],
                          timeout=180, cwd=spec['cwd'], env=spec['env'])
            if not (destination / 'index.html').is_file():
                raise RuntimeError('UI build did not produce an index page')
            if version != self.manager.revision('ui'):
                raise RuntimeError('Source changed during preparation. Update again.')
            spec['command'][-1] = str(destination)
            return spec, version
        except Exception:
            shutil.rmtree(destination, ignore_errors=True)
            raise

    def source_paths(self):
        root = settings.REPO_ROOT
        base = root / 'frontend'
        return folder_sources([base / 'src', base / 'public']) + package_sources(base) + [root / 'deploy' / 'local_ui_server.py']

    def update(self, ctx):
        prepared = self.prepare(ctx)
        self.manager._stop_one(self.id, ctx)
        self.manager._start_one(self.id, ctx, prepared=prepared)

    def after_start(self):
        if self.manager._owned(self.id):
            builds = self.directory / 'ui-builds'
            if builds.is_dir():
                releases = sorted((path for path in builds.iterdir() if path.is_dir()), key=lambda path: path.stat().st_mtime, reverse=True)
                for old in releases[2:]:
                    shutil.rmtree(old, ignore_errors=True)
