"""Restore modes must keep container lifecycle operations out of data-only runs."""
import pytest

from test_progress import load_script


@pytest.mark.parametrize("args", [[], ["--mode", "data-only"]])
def test_data_only_never_pulls_or_restarts(monkeypatch, args):
    rs = load_script("restore_snapshots")
    calls = []
    for name in ("_setup_logging", "_validate_snapshots_dir", "_validate_docker_socket"):
        monkeypatch.setattr(rs, name, lambda: None)
    for name in ("step0_pull_images", "step1_restart_container", "step9_restart_services"):
        def forbidden():
            pytest.fail("Data-only mode invoked a container lifecycle operation")
        monkeypatch.setattr(rs, name, forbidden)
    for name in ("_validate_running_opensearch", "step2_fix_permissions", "step3_delete_repository",
                 "step4_create_repository", "step5_verify_snapshots", "step6_delete_indices",
                 "step7_restore_snapshots", "step8_wait_for_restore"):
        monkeypatch.setattr(rs, name, lambda _name=name: calls.append(_name))
    monkeypatch.setattr("sys.argv", ["restore_snapshots.py", "--yes", *args])
    rs.main()
    assert calls[0] == "_validate_running_opensearch"
    assert calls.index("step5_verify_snapshots") < calls.index("step6_delete_indices")
    assert calls[-1] == "step8_wait_for_restore"
    assert rs.PHASE_TOTAL == 8


@pytest.mark.parametrize("answers,expected", [([""], "data-only"), (["2"], "full-cycle"),
                                              (["invalid", "1"], "data-only")])
def test_interactive_mode_selection(monkeypatch, capsys, answers, expected):
    rs = load_script("restore_snapshots")
    answers = iter(answers)
    monkeypatch.setattr("builtins.input", lambda _: next(answers))
    assert rs._select_mode(None, False) == expected
    output = capsys.readouterr().out
    assert "No image pulls" in output and "restart OpenSearch" in output


@pytest.mark.parametrize("running,mount_source,http_status", [
    (False, "/tmp/snapshots", 200), (True, "/wrong", 200), (True, "/tmp/snapshots", 503),
])
def test_data_only_preflight_rejects_unusable_container(monkeypatch, running, mount_source, http_status):
    rs = load_script("restore_snapshots")
    rs.SNAPSHOTS_DIR = rs.Path("/tmp/snapshots")
    monkeypatch.setattr(rs, "_docker_request", lambda *a: {
        "State": {"Status": "running" if running else "exited"},
        "Mounts": [{"Type": "bind", "Source": mount_source, "Destination": "/tmp/snapshots"}],
    })
    monkeypatch.setattr(rs, "_os_request", lambda *a: (http_status, {}))
    with pytest.raises(RuntimeError):
        rs._validate_running_opensearch()
