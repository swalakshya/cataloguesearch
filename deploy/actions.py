"""The deploy pipeline: build & push images, copy snapshots to prod, restore on prod."""
from typing import Dict, List

from deploy import db, settings
from deploy.progress import DockerBuildProgress
from deploy.runner import Cmd, StepCtx, StepSpec, runner

BUILD = "build"
COPY_SNAPSHOTS = "copy_snapshots"
RESTORE_PROD = "restore_prod"
ACTION_ORDER = [BUILD, COPY_SNAPSHOTS, RESTORE_PROD]
ACTION_TITLES = {
    BUILD: "Build & push images",
    COPY_SNAPSHOTS: "Create snapshots & copy to prod",
    RESTORE_PROD: "Restore snapshots on prod",
}


def _ssh(remote_cmd: str) -> List[str]:
    return ["ssh", *settings.SSH_OPTS, settings.PROD_HOST, remote_cmd]


def commands_for(action: str, params: Dict) -> List[Cmd]:
    if action == BUILD:
        selected = params.get("build_services") or settings.DEFAULT_BUILD_SERVICES
        main = [s for s in selected if s != settings.CHAT_SERVICE]
        cmds = []
        if main:
            cmds.append(Cmd(
                ["docker", "compose", "--env-file", settings.BUILD_ENV_FILE, "-f", settings.COMPOSE_FILE,
                 "build", "--push", *main],
                f"docker compose build --push {' '.join(main)}", progress_parser=DockerBuildProgress()))
        if settings.CHAT_SERVICE in selected:
            cmds.append(Cmd(["docker", "compose", "build", "--push"],
                            f"{settings.CHAT_SERVICE}: docker compose build --push",
                            cwd=settings.CHAT_REPO_DIR, progress_parser=DockerBuildProgress()))
        return cmds
    if action == COPY_SNAPSHOTS:
        return [Cmd(
            [settings.SCRIPT_PYTHON, "-u", "scripts/create_snapshots.py", "snapshots",
             "-s", settings.PROD_HOST, "--yes"],
            f"create_snapshots.py snapshots -s {settings.PROD_HOST}")]
    if action == RESTORE_PROD:
        remote_script = f"{settings.PROD_DIR}/restore_snapshots.py"
        return [
            # prod keeps its own copy of the script; refresh it so --yes and the pull step exist there
            Cmd(_ssh(f"cat > {remote_script}.new && mv {remote_script}.new {remote_script}"),
                "upload restore_snapshots.py to prod",
                stdin_path=settings.REPO_ROOT / "scripts" / "restore_snapshots.py"),
            Cmd(_ssh(f"cd {settings.PROD_DIR} && python3 -u restore_snapshots.py --yes"),
                "run restore_snapshots.py on prod"),
        ]
    raise ValueError(f"Unknown action: {action}")


def _spec(action: str, params: Dict) -> StepSpec:
    def run(ctx: StepCtx) -> int:
        cmds = commands_for(action, params)  # looked up at run time
        db.update_step(ctx.run_id, action, command=" && ".join(c.label for c in cmds))
        code = 0
        for cmd in cmds:
            code = ctx.run(cmd)
            if code != 0:
                break
        return code
    return StepSpec(action, ACTION_TITLES[action], run)


def _run_label(ordered: List[str]) -> str:
    """Name of a run in the history: the two OpenSearch steps together read as one job."""
    parts, i = [], 0
    while i < len(ordered):
        if ordered[i:i + 2] == [COPY_SNAPSHOTS, RESTORE_PROD]:
            parts.append("Deploy OpenSearch to prod")
            i += 2
        else:
            parts.append(ACTION_TITLES[ordered[i]])
            i += 1
    return " → ".join(parts)


def start_deploy(actions: List[str], params: Dict) -> str:
    ordered = [a for a in ACTION_ORDER if a in actions]
    if not ordered:
        raise ValueError("No valid actions selected")
    label = _run_label(ordered)
    return runner.start("deploy", label, [_spec(a, params) for a in ordered], params)
