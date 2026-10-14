"""Per-service log supervisor. Detached from the dashboard's lifetime.

No reload watcher: only explicit Restart/Update loads new source. The supervisor
and its child share a private process group, allowing immediate group termination.
"""
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import subprocess
import signal
import sys

from deploy.services import SERVICE_TYPES
from deploy.services.common import redact_text


def main():
    service = sys.argv[1]
    if service not in {implementation.id for implementation in SERVICE_TYPES if implementation.native}:
        raise ValueError('Unsupported local process')
    directory = Path(os.environ['LOCAL_SERVICE_DIRECTORY'])
    directory.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(directory / f'{service}.log', maxBytes=4 * 1024 * 1024, backupCount=1)
    handler.setFormatter(logging.Formatter('%(message)s'))
    log = logging.getLogger('local-service')
    log.setLevel(logging.INFO)
    log.addHandler(handler)
    secrets = []

    class Mask(logging.Filter):
        def filter(self, record):
            record.msg = redact_text(record.getMessage(), secrets)
            record.args = ()
            return True

    handler.addFilter(Mask())
    # Stay alive while the child receives the group signal. If it ignores TERM,
    # the dashboard can still verify our identity before killing the group.
    signal.signal(signal.SIGTERM, lambda *_: None)
    process = None
    try:
        spec = json.load(sys.stdin)
        secrets = spec.pop('secrets', [])
        log.info('Starting %s from local source', service)
        process = subprocess.Popen(spec['command'], cwd=spec['cwd'], env=spec['env'],
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        while True:
            chunk = process.stdout.readline(65536)
            if not chunk:
                break
            log.info(chunk.decode(errors='replace').rstrip('\r\n'))
        code = process.wait()
        log.info('%s exited with code %s', service, code)
        return code
    except Exception:
        log.error('Local service could not start: %s', sys.exc_info()[1])
        return 1
    finally:
        if process and process.poll() is None:
            process.kill()
            process.wait()
        log.removeHandler(handler)
        handler.close()


if __name__ == '__main__':
    sys.exit(main())
