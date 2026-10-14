"""Standalone dev dashboard: python dashboard.py --build, then python dashboard.py.

Normal startup needs only this virtualenv and previously built assets. No Docker,
Node server, app API or chat service is required. Node/npm is used only to build
UI assets initially or when a user requests an update containing frontend changes.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import uuid

from deploy.dashboard_updates import ROOT, RUNTIME, read_state, revisions, write_state


def build_assets(version):
    release = uuid.uuid4().hex[:12]
    output = RUNTIME / 'releases' / release
    npm = shutil.which('npm')
    if not npm:
        raise RuntimeError('Building UI changes needs Node/npm. The existing dashboard remains available. Install Node and retry.')
    env = {**os.environ, 'DASHBOARD_OUTPUT': str(output), 'DASHBOARD_RELEASE': release}
    try:
        subprocess.run([npm, 'run', 'build:dashboard'], cwd=ROOT / 'frontend', env=env, check=True, timeout=180)
        if not (output / 'dashboard.html').is_file():
            raise RuntimeError('Dashboard build did not produce its entry page')
        if revisions()['frontend'] != version['frontend']:
            raise RuntimeError('UI source changed during the build. Please apply the update again.')
        manifest = {'release': release, 'frontend': version['frontend']}
        return manifest
    except Exception:
        shutil.rmtree(output, ignore_errors=True)
        raise


def launch(manifest, version, port):
    env = {**os.environ, 'DASHBOARD_MANAGED': '1',
           'DASHBOARD_STATE_PATH': str(RUNTIME / 'update.json'),
           'DASHBOARD_REVISION': json.dumps({**version, 'frontend': manifest['frontend']}),
           'DASHBOARD_INSTANCE': uuid.uuid4().hex,
           'DASHBOARD_RELEASE': manifest['release']}
    return subprocess.Popen([sys.executable, '-m', 'uvicorn', 'dev:app', '--host', '127.0.0.1',
                             '--port', str(port), '--timeout-graceful-shutdown', '30'], cwd=ROOT, env=env)


def validate_backend(manifest):
    # Import in a separate interpreter without running startup handlers. A
    # syntax/import error must not take the working dashboard offline.
    env = {**os.environ, 'DASHBOARD_RELEASE': manifest['release']}
    subprocess.run([sys.executable, '-c',
                    'import ast, pathlib; ast.parse(pathlib.Path("dashboard.py").read_text()); import dev'],
                   cwd=ROOT, env=env, check=True, timeout=90)


def stop(child):
    if child.poll() is None:
        child.terminate()
        child.wait()  # Uvicorn drains outstanding requests; never force-kill an update.


def check_port(port):
    # Match Uvicorn's listener options. Without reuse, recently closed HTTP
    # connections can make an otherwise free port appear occupied after exec.
    with socket.socket() as check:
        check.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        check.bind(('127.0.0.1', port))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', action='store_true', help='Build the initial dashboard UI (requires npm)')
    parser.add_argument('--port', type=int, default=4000)
    args = parser.parse_args()
    RUNTIME.mkdir(exist_ok=True)
    with (RUNTIME / 'launcher.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('A dashboard launcher is already running.')
        manifest_path = RUNTIME / 'current.json'
        version = revisions()
        if args.build:
            manifest = build_assets(version)
            write_state(manifest_path, manifest)
            print('Dashboard UI built. Start with this virtualenv: python dashboard.py', flush=True)
            return
        manifest = read_state(manifest_path)
        if not manifest.get('release') or not (RUNTIME / 'releases' / manifest['release'] / 'dashboard.html').is_file():
            parser.error('Build the dashboard first: python dashboard.py --build')
        # Detect port conflicts before starting a child or altering job state.
        check_port(args.port)
        state_path = RUNTIME / 'update.json'
        write_state(state_path, {'phase': 'idle'})
        child = launch(manifest, version, args.port)
        stopping = False
        def shutdown(*_):
            nonlocal stopping
            stopping = True
        signal.signal(signal.SIGTERM, shutdown)
        signal.signal(signal.SIGINT, shutdown)
        print(f'Dev dashboard: http://localhost:{args.port}/dev', flush=True)
        try:
            while not stopping:
                if child.poll() is not None:
                    raise RuntimeError(f'Dashboard server exited ({child.returncode}); check its output above.')
                if read_state(state_path).get('phase') == 'ready':
                    try:
                        target = revisions()
                        write_state(state_path, {'phase': 'building', 'message': 'Preparing dashboard update'})
                        candidate = build_assets(target) if target['frontend'] != manifest['frontend'] else manifest
                        validate_backend(candidate)
                        if revisions() != target:
                            raise RuntimeError('Source changed while preparing the update. Please retry.')
                        write_state(state_path, {'phase': 'restarting', 'message': 'Restarting the dashboard'})
                    except Exception as exc:
                        write_state(state_path, {'phase': 'error', 'message': str(exc)[:1000]})
                    else:
                        stop(child)
                        write_state(manifest_path, candidate)
                        # Reload the launcher too, so Python updates apply to all dashboard code.
                        os.execv(sys.executable, [sys.executable, str(Path(__file__).resolve()), '--port', str(args.port)])
                time.sleep(1)
        finally:
            stop(child)


if __name__ == '__main__':
    main()
