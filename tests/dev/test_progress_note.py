import json

from backend.crawler import progress_note
from deploy import progress


def test_silent_unless_the_runner_asks(monkeypatch, capsys):
    monkeypatch.delenv("EMIT_PROGRESS_NOTES", raising=False)
    progress_note.emit_progress_note("File 1/1: a.pdf")
    assert capsys.readouterr().out == ""


def test_emits_a_marker_the_runner_can_parse(monkeypatch, capsys):
    monkeypatch.setenv("EMIT_PROGRESS_NOTES", "1")
    progress_note.emit_progress_note("File 1/2: ratnakarand.pdf · sub-section 3/5: ગ્યાન")
    line = capsys.readouterr().out.strip()
    assert progress.parse_marker(line) == {"note": "File 1/2: ratnakarand.pdf · sub-section 3/5: ગ્યાન"}
    assert json.loads(line[len(progress.MARKER):])["note"].startswith("File 1/2")
