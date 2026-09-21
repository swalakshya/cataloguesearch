"""Clean-up tab backend: scanning, pruning and the job. A fake Docker is used throughout; nothing real is ever pruned."""
import copy
import json
import subprocess
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, unquote, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deploy import gc, guard, settings
from deploy.api import router as deploy_router
from deploy.jobs_api import router as jobs_router
from tests.dev.conftest import wait_done


def iso(days_ago):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%S.123456789Z")


DF = {
    "LayersSize": 10_000,
    "Images": [
        {"Id": "sha256:aaaaaaaaaaaaaaaa", "RepoTags": ["app:latest"], "Containers": 1, "Size": 1000, "SharedSize": 0},          # in use
        {"Id": "sha256:bbbbbbbbbbbbbbbb", "RepoTags": ["app:old"], "Containers": 0, "Size": 900, "SharedSize": 300},            # unused tagged: 600 unique
        {"Id": "sha256:cccccccccccccccc", "RepoTags": None, "Containers": 0, "Size": 5000, "SharedSize": 4800},                 # dangling: 200 unique
        {"Id": "sha256:dddddddddddddddd", "RepoTags": ["<none>:<none>"], "Containers": 0, "Size": 70, "SharedSize": -1},         # dangling, shared unknown: 70
        {"Id": "sha256:eeeeeeeeeeeeeeee", "RepoTags": None, "Containers": 1, "Size": 400, "SharedSize": 0},                    # untagged but a container uses it
        {"Id": "sha256:ffffffffffffffff", "RepoTags": None, "Containers": -1, "Size": 400, "SharedSize": 0},                    # usage unknown: leave alone
    ],
    "BuildCache": [
        {"ID": "k1", "Type": "regular", "Description": "in use", "InUse": True, "Size": 500, "LastUsedAt": iso(1)},
        {"ID": "k2", "Type": "regular", "Description": "recent", "InUse": False, "Size": 100, "LastUsedAt": iso(1)},
        {"ID": "k3", "Type": "regular", "Description": "old", "InUse": False, "Size": 300, "LastUsedAt": iso(20)},
        {"ID": "k4", "Type": "regular", "Description": "never used, made long ago", "InUse": False, "Size": 40, "LastUsedAt": None, "CreatedAt": iso(30)},
    ],
    "Containers": [
        {"Names": ["/web"], "State": "running", "SizeRw": 10},
        {"Names": ["/old-job"], "State": "exited", "SizeRw": 25},
        {"Names": ["/never-started"], "State": "created", "SizeRw": 5},
    ],
    "Volumes": [
        {"Name": "opensearch-data", "UsageData": {"RefCount": 1, "Size": 3_000_000}},
        {"Name": "forgotten-data", "UsageData": {"RefCount": 0, "Size": 4_000_000}},
    ],
}
NETWORKS = [{"Name": "bridge"}, {"Name": "host"}, {"Name": "none"}, {"Name": "old-net"}]


