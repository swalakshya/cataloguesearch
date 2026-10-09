"""Local backup pipeline. Retention runs only after verified upload and publication."""
import importlib.util
import re
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from deploy import db, drive, settings
from deploy.runner import Cmd, StepSpec, runner


def dated_folders(entries):
    dates = []
    for entry in entries:
        name = entry.get('Name', '')
        if not entry.get('IsDir') or not re.fullmatch(r'\d{8}', name):
            continue
        try:
            datetime.strptime(name, '%Y%m%d')
        except ValueError:
            continue
        if name in dates:
            raise ValueError(f'Duplicate dated folder {name}; resolve duplicates before retention.')
        dates.append(name)
    return sorted(dates, reverse=True)


def retention_targets(entries, current, keep=2):
    if keep < 1:
        raise ValueError('Keep at least one backup')
    others = [date for date in dated_folders(entries) if date != current]
    return sorted(others[max(0, keep - 1):])


def today():
    return datetime.now(ZoneInfo(settings.BACKUP_TIMEZONE)).strftime('%Y%m%d')


def preflight():
    drive.require_rclone()
    if drive.connection.status()['connection_state'] == 'connecting':
        raise ValueError('Complete Google Drive authorization before submitting a backup.')
    if not drive.connected():
        raise ValueError('Connect Google Drive before submitting a backup.')
    source = settings.BACKUP_SOURCE_DIR.resolve()
    output = settings.BACKUP_OUTPUT_DIR.resolve()
    if not source.is_dir():
        raise ValueError(f'Backup source directory does not exist: {source}')
    if output == source or source in output.parents:
        raise ValueError('Backup output directory must be outside the source directory.')
    if not importlib.util.find_spec('zstandard'):
        raise ValueError('The dev server Python environment needs zstandard installed.')


def status():
    return {**drive.connection.status(), 'source': str(settings.BACKUP_SOURCE_DIR),
            'output_directory': str(settings.BACKUP_OUTPUT_DIR),
            'destination': 'My Drive/snapshots', 'date': today(), 'keep_latest': settings.BACKUP_RETENTION,
            'source_exists': settings.BACKUP_SOURCE_DIR.is_dir()}


def _command_step(name, title, commands):
    def run(ctx):
        db.update_step(ctx.run_id, name, command=' && '.join(cmd.label for cmd in commands))
        for cmd in commands:
            if ctx.cancelled:
                return 1
            code = ctx.run(cmd)
            if code:
                return code
        return 0
    return StepSpec(name, title, run)


def start_backup():
    preflight()
    date = today()
    work = settings.BACKUP_OUTPUT_DIR / f'{date}-{uuid.uuid4().hex[:8]}'
    catalogue = work / f'cataloguesearch_{date}.tar.zst'
    snapshots = work / f'snapshots_{date}.tar.zst'
    base = f'{settings.BACKUP_DRIVE_REMOTE}:{settings.BACKUP_DRIVE_FOLDER}'
    staging = f'{base}/.upload-{work.name}'
    destination = f'{base}/{date}'
    worker = str(settings.REPO_ROOT / 'scripts' / 'backup_archive.py')
    specs = [
        _command_step('archive_catalogue', 'Archive ~/cataloguesearch', [Cmd(
            [settings.SCRIPT_PYTHON, '-u', worker, 'archive', '--source', str(settings.BACKUP_SOURCE_DIR), '--output', str(catalogue)],
            f'Create {catalogue.name}')]),
        _command_step('snapshot_archive', 'Create fresh OpenSearch snapshots and archive', [Cmd(
            [settings.SCRIPT_PYTHON, '-u', worker, 'snapshots', '--source', str(settings.REPO_ROOT / 'snapshots'), '--output', str(snapshots)],
            f'Create fresh snapshots and {snapshots.name}')]),
        _command_step('upload', 'Upload both archives to Google Drive', [Cmd(
            drive.command('copy', work, staging, '--stats', '2s', '--stats-one-line', '--stats-log-level', 'NOTICE', '--retries', '3'),
            f'Upload both archives to My Drive/snapshots/{date} (staging)')]),
        _command_step('verify_upload', 'Verify staged uploads', [Cmd(
            drive.command('check', work, staging, '--one-way'), 'Verify both staged archives using size and checksums')]),
        _command_step('publish', 'Publish the dated backup folder', [Cmd(
            drive.command('moveto', staging, destination, '--retries', '3'), f'Publish My Drive/snapshots/{date}')]),
        _command_step('verify_final', 'Verify published backup', [Cmd(
            drive.command('check', work, destination, '--one-way'), 'Verify both published archives before retention')]),
    ]

    def retention(ctx):
        if ctx.cancelled:
            return 1
        entries = drive.list_folders()
        if date not in dated_folders(entries):
            raise ValueError('New dated backup folder was not found; retention refused.')
        targets = retention_targets(entries, date, settings.BACKUP_RETENTION)
        ctx.log(f'Keeping {date} and the latest {settings.BACKUP_RETENTION - 1} other dated backup(s).')
        for folder in targets:
            if ctx.cancelled:
                return 1
            code = ctx.run(Cmd(drive.command('purge', f'{base}/{folder}', '--drive-use-trash=true'),
                               f'Move oldest dated backup {folder} to Google Drive trash'))
            if code:
                return code
        ctx.summary(f'Uploaded and verified {date}; removed {len(targets)} old dated folder(s).')
        return 0

    # An empty/partial local output set must never pass a one-way remote check.
    upload_step = specs[2]
    def upload(ctx):
        for archive in (catalogue, snapshots):
            if not archive.is_file() or archive.stat().st_size == 0:
                raise ValueError(f'Missing or empty archive: {archive.name}; upload refused.')
        if {path.name for path in work.iterdir()} != {catalogue.name, snapshots.name}:
            raise ValueError('Backup output contains incomplete or unexpected files; upload refused.')
        return upload_step.fn(ctx)
    specs[2] = StepSpec('upload', upload_step.title, upload)
    def validate_drive(ctx):
        if ctx.cancelled:
            return 1
        ctx.log('Checking Google Drive connection and backup folders…')
        entries = drive.list_folders()
        dates = dated_folders(entries)
        ctx.log(f'Google Drive ready; found {len(dates)} dated backup folder(s).')
        return 0

    specs.insert(0, StepSpec('validate_drive', 'Check Google Drive connection and backup folders', validate_drive))
    specs.append(StepSpec('retention', f'Keep latest {settings.BACKUP_RETENTION} dated backups', retention))
    return runner.start('backup', f'Backup → Google Drive ({date})', specs,
                        {'date': date, 'source': str(settings.BACKUP_SOURCE_DIR), 'output_directory': str(work),
                         'destination': f'My Drive/snapshots/{date}', 'keep_latest': settings.BACKUP_RETENTION})
