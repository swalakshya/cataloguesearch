"""Private rclone Google Drive authorization; tokens never enter job logs or API responses."""
import configparser
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
from urllib.parse import urlsplit

from deploy import settings


def require_rclone():
    executable = shutil.which('rclone')
    if not executable:
        raise ValueError('rclone is not installed or is not on the dev server PATH. Install rclone and restart the dev server.')
    return executable


def connected():
    config = configparser.ConfigParser(interpolation=None)
    try:
        config.read(settings.BACKUP_RCLONE_CONFIG)
        return config.get(settings.BACKUP_DRIVE_REMOTE, 'type', fallback='') == 'drive' and bool(config.get(settings.BACKUP_DRIVE_REMOTE, 'token', fallback=''))
    except (OSError, configparser.Error):
        return False


def capabilities():
    available = bool(shutil.which('rclone'))
    return {'rclone_available': available, 'connected': available and connected(),
            'error': None if available else 'rclone is not installed or is not on the dev server PATH. Install rclone and restart the dev server.'}


def command(*args):
    return [require_rclone(), '--config', str(settings.BACKUP_RCLONE_CONFIG), '--ask-password=false', *map(str, args)]


def authorization_url(line):
    for url in re.findall(r'https?://[^\s<>]+', line):
        parsed = urlsplit(url)
        if parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost') and parsed.path == '/auth':
            return url
    return None


def extract_token(output):
    decoder = json.JSONDecoder()
    for match in re.finditer(r'\{', output):
        try:
            token, _ = decoder.raw_decode(output[match.start():])
        except ValueError:
            continue
        if isinstance(token, dict) and token.get('access_token') and token.get('refresh_token'):
            return token
    raise ValueError('Google authorization did not return a usable token.')


def save_token(token):
    path = settings.BACKUP_RCLONE_CONFIG
    if not path.parent.exists():
        path.parent.mkdir(parents=True, mode=0o700)
    config = configparser.ConfigParser(interpolation=None)
    config[settings.BACKUP_DRIVE_REMOTE] = {'type': 'drive', 'scope': 'drive', 'token': json.dumps(token)}
    for key in ('client_id', 'client_secret'):
        value = os.environ.get(f'RCLONE_DRIVE_{key.upper()}')
        if value:
            config[settings.BACKUP_DRIVE_REMOTE][key] = value
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as fh:
        temp_path = fh.name
        os.chmod(temp_path, 0o600)
        config.write(fh)
    os.replace(temp_path, path)


def _list(path):
    try:
        result = subprocess.run(command('lsjson', path, '--dirs-only'), capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError('Google Drive could not be reached. Reconnect and retry.') from exc
    if result.returncode:
        raise ValueError('Google Drive listing failed. Reconnect Google Drive and retry.')
    try:
        return json.loads(result.stdout)
    except ValueError as exc:
        raise ValueError('Google Drive returned an invalid directory listing.') from exc


def list_folders():
    if not connected():
        raise ValueError('Connect Google Drive before submitting a backup.')
    # Drive permits duplicate names: never silently select a different snapshots folder.
    root = _list(f'{settings.BACKUP_DRIVE_REMOTE}:')
    matches = [entry for entry in root if entry.get('Name') == settings.BACKUP_DRIVE_FOLDER and entry.get('IsDir')]
    if len(matches) > 1:
        raise ValueError('More than one snapshots folder exists in My Drive. Resolve the duplicate folders before backing up.')
    return _list(f'{settings.BACKUP_DRIVE_REMOTE}:{settings.BACKUP_DRIVE_FOLDER}') if matches else []


class DriveConnection:
    def __init__(self):
        self.lock = threading.RLock()
        self.state = 'idle'
        self.url = None
        self.error = None
        self.proc = None
        self.generation = 0

    def status(self):
        with self.lock:
            return {**capabilities(), 'connection_state': self.state, 'auth_url': self.url, 'connection_error': self.error}

    def start(self):
        require_rclone()
        with self.lock:
            if self.state == 'connecting':
                return self.status()
            self.generation += 1
            generation = self.generation
            self.state, self.url, self.error = 'connecting', None, None
            threading.Thread(target=self._authorize, args=(generation,), daemon=True).start()
            return self.status()

    def cancel(self):
        with self.lock:
            self.generation += 1
            proc = self.proc
            self.proc = None
            self.state, self.url, self.error = 'idle', None, None
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
        return self.status()

    def _authorize(self, generation):
        proc = None
        timer = None
        try:
            # Authorization output contains credentials. Keep it in memory, never use the job runner.
            proc = subprocess.Popen([require_rclone(), 'authorize', 'drive', '--auth-no-open-browser', '--drive-scope', 'drive'],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, stdin=subprocess.DEVNULL)
            with self.lock:
                if generation != self.generation:
                    proc.terminate()
                    proc.wait(timeout=3)
                    return
                self.proc = proc
            timer = threading.Timer(300, proc.kill)
            timer.daemon = True
            timer.start()
            output = []
            for line in proc.stdout:
                output.append(line)
                url = authorization_url(line)
                if url:
                    with self.lock:
                        if generation == self.generation:
                            self.url = url
            code = proc.wait()
            if code:
                raise ValueError('Authorization failed or timed out. Click Connect Google Drive to retry.')
            token = extract_token(''.join(output))
            with self.lock:
                if generation == self.generation:
                    save_token(token)
                    self.state, self.url, self.error = 'connected', None, None
        except Exception:
            with self.lock:
                if generation == self.generation:
                    self.state, self.url = 'error', None
                    self.error = 'Google Drive authorization failed or timed out. Retry Connect Google Drive.'
        finally:
            if timer:
                timer.cancel()
            if proc and proc.poll() is None:
                proc.kill()
                proc.wait(timeout=3)
            if proc and proc.stdout:
                proc.stdout.close()
            with self.lock:
                if generation == self.generation:
                    self.proc = None


connection = DriveConnection()
