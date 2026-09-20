"""Discover: OCR -> shared wait -> index, with a fake world of folders instead of the real crawler."""
import pytest

from deploy import db, runner as r
from ingest import jobs, status
from tests.dev.conftest import wait_done


class World:
    """Folder states, and what running the crawl / index command would do to them."""

    def __init__(self, monkeypatch, folders):
        self.f, self.calls = folders, []
        monkeypatch.setattr(status, "folder_snapshot", self.snapshot)
        monkeypatch.setattr(jobs, "_crawl_cmd", self.crawl)
        monkeypatch.setattr(jobs, "_index_cmd", self.index)
        monkeypatch.setattr(jobs, "_resolve_targets", lambda folders, mode: list(folders))
        monkeypatch.setattr(jobs, "POLL_SECONDS", 1)

    def snapshot(self, d):
        w = self.f[d]
        return {"counts": {"not_indexed": w["ni"], "ocred": w["oc"], "indexed": w["ix"]}, "pending": w["ni"] + w["oc"],
                "not_indexed": w["ni"], "batch_pending": w["ni"] if w.get("batch") else 0,
                "oldest_batch_submitted_at": "2026-09-20T00:00:00+00:00" if w.get("batch") else None, "pending_files": []}

    def crawl(self, d):
        w = self.f[d]
        self.calls.append((d, "crawl"))
        if w["kind"] == "tesseract":                       # OCR completes inside the crawl
            w["oc"], w["ni"] = w["oc"] + w["ni"], 0
        elif w["kind"] == "batch":                         # first crawl submits; later ones collect when ready
            w["polls"] = w.get("polls", 0) + 1
            if w["polls"] > w["ready_after"]:
                w["oc"], w["ni"], w["batch"] = w["oc"] + w["ni"], 0, False
            else:
                w["batch"] = True
        elif w["kind"] == "dead":                          # the batch job vanished without producing OCR
            w["polls"] = w.get("polls", 0) + 1
            w["batch"] = w["polls"] < 2
        return r.Cmd(["sh", "-c", f"echo crawl {d}"], "crawl")

    def index(self, d, force=False, skip_post_steps=False):
        w = self.f[d]
        self.calls.append((d, "index", "force" if force else "", "skip_post" if skip_post_steps else ""))
        assert force or w["ni"] == 0, f"index started on {d} before its OCR was complete"
        w["ix"], w["oc"] = w["ix"] + w["oc"], 0
        return r.Cmd(["sh", "-c", f"echo index {d}"], "index")


def run(jobs_env, folders, mode="index"):
    return wait_done(jobs.start_discover(folders, mode), timeout=40)


def statuses(run_):
    return [s["status"] for s in run_["steps"]]


def test_tesseract_folder_is_ocred_then_indexed_in_that_order(jobs_env, monkeypatch):
    w = World(monkeypatch, {"A": dict(kind="tesseract", ni=2, oc=0, ix=0)})
    result = run(jobs_env, ["A"])
    assert result["status"] == "succeeded" and w.f["A"]["ix"] == 2
    assert [c[1] for c in w.calls] == ["crawl", "index"]


def test_index_never_starts_while_a_batch_job_is_still_running(jobs_env, monkeypatch):
    w = World(monkeypatch, {"B": dict(kind="batch", ni=1, oc=0, ix=0, ready_after=2)})
    result = run(jobs_env, ["B"])                          # World.index asserts OCR was complete
    assert result["status"] == "succeeded" and [c[1] for c in w.calls] == ["crawl", "crawl", "crawl", "index"]


