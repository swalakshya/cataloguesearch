import json
import sys
from unittest.mock import Mock

import pytest

from deploy import log_stream as logs


def test_file_cursor_appends_repeated_lines_exactly_once(tmp_path):
    path = tmp_path / 'service.log'
    path.write_text('repeat\n')
    first = logs.file_feed(path)
    with path.open('a') as stream:
        stream.write('repeat\nmore\n')
    second = logs.file_feed(path, first['cursor'])
    assert second['text'] == 'repeat\nmore\n'
    assert logs.file_feed(path, second['cursor'])['text'] == ''


def test_rotation_drains_unread_backup_then_current_file(tmp_path):
    path = tmp_path / 'service.log'
    path.write_text('before\n')
    first = logs.file_feed(path)
    with path.open('a') as stream:
        stream.write('unread\n')
    path.rename(tmp_path / 'service.log.1')
    path.write_text('after\n')
    result = logs.file_feed(path, first['cursor'])
    assert result['text'] == 'unread\nafter\n'
    assert not result['truncated']


def test_rewrite_same_inode_is_detected_even_when_file_grows(tmp_path):
    path = tmp_path / 'service.log'
    path.write_text('old\n')
    first = logs.file_feed(path)
    path.write_text('new and longer\n')
    result = logs.file_feed(path, first['cursor'])
    assert 'new and longer' in result['text']
    assert result['truncated']


def test_partial_utf8_is_resumed_without_replacement(tmp_path):
    path = tmp_path / 'service.log'
    path.write_bytes(b'start \xe2')
    first = logs.file_feed(path)
    assert first['text'] == 'start '
    with path.open('ab') as stream:
        stream.write(b'\x82\xac\n')
    assert logs.file_feed(path, first['cursor'])['text'] == '€\n'


def test_file_response_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(logs, 'MAX_BYTES', 32)
    path = tmp_path / 'service.log'
    path.write_text('record\n' * 100)
    result = logs.file_feed(path)
    assert len(result['text'].encode()) <= 32
    assert result['truncated']


def test_docker_timestamp_boundary_preserves_identical_new_entries(monkeypatch):
    monkeypatch.setattr(logs.subprocess, 'run', Mock(return_value=Mock(returncode=0, stdout='container-id')))
    stamp = '2026-10-14T12:00:00.000000001Z'
    line = stamp + ' repeat\n'
    command = Mock(side_effect=[(line * 2, False), (line * 3, False), (line * 3, False)])
    monkeypatch.setattr(logs, '_bounded_command', command)
    first = logs.docker_feed('container')
    second = logs.docker_feed('container', first['cursor'])
    third = logs.docker_feed('container', second['cursor'])
    assert second['text'] == line
    assert third['text'] == ''
    assert '--since' in command.call_args.args[0]
    assert '--tail' not in command.call_args.args[0]


def test_container_replacement_starts_new_cursor(monkeypatch):
    monkeypatch.setattr(logs.subprocess, 'run', Mock(side_effect=[Mock(returncode=0, stdout='old'), Mock(returncode=0, stdout='new')]))
    monkeypatch.setattr(logs, '_bounded_command', lambda *_: ('2026-10-14T12:00:00.000000001Z output\n', False))
    first = logs.docker_feed('container')
    second = logs.docker_feed('container', first['cursor'])
    assert second['reset']
    assert logs.decode_cursor(second['cursor'])['container'] == 'new'


def test_command_stream_is_bounded_and_errors_are_preserved(monkeypatch):
    monkeypatch.setattr(logs, 'MAX_BYTES', 64)
    text, truncated = logs._bounded_command([sys.executable, '-c', 'print("record\\n" * 100)'])
    assert truncated
    assert len(text.encode()) <= 64
    assert 'record' in text
    with pytest.raises(RuntimeError, match='actual failure'):
        logs._bounded_command([sys.executable, '-c', 'import sys; print("actual failure", file=sys.stderr); sys.exit(1)'])


def test_malformed_cursor_cannot_select_a_file(tmp_path):
    path = tmp_path / 'service.log'
    path.write_text('content')
    with pytest.raises(ValueError, match='cursor'):
        logs.file_feed(path, '../../private-file')
