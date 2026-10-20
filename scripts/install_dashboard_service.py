"""Install the standalone dashboard in macOS launchd.

Run with the dashboard virtualenv's Python. The default installs a system daemon
(admin password required) that runs as your account, including while logged out.
--session starts a supervised service for the current login without admin access.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import pwd
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LABEL = 'com.swalakshya.dashboard'


def specification(username, python, system=True):
    account = pwd.getpwnam(username)
    runtime = ROOT / '.dashboard'
    value = {
        'Label': LABEL,
        'ProgramArguments': [python, str(ROOT / 'dashboard.py'), '--port', '4000'],
        'WorkingDirectory': str(ROOT),
        'RunAtLoad': True,
        'KeepAlive': True,
        'ThrottleInterval': 15,
        'ExitTimeOut': 120,
        'StandardOutPath': str(runtime / 'service.stdout.log'),
        'StandardErrorPath': str(runtime / 'service.stderr.log'),
        'EnvironmentVariables': {
            'HOME': account.pw_dir, 'USER': username, 'LOGNAME': username,
            'PATH': f'{Path(python).parent}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
            'VIRTUAL_ENV': str(Path(python).parent.parent),
            'PYTHONUNBUFFERED': '1',
        },
    }
    if system:
        import grp
        value.update(UserName=username, GroupName=grp.getgrgid(account.pw_gid).gr_name)
    return value


def loaded(target):
    return subprocess.run(['/bin/launchctl', 'print', target], stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL).returncode == 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--session', action='store_true')
    parser.add_argument('--user', default=os.environ.get('SUDO_USER') or pwd.getpwuid(os.getuid()).pw_name)
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('This installer requires macOS')
    if not args.session and os.geteuid() != 0:
        print('Installing the dashboard for all logins requires your macOS administrator password.', flush=True)
        os.execv('/usr/bin/sudo', ['/usr/bin/sudo', sys.executable, str(Path(__file__).resolve()), '--user', args.user])
    account = pwd.getpwnam(args.user)
    if account.pw_uid == 0:
        parser.error('Choose a regular account with --user; the dashboard must not run as root')
    runtime = ROOT / '.dashboard'
    manifest = json.loads((runtime / 'current.json').read_text())
    if not (runtime / 'releases' / manifest['release'] / 'dashboard.html').is_file():
        parser.error('Build the dashboard first: python dashboard.py --build')
    domain = f'gui/{account.pw_uid}' if args.session else 'system'
    target = f'{domain}/{LABEL}'
    if args.session and loaded(f'system/{LABEL}'):
        parser.error('The system dashboard daemon is already installed; a session service is unnecessary')
    path = runtime / f'{LABEL}.session.plist' if args.session else Path('/Library/LaunchDaemons') / f'{LABEL}.plist'
    path.write_bytes(plistlib.dumps(specification(args.user, sys.executable, system=not args.session)))
    path.chmod(0o644)
    if not args.session:
        os.chown(path, 0, 0)
    subprocess.run(['/usr/bin/plutil', '-lint', str(path)], check=True)
    # Stop only our launchd services; never kill an unrelated listener on port 4000.
    for previous in ([f'gui/{account.pw_uid}/{LABEL}', target] if not args.session else [target]):
        if loaded(previous):
            subprocess.run(['/bin/launchctl', 'bootout', previous], check=True)
    subprocess.run(['/bin/launchctl', 'bootstrap', domain, str(path)], check=True)
    print(f'Dashboard service loaded: {target}')
    print('Open http://localhost:4000/dev')
    if args.session:
        print('This session service ends at logout. Run this installer without --session for boot startup.')


if __name__ == '__main__':
    main()
