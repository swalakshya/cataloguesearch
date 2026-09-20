import contextlib
import importlib.util
import io
import json
from pathlib import Path

from deploy import progress

ROOT = Path(__file__).resolve().parents[2]


def markers(out):
    return [json.loads(l[len(progress.MARKER):]) for l in out.splitlines() if l.startswith(progress.MARKER)]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_parse_bar_reads_pv_and_tqdm_lines():
    pv = progress.parse_bar(" 1.20GiB 0:00:21 [58.3MiB/s] [=====>          ] 40% ETA 0:00:32")
    assert pv["pct"] == 40.0 and pv["eta"] == "0:00:32"
    tq = progress.parse_bar("LLM Pages:  37%|███▋      | 111/300 [00:20<00:35,  5.5it/s]")
    assert tq["pct"] == 37.0 and tq["eta"] == "00:35"


def test_parse_bar_ignores_non_progress_text():
    assert progress.parse_bar("no percent here") is None
    assert progress.parse_bar("CPU is at 250% today") is None


def test_parse_marker():
    assert progress.parse_marker('@@PROGRESS {"label": "Verify", "index": 7, "of": 11}') == {"label": "Verify", "index": 7, "of": 11}
    assert progress.parse_marker("@@PROGRESS not json") is None
    assert progress.parse_marker("just a log line") is None


def test_docker_build_progress_counts_steps_then_pushing():
    d = progress.DockerBuildProgress()
    assert d.feed("#5 [svc internal] load metadata for docker.io/library/nginx:alpine") is None
    assert d.feed("#12 [cataloguesearch-api builder 3/7] RUN pip install x")["phase"] == {
        "label": "Building cataloguesearch-api", "done": 3, "total": 7, "unit": "build steps"}
    assert d.feed("#14 [cataloguesearch-api builder 6/7] RUN y")["phase"]["done"] == 6
    two_stage = d.feed("#20 [cataloguesearch-api stage-1 2/3] COPY --from=builder /app /app")["phase"]
    assert (two_stage["done"], two_stage["total"]) == (8, 10)
    pushing = d.feed("#25 exporting to image")["phase"]
    assert pushing["label"].startswith("Exporting") and pushing["done"] == pushing["total"] == 10


def test_create_snapshots_emits_one_marker_per_phase_and_builds_manifest_before_streaming(monkeypatch):
    cs = load_script("create_snapshots")
    calls = []
    for n in ("_validate_pv", "_validate_docker_socket", "_setup_logging"):
        monkeypatch.setattr(cs, n, lambda *a, **k: None)
    monkeypatch.setattr(cs, "_validate_local_dir", lambda d: None)
    monkeypatch.setattr(cs, "_parse_args", lambda: (Path("/tmp/snapshots_x"), "prod-host", None, ".", True))
    for n in ("step1_cycle_container", "step2_delete_repository", "step3_create_repository", "step4_create_snapshot_prod",
              "step5_create_snapshot_metadata", "step6_create_snapshot_catalogue", "step7_verify_snapshots",
              "step8_verify_files_on_disk"):
        monkeypatch.setattr(cs, n, lambda *a, _n=n, **k: calls.append(_n))
    monkeypatch.setattr(cs, "step9_create_tarball", lambda d: (calls.append("tar"), Path("/tmp/x.tar.zst"))[1])
    monkeypatch.setattr(cs, "_generate_manifest", lambda d: (calls.append("manifest"), {"a": "1"})[1])
    monkeypatch.setattr(cs, "step10_stream_to_remote", lambda *a: calls.append("stream"))
    monkeypatch.setattr(cs, "step11_verify_checksums", lambda m, *a: calls.append(("verify", m)))

    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        cs.main()
    m = markers(out.getvalue())
    assert [x["index"] for x in m] == list(range(1, 12)) and all(x["of"] == 11 for x in m)
    assert calls.index("manifest") < calls.index("stream")      # hashes are taken before the transfer...
    assert ("verify", {"a": "1"}) in calls                       # ...and checked against it afterwards
    assert "Tarball          : /tmp/x.tar.zst" in out.getvalue()

    calls.clear()
    monkeypatch.setattr(cs, "_parse_args", lambda: (Path("/tmp/snapshots_x"), None, None, ".", True))
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        cs.main()
    assert len(markers(out.getvalue())) == 9 and "stream" not in calls and "manifest" not in calls


def test_restore_snapshots_markers_and_real_recovery_percentage(monkeypatch):
    rs = load_script("restore_snapshots")
    for n in dir(rs):
        if n.startswith("step") and n[4].isdigit():
            monkeypatch.setattr(rs, n, lambda *a, **k: None)
    for n in ("_validate_snapshots_dir", "_validate_docker_socket", "_setup_logging"):
        monkeypatch.setattr(rs, n, lambda *a, **k: None)
    monkeypatch.setattr(rs, "_resolve_snapshots_dir", lambda x: Path("/tmp/s"))
    monkeypatch.setattr("sys.argv", ["restore_snapshots.py", "--yes"])
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        rs.main()
    m = markers(out.getvalue())
    assert [x["index"] for x in m] == list(range(1, 11)) and m[0]["label"] == "Pull latest images"

    monkeypatch.setattr(rs, "PHASE_INDEX", 9)
    monkeypatch.setattr(rs, "PHASE_TOTAL", 10)
    monkeypatch.setattr(rs, "_os_request", lambda *a, **k: (200, [
        {"index": "a", "stage": "index", "bytes_percent": "40.0%"}, {"index": "b", "stage": "done", "bytes_percent": "100.0%"}]))
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        rs._report_restore_progress()
    (marker,) = markers(out.getvalue())
    assert marker["sub"]["pct"] == 70.0 and marker["index"] == 9