def test_shared_wait_gives_up_then_run_is_waiting_and_finished_folders_are_still_indexed(jobs_env, monkeypatch):
    w = World(monkeypatch, {"A": dict(kind="tesseract", ni=1, oc=0, ix=0),
                            "B": dict(kind="batch", ni=1, oc=0, ix=0, ready_after=2),
                            "C": dict(kind="batch", ni=1, oc=0, ix=0, ready_after=999)})
    monkeypatch.setattr(jobs, "MAX_WAIT_SECONDS", 6)
    result = run(jobs_env, ["A", "B", "C"])
    assert result["status"] == "waiting" and statuses(result) == ["succeeded", "waiting", "waiting"]
    assert (w.f["A"]["ix"], w.f["B"]["ix"], w.f["C"]["ix"]) == (1, 1, 0)
    indexed = [c for c in w.calls if c[1] == "index"]
    assert [c[3] for c in indexed] == ["skip_post", ""]    # series refresh / catalogue rebuild only after the last folder
    assert "Come back later" in result["steps"][1]["detail"]

    # ...and clicking again later resumes: nothing is redone for folders that already finished
    w.f["C"].update(ready_after=0, polls=0)
    w.calls.clear()
    again = run(jobs_env, ["A", "B", "C"])
    assert again["status"] == "succeeded" and w.f["C"]["ix"] == 1
    assert not [c for c in w.calls if c[0] in ("A", "B")]


def test_ocr_only_mode_stops_before_indexing(jobs_env, monkeypatch):
    w = World(monkeypatch, {"A": dict(kind="tesseract", ni=2, oc=0, ix=0)})
    result = run(jobs_env, ["A"], "ocr")
    assert [s["name"] for s in result["steps"]] == ["ocr", "wait"] and result["status"] == "succeeded"
    assert w.f["A"]["oc"] == 2 and w.f["A"]["ix"] == 0


def test_a_dead_batch_job_fails_only_its_own_folder(jobs_env, monkeypatch):
    w = World(monkeypatch, {"D": dict(kind="dead", ni=1, oc=0, ix=0), "E": dict(kind="tesseract", ni=1, oc=0, ix=0)})
    result = run(jobs_env, ["D", "E"])
    assert result["status"] == "failed" and w.f["E"]["ix"] == 1 and w.f["D"]["ix"] == 0


def test_reindex_forces_the_index_step_only(jobs_env, monkeypatch):
    w = World(monkeypatch, {"F": dict(kind="tesseract", ni=0, oc=0, ix=3)})
    result = run(jobs_env, ["F"], "reindex")
    assert result["status"] == "succeeded" and w.calls == [("F", "index", "force", "")]


def test_cancel_while_waiting_on_a_batch_job(jobs_env, monkeypatch):
    import time
    World(monkeypatch, {"G": dict(kind="batch", ni=1, oc=0, ix=0, ready_after=999)})
    monkeypatch.setattr(jobs, "POLL_SECONDS", 60)
    rid = jobs.start_discover(["G"], "index")
    time.sleep(2.5)
    jobs_env.runner.cancel(rid)
    result = wait_done(rid, 10)
    assert result["status"] == "cancelled" and statuses(result) == ["succeeded", "cancelled", "skipped"]


def test_start_rejects_unknown_modes_and_folders(jobs_env, monkeypatch):
    with pytest.raises(ValueError, match="Unknown mode"):
        jobs.start_discover(["A"], "nuke")
    monkeypatch.setattr(status, "scan", lambda: {"categories": [{"folders": [{"dir": "Known", "runnable": True, "pending": 1, "counts": {"not_indexed": 1}}]}]})
    with pytest.raises(ValueError, match="Not a known scan_config folder"):
        jobs.start_discover(["../../etc"], "index")
    with pytest.raises(ValueError, match="explicit folders"):
        jobs.start_discover(None, "reindex")
    with pytest.raises(ValueError, match="Not a known scan_config folder"):
        jobs.start_cleanup("../etc")


def test_commands_carry_pythonpath_and_the_right_flags(jobs_env):
    crawl = jobs._crawl_cmd("Granth/x")
    assert "--crawl" in crawl.argv and "--skip-post-steps" in crawl.argv and "--index" not in crawl.argv
    assert crawl.env and "PYTHONPATH" in crawl.env          # scripts/ is on sys.path, not the repo root
    idx = jobs._index_cmd("Granth/x", force=True, skip_post_steps=True)
    assert idx.argv.count("--index") == 1 and "--force" in idx.argv and "--crawl" not in idx.argv
    assert "--cleanup" in jobs._cli("Granth/x", "--cleanup", label="cleanup").argv


# ---- per-folder status: which folder is queued / running / submitted / waiting / done, for runs over several folders

