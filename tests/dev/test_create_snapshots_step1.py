"""step1 of create_snapshots.py: keep the bind-mounted snapshots dir, and report a crashed OpenSearch clearly."""
import struct

import pytest

from tests.dev.test_progress import load_script

CRASH_LOG = """\
Waiting for OpenSearch to be ready...
[2026-09-20T15:12:24,550][ERROR][o.o.b.OpenSearchUncaughtExceptionHandler] [opensearch-node] uncaught exception in thread [main]
org.opensearch.bootstrap.StartupException: java.lang.IllegalStateException: Unable to access 'path.repo' (/tmp/snapshots)
Caused by: java.nio.file.NotDirectoryException: /tmp/snapshots
Still waiting for OpenSearch...
Still waiting for OpenSearch...
"""


@pytest.fixture(scope="module")
def cs():
    return load_script("create_snapshots")


def test_empty_dir_keeps_the_directory_itself(cs, tmp_path):
    d = tmp_path / "snapshots"
    (d / "sub").mkdir(parents=True)
    (d / "sub" / "f").write_text("x")
    (d / "index-0").write_text("y")
    (d / "link").symlink_to(d / "index-0")
    inode = d.stat().st_ino

    cs._empty_dir(d)

    assert d.is_dir() and list(d.iterdir()) == []
    assert d.stat().st_ino == inode          # same directory, so the container's bind mount stays valid


def test_empty_dir_creates_it_when_missing(cs, tmp_path):
    cs._empty_dir(tmp_path / "a" / "snapshots")
    assert (tmp_path / "a" / "snapshots").is_dir()


def test_startup_crash_reports_the_cause(cs):
    msg = cs._startup_crash(CRASH_LOG)
    assert "uncaught exception" in msg and "/tmp/snapshots" in msg


def test_startup_crash_is_none_while_merely_waiting(cs):
    assert cs._startup_crash("Waiting for OpenSearch to be ready...\nStill waiting for OpenSearch...\n") is None
    assert cs._startup_crash("") is None


def _frame(stream, text):
    payload = text.encode()
    return bytes([stream, 0, 0, 0]) + struct.pack(">I", len(payload)) + payload


def _fake_conn(monkeypatch, cs, body):
    class Resp:
        def read(self):
            return body

    class Conn:
        def __init__(self, *_):
            pass

        def request(self, *a, **k):
            pass

        def getresponse(self):
            return Resp()

        def close(self):
            pass

    monkeypatch.setattr(cs, "_UnixSocketHTTPConnection", Conn)


def test_docker_logs_demultiplexes_frames(cs, monkeypatch):
    _fake_conn(monkeypatch, cs, _frame(1, "line one\n") + _frame(2, "line two\n"))
    assert cs._docker_logs(0) == "line one\nline two\n"


def test_docker_logs_passes_through_plain_text_and_never_raises(cs, monkeypatch):
    _fake_conn(monkeypatch, cs, b"plain tty output\n")
    assert cs._docker_logs(0) == "plain tty output\n"

    class Boom:
        def __init__(self, *_):
            raise OSError("no socket")

    monkeypatch.setattr(cs, "_UnixSocketHTTPConnection", Boom)
    assert cs._docker_logs(0) == ""
