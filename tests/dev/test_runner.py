import os
import signal
import subprocess
import time

from deploy import db, runner as r
from deploy.progress import DockerBuildProgress
from tests.dev.conftest import wait_done


def sh(script, **kw):
    return r.Cmd(["sh", "-c", script], "test", **kw)


def step(name, fn, **kw):
    return r.StepSpec(name, name.title(), fn, **kw)


def test_all_steps_succeed(jobs_env):
    rid = jobs_env.runner.start("deploy", "t", [step("a", lambda c: c.run(sh("echo hi"))), step("b", lambda c: 0)], {})
    run = wait_done(rid)
    assert run["status"] == "succeeded" and [s["status"] for s in run["steps"]] == ["succeeded"] * 2
    assert run["kind"] == "deploy" and run["steps"][0]["title"] == "A"


def test_failure_skips_later_steps(jobs_env):
    rid = jobs_env.runner.start("deploy", "t", [step("a", lambda c: c.run(sh("exit 3"))), step("b", lambda c: 0)], {})
    run = wait_done(rid)
    assert run["status"] == "failed"
    assert [s["status"] for s in run["steps"]] == ["failed", "skipped"] and run["steps"][0]["exit_code"] == 3


def test_continue_on_fail_runs_the_next_step_but_run_still_fails(jobs_env):
    rid = jobs_env.runner.start("discover", "t", [step("a", lambda c: 1, continue_on_fail=True), step("b", lambda c: 0)], {})
    run = wait_done(rid)
    assert run["status"] == "failed" and [s["status"] for s in run["steps"]] == ["failed", "succeeded"]


def test_waiting_outcome_does_not_stop_the_run_or_count_as_failure(jobs_env):
    def waiting(c):
        c.summary("2 folders still waiting")
        return r.EXIT_WAITING
    rid = jobs_env.runner.start("discover", "t", [step("a", waiting), step("b", lambda c: 0)], {})
    run = wait_done(rid)
    assert run["status"] == "waiting" and [s["status"] for s in run["steps"]] == ["waiting", "succeeded"]
    assert run["steps"][0]["detail"] == "2 folders still waiting"


def test_only_one_job_at_a_time_and_cancel(jobs_env):
    rid = jobs_env.runner.start("deploy", "t", [step("a", lambda c: c.run(sh("sleep 60"))), step("b", lambda c: 0)], {})
    time.sleep(1)
    try:
        jobs_env.runner.start("discover", "t2", [step("x", lambda c: 0)], {})
        raise AssertionError("expected Busy")
    except r.Busy:
        pass
    t = time.time()
    assert jobs_env.runner.cancel(rid)
    run = wait_done(rid)
    assert run["status"] == "cancelled" and [s["status"] for s in run["steps"]] == ["cancelled", "skipped"]
    assert time.time() - t < 6


def test_cancel_interrupts_a_python_step_sleeping(jobs_env):
    rid = jobs_env.runner.start("discover", "t", [step("w", lambda c: 0 if c.sleep(60) else 130)], {})
    time.sleep(0.5)
    jobs_env.runner.cancel(rid)
    assert wait_done(rid, 5)["status"] == "cancelled"


def test_a_crashing_step_fails_but_does_not_take_the_runner_down(jobs_env):
    def boom(c):
        raise RuntimeError("bug")
    run = wait_done(jobs_env.runner.start("deploy", "t", [step("a", boom)], {}))
    assert run["status"] == "failed"
    assert "RuntimeError: bug" in open(r.log_path(run["id"], "a")).read()
    assert jobs_env.runner.active_run_id() is None


def test_markers_and_bars_become_progress_and_stay_out_of_the_log(jobs_env):
    script = (r"""printf '@@PROGRESS {"label":"Stream","index":9,"of":11}\n'; """
              r"""printf ' 1.2GiB 0:00:21 [58MiB/s] [==>  ] 40%% ETA 0:00:32\r'; sleep 0.7; echo 'plain line'; """
              r"""printf '@@PROGRESS {"label":"Verify","index":10,"of":11}\n'""")
    seen = []
    rid = jobs_env.runner.start("deploy", "t", [step("s", lambda c: c.run(sh(script)))], {})
    while db.get_run(rid)["status"] == "running":
        p = db.get_run(rid)["steps"][0]["progress"]
        if p and p not in seen:
            seen.append(p)
        time.sleep(0.05)
    run = wait_done(rid)
    assert run["steps"][0]["progress"]["phase"]["label"] == "Verify"
    assert any((p["sub"] or {}).get("pct") == 40.0 and p["sub"]["eta"] == "0:00:32" for p in seen)
    logged = [l for l in open(r.log_path(rid, "s")).read().splitlines() if not l.startswith("$ ")]
    assert "plain line" in logged and not any("@@PROGRESS" in l for l in logged)


