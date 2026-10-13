"""Executed over SSH only after a confirmed renewal request. Stdlib only.

The shared /etc/letsencrypt mount already exists on the frontend. A persistent
pre-hook ensures HTTP challenges also work if an older frontend image is recreated.
"""
import configparser
import json
from pathlib import Path
import secrets
import socket
import ssl
import subprocess
import sys
import time
import urllib.request

NAME = "swalakshya.me-0001"
DOMAINS = ("swalakshya.me", "www.swalakshya.me", "chat.swalakshya.me")
ROOT = Path("/etc/letsencrypt")
WEBROOT = ROOT / "webroot"
FRONTEND = "cataloguesearch-frontend"

# This hook only adjusts the two HTTP redirect blocks. HTTPS and application
# routes are preserved. Config validation/reload failure restores the old file.
PRE_HOOK = r'''#!/usr/bin/python3
import pathlib, subprocess
def run(args, data=None):
    p = subprocess.run(args, input=data, text=True, capture_output=True, timeout=30)
    if p.returncode: raise RuntimeError(p.stderr or p.stdout)
    return p.stdout
pathlib.Path('/etc/letsencrypt/webroot/.well-known/acme-challenge').mkdir(parents=True, exist_ok=True)
base = ['docker', 'exec', '-i', 'cataloguesearch-frontend']
old = run(base + ['cat', '/etc/nginx/nginx.conf'])
new = old
if 'root /etc/letsencrypt/webroot;' not in old:
    for redirect in ('return 301 https://$host$request_uri;', 'return 301 https://swalakshya.me/chat;'):
        needle = '        ' + redirect
        if needle not in new: raise RuntimeError('Unrecognized frontend HTTP configuration; refusing to modify it')
        replacement = ('        location ^~ /.well-known/acme-challenge/ {\n'
                       '            root /etc/letsencrypt/webroot;\n'
                       '            default_type text/plain;\n'
                       '            try_files $uri =404;\n'
                       '        }\n'
                       '        location / { ' + redirect + ' }')
        new = new.replace(needle, replacement, 1)
if new != old:
    try:
        run(base + ['tee', '/etc/nginx/nginx.conf'], new)
        run(base + ['nginx', '-t'])
        run(base + ['nginx', '-s', 'reload'])
    except Exception:
        run(base + ['tee', '/etc/nginx/nginx.conf'], old)
        run(base + ['nginx', '-t'])
        run(base + ['nginx', '-s', 'reload'])
        raise
else:
    run(base + ['nginx', '-t'])
'''

DEPLOY_HOOK = '''#!/bin/sh
set -eu
docker exec cataloguesearch-frontend nginx -t
docker exec cataloguesearch-frontend nginx -s reload
'''


def run(argv, timeout=30):
    print("$ " + " ".join(argv), flush=True)
    subprocess.run(argv, check=True, timeout=timeout)


