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
# Chemin réel des rapports/screenshots (aligné avec data/screenshotAndLog/<ip>/)
IP_PREFIX = "/data/screenshotAndLog/"

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
        if path == "/data/visualizer-dashboard/debug" or path == "/data/screenshotAndLog/debug":
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

    def _parse_png_name(self, stem, ip):
        """Extrait port et timestamp depuis <ip>_<port>_YYYYMMDD_HHMMSS."""
        parts = stem.split("_")
        if len(parts) < 4:
            return None, None
        port = parts[1] if parts[0] == ip else None
        date_part = parts[-2]
        time_part = parts[-1]
        if len(date_part) != 8 or len(time_part) != 6:
            return port, None
        try:
            ts = f"{date_part[0:4]}-{date_part[4:6]}-{date_part[6:8]} {time_part[0:2]}:{time_part[2:4]}:{time_part[4:6]}"
            return port, ts
        except Exception:
            return port, None

    def serve_ip_resource(self, subpath):
        parts = subpath.split("/")
        if len(parts) != 2:
            self.send_error(404)
            return
        ip, second = parts
        if not IP_RE.match(ip):
            self.send_error(400)
            return
        ip_dir = SCAN_DIR / ip
        if not ip_dir.is_dir():
            self.send_error(404)
            return
        # Liste des PNG pour cette IP (JSON)
        if second == "list":
            import json
            pngs = sorted(ip_dir.glob("*.png"))
            out = []
            for f in pngs:
                port, ts = self._parse_png_name(f.stem, ip)
                out.append({"file": f.name, "port": port or "?", "timestamp": ts or "?"})
            body = json.dumps({"pngs": out}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        # Fichier PNG par nom : <ip>_<port>_*.png
        if second.endswith(".png") and second.startswith(ip + "_") and ".." not in second:
            file_path = ip_dir / second
            if file_path.is_file():
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
                return
            self.send_error(404)
            return
        # Rapports texte nmap / dns / nikto
        if second not in ("nmap", "dns", "nikto"):
            self.send_error(404)
            return
        file_path = ip_dir / f"{ip}_{second}.txt"
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
