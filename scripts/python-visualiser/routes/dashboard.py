#!/usr/bin/env python3
"""
routes/dashboard.py
Rôle: maintenance dashboard — pipeline traceroute puis generate-data (VPS).
"""

import json
import shutil
import subprocess

from config import ROOT

_EXIT_MARKER = "__HONEYPOT_EXIT__"
# traceroute-ip + generate-data (beaucoup d’IPs)
REGENERATE_TIMEOUT_SEC = 90 * 60
STARTUP_CHECK_TIMEOUT_SEC = 25


def _send_json(handler, payload, status=200):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def serve_dashboard_regenerate(handler):
    """
    POST /api/dashboard/regenerate
    Lance scripts/dashboard-regenerate.sh (traceroute-ip puis generate-data).
    Réponse: { ok, returncode?, error?, stdout_tail?, stderr_tail? }
    """
    script = ROOT / "scripts" / "dashboard-regenerate.sh"
    if not script.is_file():
        _send_json(
            handler,
            {"ok": False, "error": f"Script introuvable: {script}"},
            500,
        )
        return

    try:
        proc = subprocess.run(
            ["/bin/bash", str(script)],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=REGENERATE_TIMEOUT_SEC,
        )
        ok = proc.returncode == 0
        out = (proc.stdout or "")[-12000:]
        err = (proc.stderr or "")[-12000:]
        payload = {
            "ok": ok,
            "returncode": proc.returncode,
            "stdout_tail": out,
            "stderr_tail": err,
            "error": None if ok else (err.strip() or f"exit code {proc.returncode}"),
        }
        _send_json(handler, payload, 200 if ok else 500)
    except subprocess.TimeoutExpired:
        _send_json(
            handler,
            {
                "ok": False,
                "error": f"Timeout après {REGENERATE_TIMEOUT_SEC // 60} minutes (génération trop longue).",
            },
            500,
        )
    except OSError as e:
        _send_json(handler, {"ok": False, "error": str(e)}, 500)


def serve_dashboard_regenerate_stream(handler):
    """
    POST /api/dashboard/regenerate-stream
    Lance dashboard-regenerate.sh (traceroute puis generate), flux, puis __HONEYPOT_EXIT__ <code>.
    """
    script = ROOT / "scripts" / "dashboard-regenerate.sh"
    if not script.is_file():
        handler.send_response(500)
        handler.send_header("Content-Type", "text/plain; charset=utf-8")
        handler.end_headers()
        handler.wfile.write(b"Script dashboard-regenerate.sh introuvable.\n")
        return

    handler.send_response(200)
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()

    cmd = ["/bin/bash", str(script)]
    stdbuf = shutil.which("stdbuf")
    if stdbuf:
        cmd = [stdbuf, "-oL", "-eL"] + cmd

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=0,
        )
    except OSError as e:
        handler.wfile.write(f"Erreur lancement: {e}\n{_EXIT_MARKER} 1\n".encode("utf-8"))
        handler.wfile.flush()
        return

    try:
        if proc.stdout is not None:
            while True:
                chunk = proc.stdout.read(4096)
                if not chunk:
                    break
                handler.wfile.write(chunk)
                handler.wfile.flush()
        rc = proc.wait(timeout=REGENERATE_TIMEOUT_SEC)
    except subprocess.TimeoutExpired:
        proc.kill()
        handler.wfile.write(
            f"\n[timeout {REGENERATE_TIMEOUT_SEC // 60} min]\n{_EXIT_MARKER} 124\n".encode(
                "utf-8"
            )
        )
        handler.wfile.flush()
        return
    except Exception as e:
        try:
            proc.kill()
        except Exception:
            pass
        handler.wfile.write(f"\n[erreur serveur: {e}]\n{_EXIT_MARKER} 1\n".encode("utf-8"))
        handler.wfile.flush()
        return

    handler.wfile.write(f"\n{_EXIT_MARKER} {rc}\n".encode("utf-8"))
    handler.wfile.flush()


def serve_dashboard_startup_log_stream(handler):
    """
    GET /api/dashboard/startup-log-stream
    Stream du diagnostic honeypot-check.sh pour animer le chargement initial.
    """
    script = ROOT / "scripts" / "honeypot-check.sh"
    if not script.is_file():
        handler.send_response(200)
        handler.send_header("Content-Type", "text/plain; charset=utf-8")
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()
        handler.wfile.write(b"[startup] honeypot-check.sh introuvable.\n")
        handler.wfile.flush()
        return

    handler.send_response(200)
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()

    cmd = ["/bin/bash", str(script)]
    stdbuf = shutil.which("stdbuf")
    if stdbuf:
        cmd = [stdbuf, "-oL", "-eL"] + cmd

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except OSError as e:
        handler.wfile.write(f"[startup] erreur lancement: {e}\n".encode("utf-8"))
        handler.wfile.flush()
        return

    try:
        if proc.stdout is not None:
            for line in proc.stdout:
                handler.wfile.write(line.encode("utf-8", errors="replace"))
                handler.wfile.flush()
        proc.wait(timeout=STARTUP_CHECK_TIMEOUT_SEC)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except Exception:
            pass
        handler.wfile.write(f"\n[startup] timeout ({STARTUP_CHECK_TIMEOUT_SEC}s)\n".encode("utf-8"))
        handler.wfile.flush()
    except Exception as e:
        try:
            proc.kill()
        except Exception:
            pass
        handler.wfile.write(f"\n[startup] erreur stream: {e}\n".encode("utf-8"))
        handler.wfile.flush()
