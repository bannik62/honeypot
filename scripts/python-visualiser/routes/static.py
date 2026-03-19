#!/usr/bin/env python3
"""
routes/static.py
Rôle: endpoints statiques/debug (data.json et endpoint de diagnostic).
"""

import json

from config import DATA_JSON_PATH, ROOT, SCAN_DIR


def serve_debug(handler):
    """Aide au diagnostic : chemin SCAN_DIR et existence du dossier data."""
    info = {
        "SCAN_DIR": str(SCAN_DIR),
        "SCAN_DIR_exists": SCAN_DIR.is_dir(),
        "ROOT": str(ROOT),
    }
    body = json.dumps(info, indent=2).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def serve_data_json(handler):
    if not DATA_JSON_PATH.is_file():
        handler.send_error(404, "data.json not found")
        return
    try:
        body = DATA_JSON_PATH.read_bytes()
    except OSError:
        handler.send_error(500)
        return
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)
