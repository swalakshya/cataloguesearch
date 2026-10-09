"""Backups never contact Drive, restart OpenSearch, or delete user data in tests."""
from pathlib import Path
from unittest.mock import Mock
import pytest
from deploy import backups, drive, settings


def test_retention_keeps_current_and_latest_other_date():
    entries = [{'Name': n, 'IsDir': True} for n in ['20260919', '20260925', '20261009', 'notes', '20260230']]
    entries.append({'Name': '20260101', 'IsDir': False})
    assert backups.retention_targets(entries, '20261009', 2) == ['20260919']


def test_duplicate_dated_directories_are_not_deleted():
    with pytest.raises(ValueError, match='Duplicate'):
        backups.retention_targets([{'Name': '20260919', 'IsDir': True}] * 2, '20261009', 2)


def test_retention_never_removes_new_backup_even_if_future_folder_exists():
    entries = [{'Name': n, 'IsDir': True} for n in ['20260925', '20261009', '20271009']]
    assert backups.retention_targets(entries, '20261009', 2) == ['20260925']


def test_backup_stops_before_publish_and_cleanup_if_verification_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'BACKUP_OUTPUT_DIR', tmp_path)
    monkeypatch.setattr(drive, 'command', lambda *args: ['rclone', *map(str, args)])
    monkeypatch.setattr(backups.db, 'update_step', Mock())
    start = Mock(return_value='run')
    monkeypatch.setattr(backups.runner, 'start', start)
    monkeypatch.setattr(backups, 'preflight', lambda: None)
    backups.start_backup()
    specs = start.call_args.args[2]
    assert [s.name for s in specs] == ['validate_drive', 'archive_catalogue', 'snapshot_archive', 'upload', 'verify_upload', 'publish', 'verify_final', 'retention']
    ctx = Mock(run_id='run', cancelled=False)
    ctx.run.return_value = 1
    assert specs[4].fn(ctx) == 1
    assert ctx.run.call_args.args[0].argv[1] == 'check'
    assert '--one-way' in ctx.run.call_args.args[0].argv


def test_missing_rclone_blocks_connect_and_backup(monkeypatch):
    monkeypatch.setattr(drive.shutil, 'which', lambda _: None)
    assert drive.capabilities()['rclone_available'] is False
    with pytest.raises(ValueError, match='rclone'):
        drive.require_rclone()
    with pytest.raises(ValueError, match='rclone'):
        backups.preflight()


def test_authorization_url_and_token_are_separated():
    url = 'http://127.0.0.1:53682/auth?state=test'
    assert drive.authorization_url('Go to '+url) == url
    assert drive.authorization_url('Go to https://evil.example/auth') is None
    assert drive.extract_token('Paste token:\n{"access_token":"secret","refresh_token":"refresh"}\nEnd')['access_token'] == 'secret'


def test_output_directory_cannot_be_inside_source(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, 'require_rclone', lambda: 'rclone')
    monkeypatch.setattr(drive, 'connected', lambda: True)
    monkeypatch.setattr(settings, 'BACKUP_SOURCE_DIR', tmp_path)
    monkeypatch.setattr(settings, 'BACKUP_OUTPUT_DIR', tmp_path/'backups')
    with pytest.raises(ValueError, match='outside'):
        backups.preflight()


def test_drive_configuration_written_privately_without_returning_tokens(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'BACKUP_RCLONE_CONFIG', tmp_path/'private'/'rclone.conf')
    drive.save_token({'access_token': 'secret', 'refresh_token': 'refresh'})
    assert drive.connected()
    assert (settings.BACKUP_RCLONE_CONFIG.stat().st_mode & 0o777) == 0o600
    assert 'secret' not in str(drive.capabilities())


def test_archive_contains_consistent_sqlite_and_regular_files(tmp_path):
    import sqlite3
    import tarfile
    import zstandard
    from scripts.backup_archive import archive_directory
    source = tmp_path/'cataloguesearch'
    source.mkdir()
    (source/'notes.txt').write_text('backup content')
    database = sqlite3.connect(source/'sessions.db')
    database.execute('PRAGMA journal_mode=WAL')
    database.execute('CREATE TABLE messages (content TEXT)')
    database.execute('INSERT INTO messages VALUES (?)', ('committed WAL message',))
    database.commit()
    output = tmp_path/'archives'/'cataloguesearch_20261009.tar.zst'
    try:
        archive_directory(source, output)
        with output.open('rb') as raw, zstandard.ZstdDecompressor().stream_reader(raw) as expanded:
            with tarfile.open(fileobj=expanded, mode='r|') as archive:
                members = {}
                for member in archive:
                    if member.isfile():
                        members[member.name] = archive.extractfile(member).read()
        assert members['cataloguesearch/notes.txt'] == b'backup content'
        assert 'cataloguesearch/sessions.db-wal' not in members
        restored = tmp_path/'restored.db'
        restored.write_bytes(members['cataloguesearch/sessions.db'])
        with sqlite3.connect(restored) as db:
            assert db.execute('SELECT content FROM messages').fetchone()[0] == 'committed WAL message'
        assert not output.with_name(output.name+'.partial').exists()
    finally:
        database.close()