def test_note_marker_keeps_the_folder_phase_and_is_cleared_by_the_next_phase(jobs_env):
    script = r"""printf '@@PROGRESS {"note":"File 2/3: a.pdf · sub-section 4/5: Gyan"}\n'"""

    def fn(c):
        c.progress("Granth/x", done=0, total=1, unit="folders")
        code = c.run(sh(script))
        seen.append(dict(db.get_run(c.run_id)["steps"][0]["progress"]["phase"]))
        c.progress("Granth/y", done=1, total=2, unit="folders")
        seen.append(dict(db.get_run(c.run_id)["steps"][0]["progress"]["phase"]))
        return code

    seen = []
    run = wait_done(jobs_env.runner.start("deploy", "t", [step("n", fn)], {}))
    assert run["status"] == "succeeded"
    assert seen[0] == {"label": "Granth/x", "done": 0, "total": 1, "unit": "folders",
                       "note": "File 2/3: a.pdf · sub-section 4/5: Gyan"}
    assert "note" not in seen[1] and seen[1]["label"] == "Granth/y"
    logged = [l for l in open(r.log_path(run["id"], "n")).read().splitlines() if not l.startswith("$ ")]
    assert not any("@@PROGRESS" in l for l in logged)


def test_docker_parser_and_ctx_progress(jobs_env):
    docker = "echo '#12 [api builder 3/7] RUN x'; echo '#14 [api builder 6/7] RUN y'; echo '#25 exporting to image'"
    run = wait_done(jobs_env.runner.start("deploy", "t", [step("b", lambda c: c.run(sh(docker, progress_parser=DockerBuildProgress())))], {}))
    phase = run["steps"][0]["progress"]["phase"]
    assert phase["label"].startswith("Exporting") and phase["total"] == 7

    def folders(c):
        for i in range(3):
            c.progress("Folder x", done=i, total=3, unit="folders")
        return 0
    run = wait_done(jobs_env.runner.start("discover", "t", [step("o", folders)], {}))
    assert run["steps"][0]["progress"]["phase"] == {"label": "Folder x", "done": 2, "total": 3, "unit": "folders"}


def test_typical_duration_needs_two_samples(jobs_env):
    for _ in range(2):
        rid = jobs_env.runner.start("deploy", "h", [step("hist", lambda c: (time.sleep(1.1), 0)[1])], {})
        wait_done(rid)
        assert db.get_run(rid)["steps"][0]["typical_seconds"] is None or _ == 1
    assert db.get_run(rid)["steps"][0]["typical_seconds"] in (1, 2)


def test_leftover_process_from_a_dead_server_is_killed_at_startup(jobs_env):
    """Steps run in their own session and outlive the server; the next startup must reap them, not leave them running."""
    proc = subprocess.Popen(["sh", "-c", "sleep 300 # reap-test"], start_new_session=True)
    try:
        db.create_run("orphan1", "deploy", "t", [("a", "A")], {})
        db.update_step("orphan1", "a", status="running", pgid=proc.pid, pstart=r._proc_start(proc.pid))
        r.startup()                                  # what a restarted server does
        proc.wait(timeout=10)
        assert proc.returncode == -signal.SIGTERM
        run = db.get_run("orphan1")
        assert run["status"] == "interrupted" and run["steps"][0]["status"] == "cancelled"
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL)


def test_a_reused_pid_is_never_killed(jobs_env):
    proc = subprocess.Popen(["sh", "-c", "sleep 30 # innocent"], start_new_session=True)
    try:
        db.create_run("orphan2", "deploy", "t", [("a", "A")], {})
        db.update_step("orphan2", "a", status="running", pgid=proc.pid, pstart="Thu Jan  1 00:00:00 1970")  # start time doesn't match
        r.startup()
        assert proc.poll() is None
    finally:
        os.killpg(proc.pid, signal.SIGKILL)
