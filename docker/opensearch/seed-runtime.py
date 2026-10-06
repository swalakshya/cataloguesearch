"""Seed the data-volume runtime cache from libraries baked into this image."""
import hashlib
import json
from pathlib import Path
import shutil

source = Path('/opt/opensearch-runtime')
target = Path('/usr/share/opensearch/data/ml_cache')
manifest = json.loads((source / 'checksums.json').read_text())


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


for relative, expected in manifest.items():
    original = source / relative
    if checksum(original) != expected:
        raise RuntimeError(f'Bundled runtime checksum mismatch: {relative}')
    destination = target / relative
    if destination.exists() and checksum(destination) == expected:
        continue
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.seed')
    shutil.copyfile(original, temporary)
    temporary.replace(destination)
print('Bundled CPU/tokenizer runtime cache is ready', flush=True)
