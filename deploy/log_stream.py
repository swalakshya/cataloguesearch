"""Bounded incremental file and Docker log reads. Stdlib-only for SSH execution."""
import base64
import codecs
from collections import deque
import json
import hashlib
import os
from pathlib import Path
import selectors
import subprocess
import time

MAX_BYTES = 5 * 1024 * 1024
MAX_LINES = 10000


def encode_cursor(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode()


def decode_cursor(value):
    if not value:
        return None
    try:
        result = json.loads(base64.urlsafe_b64decode(value))
        if not isinstance(result, dict):
            raise ValueError()
        return result
    except Exception:
        raise ValueError('Invalid log cursor') from None


def limit_text(text):
    raw = text.encode()
    if len(raw) <= MAX_BYTES:
        return text, False
    start = len(raw) - MAX_BYTES
    while start < len(raw) and raw[start] & 0xc0 == 0x80:
        start += 1
    return raw[start:].decode(), True


def _read_file(path, offset):
    with path.open('rb') as stream:
        stat = os.fstat(stream.fileno())
        size = stat.st_size
        start = max(offset, size - MAX_BYTES)
        stream.seek(start)
        raw = stream.read(MAX_BYTES)
        truncated = start > offset
        if truncated and b'\n' in raw:
            skipped = raw.index(b'\n') + 1
            raw = raw[skipped:]
            start += skipped
        decoder = codecs.getincrementaldecoder('utf-8')('replace')
        text = decoder.decode(raw, final=False)
        pending = decoder.getstate()[0]
        position = start + len(raw) - len(pending)
        stream.seek(max(0, position - 64))
        fingerprint = hashlib.sha256(stream.read(min(64, position))).hexdigest()
        text, capped = limit_text(text)
        return text, {'device': stat.st_dev, 'inode': stat.st_ino, 'offset': position, 'fingerprint': fingerprint}, truncated or capped


def file_feed(path, cursor=None, missing=''):
    path = Path(path)
    previous = decode_cursor(cursor)
    if not path.is_file():
        return {'text': missing, 'cursor': cursor, 'truncated': False, 'reset': False}
    stat = path.stat()
    same = previous and previous.get('device') == stat.st_dev and previous.get('inode') == stat.st_ino
    offset = previous.get('offset', 0) if same else 0
    if type(offset) is not int or offset < 0:
        raise ValueError('Invalid log cursor')
    prefix = ''
    gap = False
    if previous and not same:
        backup = path.with_name(path.name + '.1')
        if backup.is_file() and backup.stat().st_ino == previous.get('inode'):
            prefix, _, gap = _read_file(backup, previous.get('offset', 0))
        else:
            prefix = '\n[Older log entries are no longer available after rotation.]\n'
            gap = True
    changed = False
    if same and previous.get('fingerprint') and offset <= stat.st_size:
        with path.open('rb') as stream:
            stream.seek(max(0, offset - 64))
            changed = hashlib.sha256(stream.read(min(64, offset))).hexdigest() != previous['fingerprint']
    if offset > stat.st_size or changed:
        prefix += '\n[Log file was truncated.]\n'
        offset = 0
        gap = True
    text, position, truncated = _read_file(path, offset)
    text = prefix + text
    # Bound combined rotation output too. The UI separately limits retained history.
    text, capped = limit_text(text)
    truncated = truncated or capped
    return {'text': text, 'cursor': encode_cursor(position), 'truncated': truncated or gap, 'reset': False}


def _bounded_command(argv, timeout=15):
    """Keep only a bounded tail while draining both Docker output streams."""
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    chunks = deque()
    size = 0
    truncated = False
    deadline = time.monotonic() + timeout
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(argv, timeout)
            if not selector.select(min(remaining, .5)):
                continue
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            while size > MAX_BYTES:
                excess = size - MAX_BYTES
                first = chunks.popleft()
                removed = min(excess, len(first))
                if removed < len(first):
                    chunks.appendleft(first[removed:])
                size -= removed
                truncated = True
        code = process.wait(timeout=max(.01, deadline - time.monotonic()))
        output = b''.join(chunks)
        if code:
            raise RuntimeError(output[-1000:].decode(errors='replace') or 'Docker logs failed')
        if truncated and b'\n' in output:
            output = output.split(b'\n', 1)[1]
        text, capped = limit_text(output.decode(errors='replace'))
        return text, truncated or capped
    finally:
        selector.close()
        process.stdout.close()
        if process.poll() is None:
            process.kill()
            process.wait()


def docker_feed(container, cursor=None, since=None, lines=MAX_LINES):
    previous = decode_cursor(cursor)
    identity = subprocess.run(['docker', 'inspect', '--format', '{{.Id}}', container],
                              capture_output=True, text=True, timeout=5)
    if identity.returncode:
        raise RuntimeError(identity.stderr.strip()[:500] or 'Container not found')
    identity = identity.stdout.strip()
    same = previous and previous.get('container') == identity
    stamp = previous.get('stamp') if same else None
    count = previous.get('count', 0) if same else 0
    if stamp is not None and (not isinstance(stamp, str) or len(stamp) > 64):
        raise ValueError('Invalid log cursor')
    if type(count) is not int or count < 0:
        raise ValueError('Invalid log cursor')
    argv = ['docker', 'logs', '--timestamps']
    if not stamp:
        argv += ['--tail', str(lines)]
    if stamp or since:
        argv += ['--since', stamp or since]
    argv.append(container)
    text, truncated = _bounded_command(argv)
    output = []
    boundary_seen = 0
    newest, newest_count = stamp, count
    for line in text.splitlines(keepends=True):
        timestamp = line.partition(' ')[0]
        if not timestamp.endswith('Z') or 'T' not in timestamp:
            continue
        if stamp and timestamp == stamp:
            boundary_seen += 1
            if boundary_seen <= count:
                continue
        elif stamp and timestamp < stamp:
            continue
        output.append(line)
        if newest is None or timestamp > newest:
            newest, newest_count = timestamp, 1
        elif timestamp == newest:
            newest_count += 1
    return {'text': ''.join(output), 'cursor': encode_cursor({'container': identity, 'stamp': newest, 'count': newest_count}),
            'truncated': truncated or len(output) >= lines, 'reset': bool(previous and not same)}