class FakeEngine:
    """Records every request; answers from canned data. `fail` makes matching paths raise like a refused call.
    DELETE /images/<tag> behaves like Docker: it removes the tag, and the image (and its unique layers) with the last tag."""
    label = "Fake"

    def __init__(self, local=True, df=DF, fail=(), shell_out=""):
        self.local, self.df, self.fail, self.shell_out = local, copy.deepcopy(df), fail, shell_out
        self.calls, self.shell_calls = [], []

    def request(self, method, path, timeout=0):
        self.calls.append((method, path))
        if any(f in path for f in self.fail):
            raise gc.EngineError(f"Docker refused {path}")
        if path == "/system/df":
            return copy.deepcopy(self.df)
        if path.startswith("/networks?"):
            return NETWORKS
        if method == "DELETE":
            return self._delete(unquote(urlparse(path).path[len("/images/"):]))
        reply = {"images/prune": {"ImagesDeleted": [{"Deleted": "x"}] * 3, "SpaceReclaimed": 1234},
                 "build/prune": {"CachesDeleted": ["a", "b"], "SpaceReclaimed": 5678},
                 "containers/prune": {"ContainersDeleted": ["c"], "SpaceReclaimed": 30},
                 "networks/prune": {"NetworksDeleted": ["old-net"]}}
        return next(v for k, v in reply.items() if k in path)

    def _delete(self, tag):
        image = next((i for i in self.df["Images"] if tag in (i.get("RepoTags") or [])), None)
        if image is None:
            raise gc.EngineError(f"No such image: {tag}")
        if image.get("Containers"):
            raise gc.EngineError(f"conflict: image {tag} is being used by a container")
        image["RepoTags"].remove(tag)
        if not image["RepoTags"]:
            self.df["Images"].remove(image)
            self.df["LayersSize"] -= gc._unique_size(image)
        return [{"Untagged": tag}]

    def shell(self, script, timeout=0):
        self.shell_calls.append(script)
        return self.shell_out


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """A repo root holding the snapshot artefacts `Copy snapshots` leaves behind."""
    (tmp_path / "snapshots" / "nested").mkdir(parents=True)
    (tmp_path / "snapshots" / "index-1").write_bytes(b"x" * 400)
    (tmp_path / "snapshots" / "nested" / "seg.dat").write_bytes(b"y" * 600)
    (tmp_path / "snapshots_20260920.tar.zst").write_bytes(b"z" * 250)
    (tmp_path / "keep-me.txt").write_text("unrelated")
    monkeypatch.setattr(settings, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(settings, "CHAT_REPO_DIR", tmp_path / "no-chat-repo")
    monkeypatch.delenv("DEPLOY_PROTECTED_IMAGES", raising=False)
    return tmp_path


def write_compose(folder, name, images):
    services = "\n".join(f"  svc{i}:\n    image: {img}" for i, img in enumerate(images))
    (folder / name).write_text(f"services:\n{services}\n")


def by_id(result):
    return {c["id"]: c for c in result["categories"]}


# ------------------------------------------------------------------------------------------ scanning

def test_scan_classifies_and_sizes_what_can_be_cleaned(repo):
    r = gc.scan("local", engine=FakeEngine())
    cats = by_id(r)
    d = cats["dangling_images"]
    assert d["count"] == 2 and d["reclaimable"] == 270 and d["size"] == 270             # shared layers are not counted twice
    assert {i["name"] for i in d["items"]} == {"<untagged> cccccccccccc", "<untagged> dddddddddddd"}
    u = cats["unused_images"]
    assert u["count"] == 1 and u["reclaimable"] == 600 and u["items"][0]["name"] == "app:old"
    s = cats["stopped_containers"]
    assert s["count"] == 2 and s["reclaimable"] == 30
    assert cats["unused_networks"]["count"] == 1 and cats["unused_networks"]["size"] is None     # the built-in networks never count


def test_dangling_never_includes_images_a_container_uses_or_whose_usage_is_unknown(repo):
    names = {i["name"] for i in by_id(gc.scan("local", engine=FakeEngine()))["dangling_images"]["items"]}
    assert "<untagged> eeeeeeeeeeee" not in names and "<untagged> ffffffffffff" not in names


def test_build_cache_counts_only_unused_records_and_offers_an_age_variant(repo):
    c = by_id(gc.scan("local", engine=FakeEngine()))["build_cache"]
    assert c["count"] == 3 and c["reclaimable"] == 440                                    # the in-use record is excluded
    variants = {v["id"]: v for v in c["variants"]}
    assert variants["all"]["reclaimable"] == 440
    assert (variants["older"]["count"], variants["older"]["reclaimable"]) == (2, 340)     # 20 days old + never-used-but-created-30-days-ago


def test_totals_split_safe_from_optional(repo):
    r = gc.scan("local", engine=FakeEngine())
    cats = by_id(r)
    assert r["totals"]["safe"] == 270 + 440 + 30
    assert r["totals"]["optional"] == 600 + cats["snapshot_files"]["reclaimable"]
    assert [c["id"] for c in r["categories"] if c["safe"]] == ["dangling_images", "build_cache", "stopped_containers", "unused_networks"]
    assert not cats["unused_images"]["safe"] and not cats["snapshot_files"]["safe"]


def test_volumes_are_reported_but_never_offered_for_cleaning(repo):
    r = gc.scan("local", engine=FakeEngine())
    assert "volumes" not in by_id(r)
    v = r["volumes"]
    assert (v["count"], v["unused"], v["unused_size"]) == (2, 1, 4_000_000)
    assert {(i["name"], i["note"]) for i in v["items"]} == {("opensearch-data", "in use"), ("forgotten-data", "unused")}


def test_scan_is_read_only(repo):
    engine = FakeEngine()
    gc.scan("local", engine=engine)
    assert all(method == "GET" for method, _ in engine.calls)


def test_snapshot_files_locally_are_measured_from_disk(repo):
    c = by_id(gc.scan("local", engine=FakeEngine()))["snapshot_files"]
    assert c["size"] == 400 + 600 + 250
    assert {i["name"]: i["size"] for i in c["items"]} == {"snapshots/": 1000, "snapshots_20260920.tar.zst": 250}


def test_snapshot_files_on_prod_are_read_over_ssh(repo):
    engine = FakeEngine(local=False, shell_out="3700000000\tsnapshots\n2400000000\tsnapshot.tar.zst\n")
    c = by_id(gc.scan("prod", engine=engine))["snapshot_files"]
    assert {i["name"]: i["size"] for i in c["items"]} == {"snapshots/": 3_700_000_000, "snapshot.tar.zst": 2_400_000_000}
    assert engine.shell_calls[0].startswith(f"cd {settings.PROD_DIR}") and "du -sb" in engine.shell_calls[0]


@pytest.mark.parametrize("value,ok", [
    ("2026-09-01T10:00:00.123456789Z", True), ("2026-09-01T10:00:00Z", True), ("2026-09-01T10:00:00.5+02:00", True),
    ("0001-01-01T00:00:00Z", False), (None, False), ("", False), ("garbage", False),
])
def test_docker_timestamps_including_nanoseconds_and_zero_values(value, ok):
    assert (gc._parse_time(value) is not None) is ok


def test_fmt_bytes_matches_docker_decimal_units():
    assert [gc.fmt_bytes(n) for n in (0, 999, 1000, 1_500_000, 13_260_000_000, 2_400_000_000_000)] == \
        ["0 B", "999 B", "1.0 KB", "1.5 MB", "13.3 GB", "2.4 TB"]


# ------------------------------------------------------------------------------------------ pruning

def call_for(cat, variant=None):
    engine = FakeEngine()
    res = gc.prune("local", cat, variant, engine=engine)
    (method, path), = engine.calls
    url = urlparse(path)
    return res, method, url.path, {k: json.loads(unquote(v[0])) if k == "filters" else v[0] for k, v in parse_qs(url.query).items()}


@pytest.mark.parametrize("cat,variant,path,query,reclaimed", [
    ("dangling_images", None, "/images/prune", {"filters": {"dangling": ["true"]}}, 1234),
    ("build_cache", "all", "/build/prune", {"all": "true"}, 5678),
    ("build_cache", "older", "/build/prune", {"all": "true", "filters": {"until": ["168h"]}}, 5678),
    ("stopped_containers", None, "/containers/prune", {}, 30),
    ("unused_networks", None, "/networks/prune", {}, 0),
])
def test_each_category_calls_exactly_its_docker_prune(cat, variant, path, query, reclaimed):
    res, method, got_path, got_query = call_for(cat, variant)
    assert (method, got_path, got_query) == ("POST", path, query)
    assert res["reclaimed"] == reclaimed


def test_prune_never_touches_volumes():
    for cat in gc.CATEGORIES:
        if cat == "snapshot_files":
            continue
        engine = FakeEngine()
        gc.prune("local", cat, "all" if cat == "build_cache" else None, engine=engine)
        assert not any("/volumes" in p for _, p in engine.calls)
    with pytest.raises(ValueError):
        gc.prune("local", "volumes", engine=FakeEngine())


def test_snapshot_files_locally_empty_the_folder_but_keep_it_and_everything_else(repo):
    res = gc.prune("local", "snapshot_files", engine=FakeEngine())
    assert res["reclaimed"] == 1250
    assert (repo / "snapshots").is_dir() and list((repo / "snapshots").iterdir()) == []        # the folder can be bind-mounted into OpenSearch
    assert not list(repo.glob("snapshots_*.tar.zst"))
    assert (repo / "keep-me.txt").read_text() == "unrelated"


def test_snapshot_files_on_prod_empty_the_folder_without_removing_it():
    engine = FakeEngine(local=False, shell_out="100\tsnapshots\n")
    res = gc.prune("prod", "snapshot_files", engine=engine)
    cleanup = engine.shell_calls[-1]
    assert "find snapshots -mindepth 1 -delete" in cleanup and "rm -f snapshots_*.tar.zst snapshot.tar.zst" in cleanup
    assert "rm -rf" not in cleanup and res["reclaimed"] == 100


# ------------------------------------------------------------------------------------------ validation

def test_only_known_categories_and_variants_are_accepted():
    with pytest.raises(ValueError, match="Unknown target"):
        gc.normalise("mars", [{"id": "build_cache"}], True)
    with pytest.raises(ValueError, match="Unknown category"):
        gc.normalise("local", [{"id": "volumes"}], True)
    with pytest.raises(ValueError, match="not an option"):
        gc.normalise("local", [{"id": "dangling_images", "variant": "older"}], True)
    with pytest.raises(ValueError, match="not an option"):
        gc.normalise("local", [{"id": "build_cache", "variant": "rm -rf"}], True)
    with pytest.raises(ValueError, match="Nothing selected"):
        gc.normalise("local", [], True)


def test_the_safe_items_on_this_machine_need_no_confirmation_but_everything_else_does():
    ok = gc.normalise("local", [{"id": "dangling_images"}, {"id": "build_cache"}], confirm=False)
    assert ok == [{"id": "dangling_images", "variant": None}, {"id": "build_cache", "variant": "all"}]
    for optional in ("unused_images", "snapshot_files"):
        with pytest.raises(ValueError, match="confirmation"):
            gc.normalise("local", [{"id": optional}], confirm=False)
    with pytest.raises(ValueError, match="confirmation"):
        gc.normalise("prod", [{"id": "dangling_images"}], confirm=False)                    # anything on prod
    assert gc.normalise("prod", [{"id": "dangling_images"}], confirm=True)


def test_duplicates_are_dropped():
    assert len(gc.normalise("local", [{"id": "build_cache", "variant": "older"}, {"id": "build_cache"}], True)) == 1


# ------------------------------------------------------------------------------------------ the job

def test_cleanup_runs_as_a_job_with_a_step_per_category_and_reports_what_it_freed(jobs_env, monkeypatch, repo):
    engine = FakeEngine()
    monkeypatch.setattr(gc, "engine_for", lambda target: engine)
    run = wait_done(gc.start_cleanup("local", [{"id": "dangling_images"}, {"id": "build_cache", "variant": "older"}], confirm=False))
    assert run["kind"] == "gc" and run["status"] == "succeeded"
    assert [s["title"] for s in run["steps"]] == ["Dangling images", "Build cache (older than 7 days)"]
    assert [s["detail"] for s in run["steps"]] == ["Reclaimed 1.2 KB · 3 removed", "Reclaimed 5.7 KB · 2 removed"]
    assert [p for _, p in engine.calls if "prune" in p][1].startswith("/build/prune?all=true&filters=")


def test_one_failing_category_does_not_stop_the_others(jobs_env, monkeypatch, repo):
    engine = FakeEngine(fail=("/build/prune",))
    monkeypatch.setattr(gc, "engine_for", lambda target: engine)
    run = wait_done(gc.start_cleanup("local", [{"id": "build_cache"}, {"id": "dangling_images"}], confirm=False))
    assert run["status"] == "failed"
    assert [s["status"] for s in run["steps"]] == ["failed", "succeeded"]
    assert "refused" in run["steps"][0]["detail"]


def test_a_cleanup_cannot_start_while_another_job_runs(jobs_env, monkeypatch):
    import time
    from deploy import runner as r
    monkeypatch.setattr(gc, "engine_for", lambda target: FakeEngine())
    rid = r.runner.start("deploy", "busy", [r.StepSpec("s", "S", lambda c: 0 if c.sleep(30) else 130)], {})
    time.sleep(0.3)
    with pytest.raises(r.Busy):
        gc.start_cleanup("local", [{"id": "dangling_images"}], False)
    r.runner.cancel(rid)


# ------------------------------------------------------------------------------------------ prod transport

class FakeSSH:
    def __init__(self, stdout="", returncode=0, stderr=""):
        self.calls, self.result = [], subprocess.CompletedProcess([], returncode, stdout, stderr)

    def __call__(self, argv, **kw):
        self.calls.append(argv)
        return self.result


def test_remote_requests_go_over_ssh_and_curl_on_the_docker_socket(monkeypatch):
    ssh = FakeSSH(stdout='{"SpaceReclaimed": 42}\n200')
    monkeypatch.setattr(subprocess, "run", ssh)
    out = gc.RemoteEngine("prod-host").request("POST", '/images/prune?filters={"dangling":["true"]}')
    assert out == {"SpaceReclaimed": 42}
    argv = ssh.calls[0]
    assert argv[0] == "ssh" and "BatchMode=yes" in argv and argv[-2] == "prod-host"
    cmd = argv[-1]
    assert cmd.startswith("curl -s --unix-socket /var/run/docker.sock -X POST")
    assert "'http://localhost/images/prune?filters={\"dangling\":[\"true\"]}'" in cmd               # quoted: no shell surprises


def test_remote_errors_say_what_went_wrong(monkeypatch):
    monkeypatch.setattr(subprocess, "run", FakeSSH(stdout='{"message": "conflict: image is in use"}\n409'))
    with pytest.raises(gc.EngineError, match="HTTP 409.*image is in use"):
        gc.RemoteEngine("h").request("POST", "/images/prune")
    monkeypatch.setattr(subprocess, "run", FakeSSH(returncode=255, stderr="ssh: connect to host h port 22: Connection refused"))
    with pytest.raises(gc.EngineError, match="Could not reach h"):
        gc.RemoteEngine("h").request("GET", "/system/df")
    monkeypatch.setattr(subprocess, "run", FakeSSH(stdout="garbage"))
    with pytest.raises(gc.EngineError, match="Unexpected reply"):
        gc.RemoteEngine("h").request("GET", "/system/df")


def test_remote_shell_tolerates_du_finding_nothing_but_not_real_failures(monkeypatch):
    monkeypatch.setattr(subprocess, "run", FakeSSH(stdout="", returncode=1))
    assert gc.RemoteEngine("h").shell("du -sb nothing") == ""
    monkeypatch.setattr(subprocess, "run", FakeSSH(returncode=255, stderr="Permission denied (publickey)"))
    with pytest.raises(gc.EngineError, match="Permission denied"):
        gc.RemoteEngine("h").shell("anything")


# ------------------------------------------------------------------------------------------ HTTP

@pytest.fixture
def client(jobs_env, monkeypatch, repo):
    monkeypatch.setattr(gc, "engine_for", lambda target: FakeEngine(local=target == "local"))
    app = FastAPI()
    guard.install(app)
    for router in (deploy_router, jobs_router):
        app.include_router(router, prefix="/api")
    return TestClient(app)


def test_scan_endpoint(client):
    body = client.get("/api/deploy/gc/scan?target=local").json()
    assert body["target"] == "local" and len(body["categories"]) == 6 and body["totals"]["safe"] > 0
    assert client.get("/api/deploy/gc/scan?target=mars").status_code == 422


def test_scan_reports_an_unreachable_machine_as_a_503_with_the_reason(client, monkeypatch):
    def boom(target):
        raise gc.EngineError("Docker isn't reachable on this machine.")
    monkeypatch.setattr(gc, "engine_for", boom)
    r = client.get("/api/deploy/gc/scan?target=local")
    assert r.status_code == 503 and "isn't reachable" in r.json()["detail"]


def test_run_endpoint_validates_before_starting_anything(client):
    post = lambda body: client.post("/api/deploy/gc/run", json=body)  # noqa: E731
    assert post({"target": "local", "categories": []}).status_code == 422
    assert post({"target": "local", "categories": [{"id": "volumes"}]}).status_code == 422
    assert post({"target": "local", "categories": [{"id": "unused_images"}]}).status_code == 422          # needs confirm
    assert post({"target": "prod", "categories": [{"id": "dangling_images"}]}).status_code == 422          # prod needs confirm
    assert client.get("/api/jobs/runs?kind=gc").json()["runs"] == []


def test_run_endpoint_starts_a_gc_job(client):
    r = client.post("/api/deploy/gc/run", json={"target": "local", "categories": [{"id": "dangling_images"}]})
    assert r.status_code == 202
    run = wait_done(r.json()["run_id"])
    assert run["kind"] == "gc" and run["status"] == "succeeded"
    assert client.get("/api/jobs/runs?kind=gc").json()["runs"][0]["id"] == run["id"]


def test_a_foreign_website_cannot_start_a_cleanup(client):
    r = client.post("/api/deploy/gc/run", json={"target": "local", "categories": [{"id": "dangling_images"}]},
                    headers={"Origin": "http://evil.example"})
    assert r.status_code == 403


# ------------------------------------------------------------------------------------------ protected images

def test_protected_images_are_read_from_every_compose_file(repo, tmp_path, monkeypatch):
    chat = tmp_path / "chat"
    chat.mkdir()
    write_compose(repo, "docker-compose.yml", ["swalakshya/cataloguesearch:api", "swalakshya/cataloguesearch:frontend"])
    write_compose(repo, "docker-compose.prod.yml", ["swalakshya/cataloguesearch:api", "swalakshya/cataloguesearch:opensearch"])
    write_compose(chat, "docker-compose.yml", ["swalakshya/cataloguesearch-chat:latest"])
    monkeypatch.setattr(settings, "CHAT_REPO_DIR", chat)
    assert gc.protected_images() == {
        "swalakshya/cataloguesearch:api", "swalakshya/cataloguesearch:frontend",
        "swalakshya/cataloguesearch:opensearch", "swalakshya/cataloguesearch-chat:latest"}


def test_references_are_normalised_the_way_docker_lists_them(repo, monkeypatch):
    monkeypatch.setenv("TAG", "v9")
    write_compose(repo, "docker-compose.yml", [
        "docker.io/swalakshya/app:1", "nginx", "library/redis:7", "registry.example.com/team/x:2",
        "swalakshya/tagged:${TAG}", "swalakshya/defaulted:${MISSING_VAR:-stable}", "swalakshya/unresolved:${NOPE}"])
    assert gc.protected_images() == {
        "swalakshya/app:1", "nginx:latest", "redis:7", "registry.example.com/team/x:2",
        "swalakshya/tagged:v9", "swalakshya/defaulted:stable"}                # the unresolvable one is skipped, not guessed


def test_commented_out_services_and_unreadable_files_are_ignored(repo):
    (repo / "docker-compose.yml").write_text("services:\n  live:\n    image: keep/me:1\n#  dead:\n#    image: not/me:1\n")
    (repo / "docker-compose.broken.yml").write_text("services: [unclosed")
    assert gc.protected_images() == {"keep/me:1"}


def test_extra_protected_images_can_come_from_the_environment(repo, monkeypatch):
    monkeypatch.setenv("DEPLOY_PROTECTED_IMAGES", "extra/one:1, extra/two")
    assert gc.protected_images() == {"extra/one:1", "extra/two:latest"}


def test_no_compose_files_means_nothing_is_protected(repo):
    assert gc.protected_images() == set()


def DF_WITH(*images):
    df = copy.deepcopy(DF)
    df["Images"] = list(images)
    return df


def img(tag_or_tags, unique=100, containers=0, shared=0):
    tags = [tag_or_tags] if isinstance(tag_or_tags, str) else list(tag_or_tags)
    return {"Id": "sha256:" + ("1234abcd" * 8), "RepoTags": tags, "Containers": containers, "Size": unique + shared, "SharedSize": shared}


def test_scan_spares_protected_images_and_shows_them_separately(repo):
    write_compose(repo, "docker-compose.yml", ["swalakshya/cataloguesearch:api", "swalakshya/cataloguesearch-chat:latest"])
    df = DF_WITH(img("swalakshya/cataloguesearch:api", 1400), img("swalakshya/cataloguesearch-chat:latest", 100), img("python:3.13-slim", 259))
    c = by_id(gc.scan("local", engine=FakeEngine(df=df)))["unused_images"]
    assert (c["count"], c["reclaimable"]) == (1, 259) and [i["name"] for i in c["items"]] == ["python:3.13-slim"]
    kept = c["protected"]
    assert kept["count"] == 2 and kept["size"] == 1500
    assert {i["name"] for i in kept["items"]} == {"swalakshya/cataloguesearch:api", "swalakshya/cataloguesearch-chat:latest"}


def test_an_image_with_several_tags_is_protected_if_any_tag_is(repo):
    write_compose(repo, "docker-compose.yml", ["app:latest"])
    df = DF_WITH(img(["app:latest", "app:build-42"], 500))
    c = by_id(gc.scan("local", engine=FakeEngine(df=df)))["unused_images"]
    assert c["count"] == 0 and c["protected"]["count"] == 1


def test_protected_totals_do_not_count_toward_what_can_be_freed(repo):
    write_compose(repo, "docker-compose.yml", ["app:latest"])
    r = gc.scan("local", engine=FakeEngine(df=DF_WITH(img("app:latest", 1000), img("other:1", 50))))
    assert r["totals"]["optional"] == 50 + by_id(r)["snapshot_files"]["reclaimable"]


def test_the_untagged_previous_version_of_a_protected_tag_is_still_cleaned_as_dangling(repo):
    write_compose(repo, "docker-compose.yml", ["app:latest"])
    old = {"Id": "sha256:" + "9" * 64, "RepoTags": None, "Containers": 0, "Size": 700, "SharedSize": 0}
    cats = by_id(gc.scan("local", engine=FakeEngine(df=DF_WITH(img("app:latest", 1000), old))))
    assert cats["dangling_images"]["count"] == 1 and cats["dangling_images"]["reclaimable"] == 700


def test_removing_unused_images_deletes_only_the_unprotected_ones_by_tag(repo):
    write_compose(repo, "docker-compose.yml", ["swalakshya/cataloguesearch:api"])
    df = DF_WITH(img("swalakshya/cataloguesearch:api", 1400), img("python:3.13-slim", 259), img(["old:1", "old:2"], 40), img("busy:1", 30, containers=1))
    engine = FakeEngine(df=df)
    res = gc.prune("local", "unused_images", engine=engine)
    deletes = [(m, unquote(p)) for m, p in engine.calls if m == "DELETE"]
    assert deletes == [("DELETE", "/images/python:3.13-slim?noprune=false"), ("DELETE", "/images/old:1?noprune=false"),
                       ("DELETE", "/images/old:2?noprune=false")]
    assert not any("cataloguesearch:api" in p or "busy" in p for _, p in deletes)                   # protected and in-use are untouched
    assert not any("/images/prune" in p for _, p in engine.calls)                                    # never the blanket prune
    assert res["reclaimed"] == 259 + 40                                                              # measured from the layer total
    assert res["detail"] == "2 removed, 1 protected kept"
    assert {i["RepoTags"][0] for i in engine.df["Images"]} == {"swalakshya/cataloguesearch:api", "busy:1"}


def test_the_freed_space_falls_back_to_the_estimate_if_docker_reports_no_change(repo):
    engine = FakeEngine(df=DF_WITH(img("gone:1", 300)))
    original = engine._delete
    engine._delete = lambda tag: (original(tag), engine.df.__setitem__("LayersSize", 10_000))[0]   # total not updated
    assert gc.prune("local", "unused_images", engine=engine)["reclaimed"] == 300


def test_one_image_that_cannot_be_removed_does_not_stop_the_rest(repo):
    engine = FakeEngine(df=DF_WITH(img("stuck:1", 100), img("fine:1", 200)), fail=("stuck",))
    res = gc.prune("local", "unused_images", engine=engine)
    assert res["detail"] == "1 removed, 1 couldn't be removed" and res["reclaimed"] == 200


def test_an_image_that_started_being_used_since_the_scan_is_left_alone(repo):
    df = DF_WITH(img("was-unused:1", 100))
    engine = FakeEngine(df=df)
    df_now = copy.deepcopy(df)
    df_now["Images"][0]["Containers"] = 1                       # a container started between the scan and the click
    engine.df = df_now
    res = gc.prune("local", "unused_images", engine=engine)
    assert not any(m == "DELETE" for m, _ in engine.calls) and res["reclaimed"] == 0


def test_the_same_removal_logic_applies_on_prod(repo):
    write_compose(repo, "docker-compose.yml", ["swalakshya/cataloguesearch:api"])
    engine = FakeEngine(local=False, df=DF_WITH(img("swalakshya/cataloguesearch:api", 5), img("old/thing:1", 7)))
    gc.prune("prod", "unused_images", engine=engine)
    assert [(m, unquote(p)) for m, p in engine.calls if m == "DELETE"] == [("DELETE", "/images/old/thing:1?noprune=false")]


def test_the_job_reports_how_many_were_kept(jobs_env, monkeypatch, repo):
    write_compose(repo, "docker-compose.yml", ["swalakshya/cataloguesearch:api"])
    engine = FakeEngine(df=DF_WITH(img("swalakshya/cataloguesearch:api", 1400), img("python:3.13-slim", 259)))
    monkeypatch.setattr(gc, "engine_for", lambda target: engine)
    run = wait_done(gc.start_cleanup("local", [{"id": "unused_images"}], confirm=True))
    assert run["status"] == "succeeded" and "1 protected kept" in run["steps"][0]["detail"]
