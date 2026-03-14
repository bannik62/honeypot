#!/usr/bin/env python3
"""
Serveur minimal pour le visualiseur honeypot.
Écoute sur 127.0.0.1 uniquement. Sert visualizer/ et data/visualizer-dashboard/data.json.
"""
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# Racine du projet honeypot (scripts/python-visualiser -> scripts -> honeypot)
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent.parent  # python-visualiser -> scripts; parent.parent = honeypot
VISUALIZER_DIR = ROOT / "visualizer"
DATA_JSON_PATH = ROOT / "data" / "visualizer-dashboard" / "data.json"
DATA_JSON_URL = "/data/visualizer-dashboard/data.json"

PORT = 8765


class VisualizerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(VISUALIZER_DIR), **kwargs)

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        if path == "/":
            self.path = "/honeypot-dashboard.html"
            return super().do_GET()
        if path == DATA_JSON_URL:
            self.serve_data_json()
            return
        if path.startswith("/visualizer/"):
            self.path = path.replace("/visualizer", "", 1) or "/honeypot-dashboard.html"
            return super().do_GET()
        if path.startswith("/"):
            # Fichiers sous / → visualizer/
            self.path = path
            return super().do_GET()
        self.send_error(404)

    def serve_data_json(self):
        if not DATA_JSON_PATH.is_file():
            self.send_error(404, "data.json not found")
            return
        try:
            body = DATA_JSON_PATH.read_bytes()
        except OSError:
            self.send_error(500)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass  # silencieux


def main():
    if not VISUALIZER_DIR.is_dir():
        print("Erreur: visualizer/ introuvable", file=sys.stderr)
        sys.exit(1)
    server = HTTPServer(("127.0.0.1", PORT), VisualizerHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