def test_missing_rclone_api_rejects_jobs_and_connection(monkeypatch):
    import asyncio
    from deploy import api
    from fastapi import HTTPException
    monkeypatch.setattr(drive.shutil, 'which', lambda _: None)
    monkeypatch.setattr(api.runner, 'active_run_id', lambda: None)
    for endpoint in (api.connect_backup_drive, api.start_backup_run):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(endpoint())
        assert exc.value.status_code == 503
        assert 'rclone' in exc.value.detail


def test_failed_verification_skips_publish_and_retention(jobs_env, monkeypatch, tmp_path):
    from conftest import wait_done
    monkeypatch.setattr(settings, 'BACKUP_OUTPUT_DIR', tmp_path)
    monkeypatch.setattr(backups, 'preflight', lambda: None)
    monkeypatch.setattr(drive, 'command', lambda *args: ['rclone', *map(str, args)])
    monkeypatch.setattr(drive, 'list_folders', lambda: [])
    executed = []
    def run_cmd(self, run, step, cmd, out):
        executed.append(step)
        if step in ('archive_catalogue', 'snapshot_archive'):
            output = Path(cmd.argv[-1])
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(b'fake archive')
        return 1 if step == 'verify_upload' else 0
    monkeypatch.setattr(type(jobs_env.runner), '_run_cmd', run_cmd)
    run = wait_done(backups.start_backup())
    assert run['status'] == 'failed'
    assert executed == ['archive_catalogue', 'snapshot_archive', 'upload', 'verify_upload']
    assert all(s['status'] == 'skipped' for s in run['steps'][5:])


def test_ambiguous_drive_destination_is_rejected(monkeypatch):
    monkeypatch.setattr(drive, 'connected', lambda: True)
    monkeypatch.setattr(drive, '_list', lambda _: [{'Name': 'snapshots', 'IsDir': True}] * 2)
    with pytest.raises(ValueError, match='More than one snapshots'):
        drive.list_folders()


def test_retention_only_trashes_old_dated_folder_after_verified_new_backup(monkeypatch, tmp_path):
    monkeypatch.setattr(backups, 'preflight', lambda: None)
    monkeypatch.setattr(backups, 'today', lambda: '20261009')
    monkeypatch.setattr(settings, 'BACKUP_OUTPUT_DIR', tmp_path)
    monkeypatch.setattr(drive, 'command', lambda *args: ['rclone', *map(str, args)])
    monkeypatch.setattr(drive, 'list_folders', lambda: [{'Name': n, 'IsDir': True} for n in ['20260919', '20260925', '20261009', 'notes']])
    start = Mock()
    monkeypatch.setattr(backups.runner, 'start', start)
    backups.start_backup()
    ctx = Mock(cancelled=False)
    ctx.run.return_value = 0
    assert start.call_args.args[2][-1].fn(ctx) == 0
    argv = ctx.run.call_args.args[0].argv
    assert argv == ['rclone', 'purge', 'cataloguesearch_backup:snapshots/20260919', '--drive-use-trash=true']


def test_snapshot_mount_mismatch_never_stops_container(tmp_path, monkeypatch):
    from scripts import backup_archive, create_snapshots
    monkeypatch.setattr(create_snapshots, '_setup_logging', Mock())
    monkeypatch.setattr(create_snapshots, '_validate_docker_socket', Mock())
    docker = Mock(return_value={'Mounts': [{'Destination': '/tmp/snapshots', 'Source': str(tmp_path/'elsewhere'), 'Type': 'bind'}]})
    monkeypatch.setattr(create_snapshots, '_docker_request', docker)
    with pytest.raises(ValueError, match='mount'):
        backup_archive.create_snapshots(tmp_path/'snapshots', tmp_path/'snapshots.tar.zst')
    assert all(call.args[0] == 'GET' for call in docker.call_args_list)