def items(run_, step):
    """{folder: (state, note)} from a step's published checklist."""
    s = next(x for x in run_["steps"] if x["name"] == step)
    return {i["name"]: (i["state"], i.get("note")) for i in s["progress"]["phase"]["items"]}


def phase(run_, step):
    return next(x for x in run_["steps"] if x["name"] == step)["progress"]["phase"]


def test_multi_folder_run_reports_each_folder_in_every_phase(jobs_env, monkeypatch):
    w = World(monkeypatch, {"A": dict(kind="tesseract", ni=1, oc=0, ix=0),
                            "B": dict(kind="batch", ni=1, oc=0, ix=0, ready_after=2),
                            "C": dict(kind="batch", ni=1, oc=0, ix=0, ready_after=999)})
    monkeypatch.setattr(jobs, "MAX_WAIT_SECONDS", 6)
    result = run(jobs_env, ["A", "B", "C"])

    ocr = items(result, "ocr")
    assert ocr["A"] == ("done", "OCR complete")
    assert ocr["B"][0] == "submitted" and ocr["C"][0] == "submitted"
    assert (phase(result, "ocr")["done"], phase(result, "ocr")["total"]) == (3, 3)

    wait = items(result, "wait")
    assert set(wait) == {"B", "C"}                                  # A never needed waiting
    assert wait["B"] == ("done", "collected")
    assert wait["C"][0] == "waiting" and "batch submitted" in wait["C"][1]
    assert (phase(result, "wait")["done"], phase(result, "wait")["total"]) == (1, 2)

    index = items(result, "index")
    assert index["A"] == ("done", "indexed") and index["B"] == ("done", "indexed")
    assert index["C"][0] == "waiting" and "click Index again" in index["C"][1]
    assert (phase(result, "index")["done"], phase(result, "index")["total"]) == (2, 3)


def test_folders_with_nothing_to_do_are_shown_as_skipped(jobs_env, monkeypatch):
    World(monkeypatch, {"Done": dict(kind="tesseract", ni=0, oc=0, ix=2), "New": dict(kind="tesseract", ni=1, oc=0, ix=0)})
    result = run(jobs_env, ["Done", "New"])
    assert result["status"] == "succeeded"
    assert items(result, "ocr")["Done"] == ("skipped", "already OCRed") and items(result, "ocr")["New"][0] == "done"
    assert items(result, "index")["Done"] == ("skipped", "already indexed") and items(result, "index")["New"][0] == "done"


def test_a_failed_folder_is_marked_failed_and_the_others_carry_on(jobs_env, monkeypatch):
    w = World(monkeypatch, {"D": dict(kind="dead", ni=1, oc=0, ix=0), "E": dict(kind="tesseract", ni=1, oc=0, ix=0)})
    result = run(jobs_env, ["D", "E"])
    assert items(result, "wait")["D"][0] == "failed"
    assert items(result, "index")["E"][0] == "done"


def test_cancelling_marks_the_folder_that_was_running(jobs_env, monkeypatch):
    import time
    w = World(monkeypatch, {"A": dict(kind="tesseract", ni=1, oc=0, ix=0), "B": dict(kind="tesseract", ni=1, oc=0, ix=0)})
    monkeypatch.setattr(jobs, "_crawl_cmd", lambda d: r.Cmd(["sh", "-c", "sleep 60"], "slow crawl"))
    rid = jobs.start_discover(["A", "B"], "index")
    time.sleep(1.5)
    jobs_env.runner.cancel(rid)
    result = wait_done(rid, 10)
    assert result["status"] == "cancelled"
    assert items(result, "ocr") == {"A": ("cancelled", None), "B": ("pending", None)}   # A was running; B never started


def test_reindex_reports_per_folder_too(jobs_env, monkeypatch):
    World(monkeypatch, {"F": dict(kind="tesseract", ni=0, oc=0, ix=3), "G": dict(kind="tesseract", ni=0, oc=0, ix=1)})
    result = run(jobs_env, ["F", "G"], "reindex")
    assert items(result, "index") == {"F": ("done", "re-indexed"), "G": ("done", "re-indexed")}
