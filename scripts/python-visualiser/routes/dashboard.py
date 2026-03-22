#!/usr/bin/env python3
"""
routes/dashboard.py
Rôle: maintenance dashboard — régénération de data.json via generate-data.sh (VPS).
"""

import json
import shutil
import subprocess

from config import ROOT

_EXIT_MARKER = "__HONEYPOT_EXIT__"
# Parse data.json : peut dépasser 10 min (beaucoup d’IPs, geoip, hops…)
REGENERATE_TIMEOUT_SEC = 50 * 60


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
    Lance scripts/generate-data.sh depuis ROOT (même logique que honeypot-make-visualizer-data).
    Réponse: { ok, returncode?, error?, stdout_tail?, stderr_tail? }
    """
    script = ROOT / "scripts" / "generate-data.sh"
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
            timeout=600,
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
    Lance generate-data.sh et envoie stdout+stderr en texte brut (flux type terminal),
    puis une ligne finale __HONEYPOT_EXIT__ <code>.
    """
    script = ROOT / "scripts" / "generate-data.sh"
    if not script.is_file():
        handler.send_response(500)
        handler.send_header("Content-Type", "text/plain; charset=utf-8")
        handler.end_headers()
        handler.wfile.write(b"Script generate-data.sh introuvable.\n")
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
