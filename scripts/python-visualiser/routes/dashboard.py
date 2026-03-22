#!/usr/bin/env python3
"""
routes/dashboard.py
Rôle: maintenance dashboard — régénération de data.json via generate-data.sh (VPS).
"""

import json
import subprocess

from config import ROOT


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
            {"ok": False, "error": "Timeout après 10 minutes (génération trop longue)."},
            500,
        )
    except OSError as e:
        _send_json(handler, {"ok": False, "error": str(e)}, 500)
