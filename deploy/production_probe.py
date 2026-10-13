"""Read-only production probe, sent to `python3 -` over SSH. Stdlib only.

Never invokes Certbot, refreshes apt, or reads private keys. Each section can fail
independently (for example when the SSH account cannot read renewal settings).
"""
import concurrent.futures
import configparser
import hashlib
import json
import math
from pathlib import Path
import socket
import ssl
import subprocess
from datetime import datetime, timezone

DOMAINS = ("swalakshya.me", "www.swalakshya.me", "chat.swalakshya.me")


def command(argv, data=None):
    result = subprocess.run(argv, input=data, capture_output=True, timeout=8)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace").strip()[:500] or "Command failed")
    return result.stdout.decode(errors="replace").strip()


def certificate(data, der=False):
    text = command(["openssl", "x509", "-inform", "DER" if der else "PEM",
                    "-noout", "-dates", "-issuer", "-ext", "subjectAltName"], data)
    fields = dict(line.split("=", 1) for line in text.splitlines() if "=" in line)
    expires = datetime.strptime(fields["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    starts = datetime.strptime(fields["notBefore"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    if not der:
        data = ssl.PEM_cert_to_DER_cert(data.decode())
    remaining = (expires - datetime.now(timezone.utc)).total_seconds()
    return {"expires_at": expires.isoformat(), "issued_at": starts.isoformat(),
            "days_remaining": math.floor(remaining / 86400), "expired": remaining <= 0,
            "issuer": fields.get("issuer"), "fingerprint": hashlib.sha256(data).hexdigest(),
            "domains": [part.strip()[4:] for line in text.splitlines()
                        for part in line.split(",") if part.strip().startswith("DNS:")]}


def served(domain):
    def connect(context):
        with socket.create_connection((domain, 443), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as tls:
                return tls.getpeercert(binary_form=True)
    result = {"domain": domain}
    try:
        try:
            data = connect(ssl.create_default_context())
            result["valid"] = True
        except ssl.SSLCertVerificationError as exc:
            result.update(valid=False, validation_error=str(exc)[:500])
            # Still report the expiry of an expired/untrusted certificate.
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            data = connect(context)
        result.update(certificate(data, der=True))
    except Exception as exc:
        result.update(valid=False, error=str(exc)[:500])
    return result


def disk_certificates():
    results = []
    for path in sorted(Path("/etc/letsencrypt/live").glob("*/cert.pem")):
        item = {"name": path.parent.name}
        try:
            item.update(certificate(path.read_bytes()))
        except Exception as exc:
            item["error"] = str(exc)[:500]
        results.append(item)
    if not results:
        raise RuntimeError("No readable certificates found in /etc/letsencrypt/live")
    return results


def renewal():
    def properties(unit, names):
        text = command(["systemctl", "show", unit, *["--property=" + n for n in names]])
        return dict(line.split("=", 1) for line in text.splitlines() if "=" in line)
    timer = properties("certbot.timer", ["LoadState", "ActiveState", "UnitFileState", "NextElapseUSecRealtime"])
    service = properties("certbot.service", ["Result", "ExecMainExitTimestamp"])
    # systemd prints timestamps in the VM's timezone; send ISO timestamps so
    # the UI can display them in the viewer's timezone without guessing CEST.
    for values, key in [(timer, "NextElapseUSecRealtime"), (service, "ExecMainExitTimestamp")]:
        if values.get(key):
            try:
                values[key] = command(["date", "--date", values[key], "--iso-8601=seconds"])
            except Exception:
                pass  # Preserve the original timestamp if conversion is unavailable.
    methods = []
    for path in sorted(Path("/etc/letsencrypt/renewal").glob("*.conf")):
        config = configparser.ConfigParser(interpolation=None, strict=False)
        # Certbot files have top-level keys before their ConfigObj sections.
        config.read_string("[certificate]\n" + path.read_text())
        methods.append({"name": path.stem, "authenticator": config.get("renewalparams", "authenticator", fallback="unknown")})
    result = {"timer": timer, "service": service, "methods": methods}
    try:
        result["recent_log"] = command(["journalctl", "-u", "certbot.service", "-n", "12", "--no-pager", "-o", "short-iso"])[:4000]
    except Exception as exc:
        result["log_error"] = str(exc)[:500]
    return result


def system():
    release = dict(line.split("=", 1) for line in Path("/etc/os-release").read_text().splitlines() if "=" in line)
    return {"ubuntu": release.get("PRETTY_NAME", "Unknown").strip('"'),
            "reboot_required": Path("/var/run/reboot-required").exists()}


def updates():
    lines = command(["apt", "list", "--upgradable"]).splitlines()
    packages = [line for line in lines if "/" in line and "[upgradable from:" in line]
    return {"pending": len(packages), "security": sum("security" in line.split()[0] for line in packages),
            "source": "Cached apt package lists; no update was run"}


def collect():
    report = {"checked_at": datetime.now(timezone.utc).isoformat()}
    for name, probe in [("system", system), ("updates", updates), ("certificates", disk_certificates), ("renewal", renewal)]:
        try:
            report[name] = probe()
        except Exception as exc:
            report[name] = {"error": str(exc)[:500]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        report["endpoints"] = list(pool.map(served, DOMAINS))
    disk = report["certificates"]
    for endpoint in report["endpoints"]:
        matches = [cert for cert in disk if endpoint["domain"] in cert.get("domains", [])] if isinstance(disk, list) else []
        endpoint["matches_disk"] = (endpoint["fingerprint"] in [cert.get("fingerprint") for cert in matches]
                                    if matches and endpoint.get("fingerprint") else None)
    return report


if __name__ == "__main__":
    print(json.dumps(collect()))
