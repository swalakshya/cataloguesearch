"""Streaming tar.zst archives for the dev backup job. No cloud credentials here."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import signal
import sys
import tarfile
import tempfile
import time

import zstandard


def progress(label, done=None, total=None):
    payload = {'label': label}
    if done is not None:
        payload.update(done=done, total=total, unit='files')
    print('@@PROGRESS '+json.dumps(payload), flush=True)


def archive_directory(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if not source.is_dir():
        raise ValueError(f'Source directory not found: {source}')
    if source == output.parent or source in output.parents:
        raise ValueError('Archive output must be outside its source directory')
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    partial = output.with_name(output.name+'.partial')
    # SQLite's online backup API captures a consistent DB, including committed WAL data.
    with tempfile.TemporaryDirectory(prefix='.sqlite-', dir=output.parent) as temp:
        databases = {}
        for path in source.rglob('*'):
            if path.is_symlink() or not path.is_file() or path.suffix not in ('.db', '.sqlite', '.sqlite3'):
                continue
            with path.open('rb') as fh:
                if fh.read(16) != b'SQLite format 3\x00':
                    continue
            copy = Path(temp) / str(len(databases))
            progress(f'Capture SQLite database: {path.relative_to(source)}')
            deadline = time.monotonic() + 600
            def check_deadline(*_):
                if time.monotonic() > deadline:
                    raise TimeoutError('SQLite backup exceeded ten minutes')
            with sqlite3.connect(path.as_uri()+'?mode=ro', uri=True) as original, sqlite3.connect(copy) as destination:
                original.backup(destination, pages=1024, progress=check_deadline)
            databases[path.relative_to(source)] = copy
        sidecars = {Path(str(path)+suffix) for path in databases for suffix in ('-wal', '-shm', '-journal')}
        files = 0
        try:
            progress(f'Compress {source.name} into {output.name}')
            with partial.open('wb') as raw, zstandard.ZstdCompressor(level=1, threads=-1).stream_writer(raw) as compressed:
                with tarfile.open(fileobj=compressed, mode='w|') as tar:
                    def include(info):
                        nonlocal files
                        relative = Path(info.name).relative_to(source.name)
                        if relative in databases or relative in sidecars:
                            return None
                        files += 1
                        if files % 100 == 0:
                            progress(f'Archived {files} entries')
                        return info
                    tar.add(source, arcname=source.name, filter=include, recursive=True)
                    for relative, path in databases.items():
                        tar.add(path, arcname=str(Path(source.name)/relative), recursive=False)
            os.chmod(partial, 0o600)
            os.replace(partial, output)
        finally:
            partial.unlink(missing_ok=True)
    print(f'Created {output.name}: {output.stat().st_size:,} bytes', flush=True)


def create_snapshots(source, output):
    # Import the existing snapshot implementation, preserving its repository/mount checks.
    try:
        from scripts import create_snapshots as snapshots
    except ImportError:
        import create_snapshots as snapshots
    snapshots._setup_logging()
    snapshots._validate_docker_socket()
    container = snapshots._docker_request('GET', f'/containers/{snapshots.CONTAINER_NAME}/json')
    mounts = [mount for mount in container.get('Mounts', []) if mount.get('Destination') == snapshots.SNAPSHOTS_MOUNT]
    if len(mounts) != 1 or mounts[0].get('Type') != 'bind' or Path(mounts[0].get('Source', '')).resolve() != source.resolve():
        raise ValueError('Snapshot directory does not match the local OpenSearch snapshot bind mount; no container was stopped.')
    snapshots._validate_local_dir(source)
    phases = [
        ('Restart local OpenSearch and reset snapshot folder', lambda: snapshots.step1_cycle_container(source)),
        ('Reset snapshot repository', snapshots.step2_delete_repository),
        ('Register snapshot repository', snapshots.step3_create_repository),
        ('Snapshot main index', snapshots.step4_create_snapshot_prod),
        ('Snapshot metadata index', snapshots.step5_create_snapshot_metadata),
        ('Snapshot catalogue index', snapshots.step6_create_snapshot_catalogue),
        ('Verify snapshots', snapshots.step7_verify_snapshots),
        ('Verify snapshot files', lambda: snapshots.step8_verify_files_on_disk(source)),
    ]
    def interrupted(*_):
        raise KeyboardInterrupt('Snapshot job cancelled')
    previous = signal.signal(signal.SIGTERM, interrupted)
    try:
        for index, (label, fn) in enumerate(phases, 1):
            print('@@PROGRESS '+json.dumps({'label': label, 'index': index, 'of': len(phases)+1}), flush=True)
            fn()
        archive_directory(source, output)
    finally:
        signal.signal(signal.SIGTERM, previous)
        # If cancellation/failure interrupted the stop/clear/start cycle, restore availability.
        info = snapshots._docker_request('GET', f'/containers/{snapshots.CONTAINER_NAME}/json')
        if not info.get('State', {}).get('Running'):
            snapshots._docker_request('POST', f'/containers/{snapshots.CONTAINER_NAME}/start')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['archive', 'snapshots'])
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.operation == 'archive':
        archive_directory(args.source, args.output)
    else:
        create_snapshots(args.source.resolve(), args.output)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'Backup failed: {exc}', file=sys.stderr, flush=True)
        sys.exit(1)
