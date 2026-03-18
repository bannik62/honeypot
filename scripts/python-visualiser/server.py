#!/usr/bin/env python3
"""
Serveur minimal pour le visualiseur honeypot.
Écoute sur 127.0.0.1 uniquement. Sert visualizer/ et data/visualizer-dashboard/data.json.
Expose aussi les rapports par IP (nmap, dns, nikto, traceroute, screenshot).

Pattern des fichiers (aligné avec les scripts) :
  data/screenshotAndLog/<IP>/<IP>_nmap.txt       (vuln-scan.sh)
  data/screenshotAndLog/<IP>/<IP>_dns.txt        (dig-ip.sh)
  data/screenshotAndLog/<IP>/<IP>_nikto.txt      (si présent)
  data/screenshotAndLog/<IP>/<IP>_traceroute.txt (vuln-scan.sh, extrait nmap --traceroute)
  data/screenshotAndLog/<IP>/*.png               (web-capture.sh : <IP>_<port>_<date>_<time>.png)
"""
import os
import re
import sys
import json
import time
from collections import deque
import urllib.request
import urllib.error
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


def load_config():
    cfg = {}
    config_path = ROOT / "config" / "config"
    if config_path.is_file():
        try:
            with config_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    cfg[key.strip()] = val.strip().strip('"')
        except OSError:
            return {}
    return cfg


CONFIG = load_config()

# Buffer d'événements Vulners (sans la clé, ni les tokens)
VULNERS_EVENTS = deque(maxlen=200)
VULNERS_EVENT_ID = 0
VULNERS_SERVER_VERSION = "v2"

# Cache mémoire TTL (24h) pour éviter de re-frapper Vulners.
# Stocke par ID: desc string (peut être '' si aucun document renvoyé).
VULNERS_CACHE_TTL_SECONDS = 24 * 60 * 60
VULNERS_CACHE = {}  # { id: { ts: float, desc: str } }


class VisualizerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(VISUALIZER_DIR), **kwargs)

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        if path == "/api/vulners/status":
            self.serve_vulners_status()
            return
        if path == "/api/vulners/events":
            self.serve_vulners_events()
            return
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

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        if path == "/api/vulners/lookup":
            self.serve_vulners_lookup()
            return
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
        # Rapports texte nmap / dns / nikto / traceroute
        if second not in ("nmap", "dns", "nikto", "traceroute"):
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

    def serve_vulners_status(self):
        has_key = bool((CONFIG.get("VULNERS_API_KEY") or "").strip())
        body = json.dumps({"configured": has_key, "server_version": VULNERS_SERVER_VERSION}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_vulners_events(self):
        # Retourne uniquement les événements récents, sans donnée sensible.
        events = list(VULNERS_EVENTS)
        body = json.dumps({"events": events, "server_version": VULNERS_SERVER_VERSION}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self, max_bytes=1024 * 1024):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > max_bytes:
            return None
        try:
            raw = self.rfile.read(length)
        except OSError:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return None

    def serve_vulners_lookup(self):
        global VULNERS_EVENT_ID
        payload = self._read_json_body()
        if not payload or not isinstance(payload, dict):
            self.send_error(400)
            return
        ids = payload.get("ids", [])
        if not isinstance(ids, list):
            self.send_error(400)
            return
        ids = [str(x) for x in ids if x]
        if len(ids) > 300:
            ids = ids[:300]

        api_key = (CONFIG.get("VULNERS_API_KEY") or "").strip()
        configured = bool(api_key)
        # Pas de clé => on renvoie vide (le frontend affichera sans descriptions)
        if not api_key:
            VULNERS_EVENT_ID += 1
            VULNERS_EVENTS.append({
                "id": VULNERS_EVENT_ID,
                "ts": time.time(),
                "type": "lookup_skip_no_key",
                "configured": configured,
                "ids_count": len(ids),
                "server_version": VULNERS_SERVER_VERSION,
            })
            body = json.dumps({"details": {}}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        now = time.time()
        ids_to_fetch = []
        ids_cached_desc = {}  # {id: desc}
        for vuln_id in ids:
            ent = VULNERS_CACHE.get(vuln_id)
            if ent and isinstance(ent, dict):
                ts = ent.get("ts", 0) or 0
                desc = ent.get("desc", "")
                if ts and (now - ts) <= VULNERS_CACHE_TTL_SECONDS:
                    ids_cached_desc[vuln_id] = desc
                    continue
                # expired -> drop
                if vuln_id in VULNERS_CACHE:
                    del VULNERS_CACHE[vuln_id]
            ids_to_fetch.append(vuln_id)

        details_cached_out = {vid: d for vid, d in ids_cached_desc.items() if d}
        if not ids_to_fetch:
            VULNERS_EVENT_ID += 1
            VULNERS_EVENTS.append({
                "id": VULNERS_EVENT_ID,
                "ts": time.time(),
                "type": "lookup_cache_hit",
                "configured": configured,
                "ids_count": len(ids),
                "docs_count": len(details_cached_out),
                "server_version": VULNERS_SERVER_VERSION,
            })
            body = json.dumps({"details": details_cached_out}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        VULNERS_EVENT_ID += 1
        VULNERS_EVENTS.append({
            "id": VULNERS_EVENT_ID,
            "ts": time.time(),
            "type": "lookup_start",
            "configured": configured,
            "ids_count": len(ids_to_fetch),
            "server_version": VULNERS_SERVER_VERSION,
        })

        # Vulners API: authentification via header X-Api-Key (pas dans le body)
        req_body = json.dumps({"id": ids_to_fetch}).encode("utf-8")
        req = urllib.request.Request(
            "https://vulners.com/api/v3/search/id",
            data=req_body,
            headers={
                "Content-Type": "application/json",
                "X-Api-Key": api_key,
                # Headers réalistes pour éviter un fingerprint "bot"
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Accept": "application/json",
                "Accept-Language": "en-US,en;q=0.9",
                "Connection": "keep-alive",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp_body = resp.read()
        except urllib.error.HTTPError as e:
            err = f"HTTP {getattr(e, 'code', '?')}: {getattr(e, 'reason', '')}".strip()
            VULNERS_EVENT_ID += 1
            VULNERS_EVENTS.append({
                "id": VULNERS_EVENT_ID,
                "ts": time.time(),
                "type": "lookup_error",
                "configured": configured,
                "ids_count": len(ids_to_fetch),
                "error": err or "HTTP error",
                "server_version": VULNERS_SERVER_VERSION,
            })
            # on renvoie au moins le cache
            body = json.dumps({"details": details_cached_out}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        except urllib.error.URLError as e:
            err = str(getattr(e, "reason", "")) or str(e)
            VULNERS_EVENT_ID += 1
            VULNERS_EVENTS.append({
                "id": VULNERS_EVENT_ID,
                "ts": time.time(),
                "type": "lookup_error",
                "configured": configured,
                "ids_count": len(ids_to_fetch),
                "error": (err[:140] if err else "URLError"),
                "server_version": VULNERS_SERVER_VERSION,
            })
            body = json.dumps({"details": details_cached_out}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        except TimeoutError:
            VULNERS_EVENT_ID += 1
            VULNERS_EVENTS.append({
                "id": VULNERS_EVENT_ID,
                "ts": time.time(),
                "type": "lookup_error",
                "configured": configured,
                "ids_count": len(ids_to_fetch),
                "error": "timeout",
                "server_version": VULNERS_SERVER_VERSION,
            })
            body = json.dumps({"details": details_cached_out}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        resp_text = resp_body.decode("utf-8", errors="ignore")
        low = resp_text.lower()
        # Détection Cloudflare : HTML "Just a moment..." / "Verify you are human"
        if ("just a moment" in low) or ("verify you are human" in low) or ("cf-browser-verification" in low):
            VULNERS_EVENT_ID += 1
            VULNERS_EVENTS.append({
                "id": VULNERS_EVENT_ID,
                "ts": time.time(),
                "type": "lookup_error",
                "configured": configured,
                "ids_count": len(ids_to_fetch),
                "error": "cloudflare_block_detected",
                "server_version": VULNERS_SERVER_VERSION,
            })
            body = json.dumps({"details": details_cached_out}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        details_fetched = {}
        parse_ok = False
        try:
            res = json.loads(resp_text)
            docs = (((res or {}).get("data") or {}).get("documents")) or {}
            if isinstance(docs, dict):
                for k, v in docs.items():
                    if isinstance(v, dict):
                        details_fetched[k] = (v.get("title") or v.get("description") or "")
            parse_ok = True
        except Exception:
            parse_ok = False

        if not parse_ok:
            VULNERS_EVENT_ID += 1
            VULNERS_EVENTS.append({
                "id": VULNERS_EVENT_ID,
                "ts": time.time(),
                "type": "lookup_error",
                "configured": configured,
                "ids_count": len(ids_to_fetch),
                "error": "invalid_json_response",
                "server_version": VULNERS_SERVER_VERSION,
            })
            body = json.dumps({"details": details_cached_out}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # Update cache (y compris négatif: '' pour les IDs sans doc)
        for vuln_id in ids_to_fetch:
            VULNERS_CACHE[vuln_id] = {"ts": now, "desc": details_fetched.get(vuln_id, "")}

        details_out = {}
        for vuln_id in ids:
            desc = ids_cached_desc.get(vuln_id) or details_fetched.get(vuln_id) or ""
            if desc:
                details_out[vuln_id] = desc

        VULNERS_EVENT_ID += 1
        VULNERS_EVENTS.append({
            "id": VULNERS_EVENT_ID,
            "ts": time.time(),
            "type": "lookup_ok",
            "configured": configured,
            "ids_count": len(ids_to_fetch),
            "docs_count": len(details_out),
            "server_version": VULNERS_SERVER_VERSION,
        })

        body = json.dumps({"details": details_out}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
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
