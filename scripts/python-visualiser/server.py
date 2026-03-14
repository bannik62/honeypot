#!/usr/bin/env python3
"""
Serveur minimal pour le visualiseur honeypot.
Écoute sur 127.0.0.1 uniquement. Sert visualizer/ et data/visualizer-dashboard/data.json.
Expose aussi les rapports par IP (nmap, dns, nikto, screenshot).

Pattern des fichiers (aligné avec les scripts) :
  data/screenshotAndLog/<IP>/<IP>_nmap.txt    (vuln-scan.sh)
  data/screenshotAndLog/<IP>/<IP>_dns.txt     (dig-ip.sh)
  data/screenshotAndLog/<IP>/<IP>_nikto.txt   (si présent)
  data/screenshotAndLog/<IP>/*.png            (web-capture.sh : <IP>_<port>_<date>_<time>.png)
"""
import os
import re
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# Racine honeypot : priorité au cwd (server.sh fait "cd $HONEYPOT_ROOT" avant de lancer)
# sinon déduit depuis __file__ (scripts/python-visualiser -> parent.parent = honeypot)
_cwd = Path(os.getcwd()).resolve()
_file_root = Path(__file__).resolve().parent.parent.parent  # script -> python-visualiser -> scripts -> honeypot
if (_cwd / "data" / "screenshotAndLog").is_dir():
    ROOT = _cwd
elif (_cwd / "data" / "visualizer-dashboard").is_dir():
    ROOT = _cwd
else:
    ROOT = _file_root
VISUALIZER_DIR = ROOT / "visualizer"
SCAN_DIR = ROOT / "data" / "screenshotAndLog"
DATA_JSON_PATH = ROOT / "data" / "visualizer-dashboard" / "data.json"
DATA_JSON_URL = "/data/visualizer-dashboard/data.json"
IP_PREFIX = "/data/visualizer-dashboard/ip/"

PORT = 8765
IP_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$")


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
        if path == "/data/visualizer-dashboard/debug":
            self.serve_debug()
            return
        if path.startswith(IP_PREFIX):
            self.serve_ip_resource(path[len(IP_PREFIX):].strip("/"))
            return
        if path.startswith("/visualizer/"):
            self.path = path.replace("/visualizer", "", 1) or "/honeypot-dashboard.html"
            return super().do_GET()
        if path.startswith("/"):
            self.path = path
            return super().do_GET()
        self.send_error(404)

    def serve_ip_resource(self, subpath):
        parts = subpath.split("/")
        if len(parts) != 2:
            self.send_error(404)
            return
        ip, resource_type = parts
        if not IP_RE.match(ip) or resource_type not in ("nmap", "dns", "nikto", "screenshot"):
            self.send_error(400)
            return
        ip_dir = SCAN_DIR / ip
        if not ip_dir.is_dir():
            self.send_error(404)
            return
        if resource_type == "screenshot":
            pngs = list(ip_dir.glob("*.png"))
            if not pngs:
                self.send_error(404)
                return
            file_path = sorted(pngs)[0]
            try:
                body = file_path.read_bytes()
            except OSError:
                self.send_error(500)
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            file_path = ip_dir / f"{ip}_{resource_type}.txt"
            if not file_path.is_file():
                self.send_error(404)
                return
            try:
                body = file_path.read_bytes()
            except OSError:
                self.send_error(500)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def serve_debug(self):
        """Aide au diagnostic : chemin SCAN_DIR et existence du dossier data."""
        import json
        info = {
            "SCAN_DIR": str(SCAN_DIR),
            "SCAN_DIR_exists": SCAN_DIR.is_dir(),
            "ROOT": str(ROOT),
        }
        body = json.dumps(info, indent=2).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
