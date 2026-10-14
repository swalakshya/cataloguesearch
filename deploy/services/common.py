"""Shared configuration parsing, masking and bounded log reads."""
import json
import os
from pathlib import Path
import re
from dotenv import dotenv_values

SECRET = re.compile(r'key|secret|token|password|credential|authorization|cookie', re.I)

URL_CREDENTIALS = re.compile(r'(https?://|[a-z][a-z0-9+.-]*://)([^/\s@]+)@', re.I)
INLINE_SECRET = re.compile(r'(?i)((?:[\w.-]*(?:password|secret|token|api[_-]?key|authorization|credential)[\w.-]*)[\"\']?\s*[:=]\s*[\"\']?)([^\s,;\"\'}]+)')
RUNTIME_ENV = {'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'TZ',
               'VIRTUAL_ENV', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS',
               'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'}


def sensitive(key, value):
    return bool(SECRET.search(key) or (isinstance(value, str) and
                (URL_CREDENTIALS.search(value) or INLINE_SECRET.search(value))))


def redact_text(text, secrets=()):
    for value in sorted(set(secrets), key=len, reverse=True):
        if len(value) >= 4:
            text = text.replace(value, '[masked]')
    text = re.sub(r'(?i)(Bearer\s+)[A-Za-z0-9._~+/=-]+', r'\1[masked]', text)
    text = URL_CREDENTIALS.sub(r'\1[masked]@', text)
    text = INLINE_SECRET.sub(r'\1[masked]', text)
    return text


def flatten(value, prefix=''):
    if isinstance(value, dict):
        return {k: v for name, item in value.items() for k, v in flatten(item, f'{prefix}.{name}' if prefix else str(name)).items()}
    return {prefix: value if isinstance(value, (str, int, float, bool)) or value is None else json.dumps(value)}


def dotenv(path, base=None):
    # Resolve file references without stale application values inherited by the dashboard.
    scope = {k: v for k, v in os.environ.items() if k in RUNTIME_ENV or k.startswith('LC_')}
    scope.update(base or {})
    values = {}
    if path.is_file():
        for key, value in dotenv_values(path, interpolate=False).items():
            if value is not None:
                value = re.sub(r'\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}',
                               lambda match: scope.get(match[1], match[2] or ''), value)
                values[key] = scope[key] = value
    return values


def read_log(path, missing=''):
    if not path.is_file():
        return missing
    with path.open('rb') as stream:
        stream.seek(max(0, path.stat().st_size - 262144))
        return stream.read(262144).decode(errors='replace')
