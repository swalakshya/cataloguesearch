"""Certificate maintenance uses the shared job lock; never needs local Docker."""
from pathlib import Path

from deploy import production, settings
from deploy.runner import Cmd, StepSpec, runner


def _step(stage):
    def execute(ctx):
        try:
            return ctx.run(Cmd(
                ["ssh", *settings.SSH_OPTS, settings.PROD_HOST, f"python3 - {stage}"],
                f"Production certificates: {stage}",
                stdin_path=Path(__file__).with_name("certificate_maintenance.py")))
        finally:
            production.forget()
    return execute


def start_renewal():
    return runner.start("certificates", "Renew HTTPS credentials", [
        StepSpec("prepare", "Prepare webroot renewal", _step("prepare")),
        StepSpec("renew", "Renew certificate and reload Nginx", _step("renew")),
        StepSpec("verify", "Verify HTTPS on all domains", _step("verify")),
    ], {"host": settings.PROD_HOST})