def write_hook(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text() != content:
        backup = path.with_suffix(path.suffix + ".before-webroot")
        if not backup.exists():
            backup.write_bytes(path.read_bytes())
        # Backups must not be executable: Certbot runs executable hook files.
        backup.chmod(0o600)
    temp = path.with_suffix(path.suffix + ".new")
    temp.write_text(content)
    temp.chmod(0o755)
    temp.replace(path)


def progress(label):
    print('@@PROGRESS ' + json.dumps({"label": label}), flush=True)


def reconfigure_webroot():
    argv = ['certbot', 'reconfigure', '--cert-name', NAME, '--webroot', '-w', str(WEBROOT), '--non-interactive']
    for attempt in range(3):
        print('$ ' + ' '.join(argv), flush=True)
        result = subprocess.run(argv, capture_output=True, text=True, timeout=300)
        output = (result.stdout or '') + (result.stderr or '')
        print(output, flush=True)
        if result.returncode == 0:
            return
        # The CA can return 404 for a newly-created authorization or issued
        # certificate (see certbot/certbot#10184). These missing-resource errors
        # differ from failed domain validation; never bypass the staging test.
        missing_resource = next((message for message in ('Certificate not found', 'No such authorization')
                                 if message in output), None)
        if not missing_resource or attempt == 2:
            detail = (' Let’s Encrypt staging repeatedly returned a missing-resource error; try again later.'
                      if missing_resource else '')
            raise RuntimeError('Certbot webroot test failed.' + detail +
                               ' Existing certificate and renewal settings were preserved; see the output above.')
        delay = 15 * (attempt + 1)
        progress(f'Staging API returned {missing_resource}; retry {attempt + 2}/3 in {delay}s')
        print(f'Let’s Encrypt staging returned {missing_resource}; retrying the test in {delay}s.', flush=True)
        time.sleep(delay)


def prepare():
    # Fail before writes if the expected certificate/container are not present.
    config = configparser.ConfigParser(interpolation=None, strict=False)
    config.read_string('[certificate]\n' + (ROOT / 'renewal' / (NAME + '.conf')).read_text())
    run(['docker', 'exec', FRONTEND, 'nginx', '-t'])
    progress('Preparing HTTP validation without stopping the website')
    hook = ROOT / 'renewal-hooks' / 'pre' / 'webroot-nginx.py'
    write_hook(hook, PRE_HOOK)
    run([str(hook)])
    token = secrets.token_hex(24)
    challenge = WEBROOT / '.well-known' / 'acme-challenge' / token
    challenge.write_text(token)
    try:
        for domain in DOMAINS:
            with urllib.request.urlopen(f'http://{domain}/.well-known/acme-challenge/{token}', timeout=10) as response:
                if response.status != 200 or response.read(1024).decode() != token:
                    raise RuntimeError(f'HTTP validation path failed for {domain}')
            print(f'HTTP validation path works: {domain}', flush=True)
    finally:
        challenge.unlink(missing_ok=True)
    # Replace the existing Compose "up -d" hook with an actual Nginx reload.
    write_hook(ROOT / 'renewal-hooks' / 'deploy' / 'reload-nginx.sh', DEPLOY_HOOK)
    if config.get('renewalparams', 'authenticator', fallback='') != 'webroot':
        progress('Testing and saving webroot renewal settings with Certbot')
        reconfigure_webroot()
    print('Webroot renewal is ready. The existing Certbot timer will use it.', flush=True)


def renew():
    progress('Renewing credentials if due; the website stays online')
    config = configparser.ConfigParser(interpolation=None, strict=False)
    config.read_string('[certificate]\n' + (ROOT / 'renewal' / (NAME + '.conf')).read_text())
    if config.get('renewalparams', 'authenticator', fallback='') != 'webroot':
        raise RuntimeError('Webroot renewal is not configured; prepare must succeed first')
    # Use the same service as the timer so its Result and journal accurately
    # reflect this manual renewal too, and timer/manual runs cannot overlap.
    try:
        run(['systemctl', 'start', 'certbot.service'], timeout=300)
    finally:
        run(['journalctl', '-u', 'certbot.service', '-n', '15', '--no-pager'])
    # Also recover a previously missed reload when renewal is not due.
    run(['docker', 'exec', FRONTEND, 'nginx', '-t'])
    run(['docker', 'exec', FRONTEND, 'nginx', '-s', 'reload'])


def verify():
    progress('Verifying the served certificate and HTTPS for every domain')
    disk = ssl.PEM_cert_to_DER_cert((ROOT / 'live' / NAME / 'cert.pem').read_text())
    context = ssl.create_default_context()
    for domain in DOMAINS:
        for attempt in range(10):
            with socket.create_connection((domain, 443), timeout=10) as sock:
                with context.wrap_socket(sock, server_hostname=domain) as connection:
                    if connection.getpeercert(binary_form=True) == disk:
                        print(f'{domain}: certificate valid, matches disk; expires {connection.getpeercert()["notAfter"]}', flush=True)
                        break
            if attempt == 9:
                raise RuntimeError(f'{domain} is not serving the certificate on disk after Nginx reload')
            time.sleep(1)
        with urllib.request.urlopen(f'https://{domain}/', timeout=15) as response:
            if response.status != 200:
                raise RuntimeError(f'{domain}: unexpected HTTPS response {response.status}')
    print('All HTTPS checks passed.', flush=True)


if __name__ == '__main__':
    try:
        {"prepare": prepare, "renew": renew, "verify": verify}[sys.argv[1]]()
    except Exception as exc:
        print(f'Certificate maintenance failed: {exc}', flush=True)
        sys.exit(1)