def test_oauth_success_saves_token_but_status_exposes_only_connection_metadata(monkeypatch, tmp_path):
    import io
    monkeypatch.setattr(settings, 'BACKUP_RCLONE_CONFIG', tmp_path/'oauth'/'rclone.conf')
    monkeypatch.setattr(drive, 'require_rclone', lambda: '/usr/bin/rclone')
    proc = Mock()
    proc.stdout = io.StringIO('Go to http://127.0.0.1:53682/auth?state=test\n{"access_token":"secret","refresh_token":"refresh"}\n')
    proc.wait.return_value = 0
    proc.poll.return_value = 0
    launch = Mock(return_value=proc)
    monkeypatch.setattr(drive.subprocess, 'Popen', launch)
    manager = drive.DriveConnection()
    manager.generation = 1
    manager.state = 'connecting'
    manager._authorize(1)
    status = manager.status()
    assert status['connected']
    assert status['connection_state'] == 'connected'
    assert status['auth_url'] is None
    assert 'secret' not in str(status)
    assert launch.call_args.args[0][1:3] == ['authorize', 'drive']


def test_oauth_failure_does_not_expose_process_output(monkeypatch):
    import io
    monkeypatch.setattr(drive, 'require_rclone', lambda: '/usr/bin/rclone')
    proc = Mock(stdout=io.StringIO('sensitive failure text token=secret\n'))
    proc.wait.return_value = 1
    proc.poll.return_value = 1
    monkeypatch.setattr(drive.subprocess, 'Popen', lambda *args, **kwargs: proc)
    manager = drive.DriveConnection()
    manager.generation = 1
    manager._authorize(1)
    assert manager.status()['connection_state'] == 'error'
    assert 'secret' not in str(manager.status())


def test_missing_second_archive_blocks_upload(monkeypatch, tmp_path):
    monkeypatch.setattr(backups, 'preflight', lambda: None)
    monkeypatch.setattr(settings, 'BACKUP_OUTPUT_DIR', tmp_path)
    monkeypatch.setattr(drive, 'command', lambda *args: ['rclone', *map(str, args)])
    start = Mock()
    monkeypatch.setattr(backups.runner, 'start', start)
    backups.start_backup()
    ctx = Mock(cancelled=False)
    with pytest.raises(ValueError, match='Missing or empty'):
        start.call_args.args[2][3].fn(ctx)
    ctx.run.assert_not_called()


def test_cancellation_during_snapshot_cycle_restarts_stopped_container(tmp_path, monkeypatch):
    from scripts import backup_archive, create_snapshots
    source = tmp_path/'snapshots'
    monkeypatch.setattr(create_snapshots, '_setup_logging', Mock())
    monkeypatch.setattr(create_snapshots, '_validate_docker_socket', Mock())
    monkeypatch.setattr(create_snapshots, '_validate_local_dir', Mock())
    docker = Mock(side_effect=[{'Mounts': [{'Destination': '/tmp/snapshots', 'Source': str(source), 'Type': 'bind'}]}, {'State': {'Running': False}}, {}])
    monkeypatch.setattr(create_snapshots, '_docker_request', docker)
    monkeypatch.setattr(create_snapshots, 'step1_cycle_container', Mock(side_effect=KeyboardInterrupt))
    with pytest.raises(KeyboardInterrupt):
        backup_archive.create_snapshots(source, tmp_path/'snapshots.tar.zst')
    assert docker.call_args.args == ('POST', '/containers/opensearch-node/start')


def test_drive_check_failure_stops_before_archiving(jobs_env, monkeypatch):
    from conftest import wait_done
    monkeypatch.setattr(backups, 'preflight', lambda: None)
    monkeypatch.setattr(drive, 'command', lambda *args: ['rclone', *map(str, args)])
    monkeypatch.setattr(drive, 'list_folders', Mock(side_effect=ValueError('Drive unreachable')))
    commands = Mock()
    monkeypatch.setattr(type(jobs_env.runner), '_run_cmd', commands)
    run = wait_done(backups.start_backup())
    assert run['status'] == 'failed'
    assert run['steps'][0]['name'] == 'validate_drive'
    assert run['steps'][0]['status'] == 'failed'
    assert all(step['status'] == 'skipped' for step in run['steps'][1:])
    commands.assert_not_called()


def test_start_endpoint_returns_job_without_waiting_for_drive_listing(monkeypatch):
    import asyncio
    from deploy import api
    monkeypatch.setattr(backups, 'preflight', lambda: None)
    monkeypatch.setattr(api, '_require_docker', lambda: None)
    listing = Mock(side_effect=AssertionError('Drive listing belongs inside the tracked job'))
    monkeypatch.setattr(drive, 'list_folders', listing)
    monkeypatch.setattr(backups, 'start_backup', lambda: 'tracked-run')
    assert asyncio.run(api.start_backup_run()) == {'run_id': 'tracked-run'}
    listing.assert_not_called()
