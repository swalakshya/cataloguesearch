"""Bounded, read-only Docker log snapshots over production SSH."""
from datetime import datetime, timezone
import json
import shlex
import subprocess

from deploy import settings

SERVICES = {
    'chat': 'cataloguesearch-chat',
    'api': 'cataloguesearch-api',
    'frontend': 'cataloguesearch-frontend',
    'opensearch': 'opensearch-node',
}
WINDOWS = ('5m', '15m', '1h', '24h')
MAX_BYTES = 256 * 1024

# Docker sends application stderr logs to stderr even on success. Merge both
# streams remotely and use Docker's exit code to distinguish actual failures.
_REMOTE_PROBE = '''import json, subprocess, sys
container, lines, since = json.loads(sys.argv[1])
try:
    proc = subprocess.run(['docker', 'logs', '--timestamps', '--tail', str(lines),
                           '--since', since, container], stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, timeout=15)
    output = proc.stdout
    if proc.returncode:
        print(json.dumps({'error': output[-1000:].decode('utf-8', 'replace')}))
    else:
        print(json.dumps({'text': output[-262144:].decode('utf-8', 'replace'),
                          'truncated': len(output) > 262144}))
except Exception as exc:
    print(json.dumps({'error': str(exc)[:1000]}))
'''


def snapshot(service='chat', lines=200, since='15m'):
    if service not in SERVICES or type(lines) is not int or not 1 <= lines <= 500 or since not in WINDOWS:
        raise ValueError('Invalid production log selection')
    result = {'service': service, 'container': SERVICES[service], 'host': settings.PROD_HOST,
              'checked_at': datetime.now(timezone.utc).isoformat(), 'lines': lines, 'since': since}
    args = shlex.quote(json.dumps([SERVICES[service], lines, since]))
    try:
        proc = subprocess.run(['ssh', *settings.SSH_OPTS, settings.PROD_HOST, 'python3 - ' + args],
                              input=_REMOTE_PROBE, capture_output=True, text=True, timeout=30)
        if proc.returncode:
            raise RuntimeError(proc.stderr.strip()[:1000] or 'Production SSH failed')
        payload = json.loads(proc.stdout)
        if not isinstance(payload, dict):
            raise ValueError('Invalid log response')
        if payload.get('error'):
            raise RuntimeError(str(payload['error'])[:1000])
        if not isinstance(payload.get('text'), str) or not isinstance(payload.get('truncated'), bool):
            raise ValueError('Invalid log response')
        result.update(payload, reachable=True)
    except (OSError, subprocess.SubprocessError, ValueError, RuntimeError) as exc:
        result.update(reachable=False, error=str(exc)[:1000], text='', truncated=False)
    return result
