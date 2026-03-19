#!/usr/bin/env python3
"""
routes/ip.py
Rôle: endpoints /data/screenshotAndLog/<ip>/... (liste PNG, PNG, rapports texte).
"""

import json

from config import IP_RE, SCAN_DIR


def _parse_png_name(stem, ip):
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


def serve_ip_resource(handler, subpath):
    parts = subpath.split("/")
    if len(parts) != 2:
        handler.send_error(404)
        return
    ip, second = parts
    if not IP_RE.match(ip):
        handler.send_error(400)
        return

    ip_dir = SCAN_DIR / ip
    if not ip_dir.is_dir():
        handler.send_error(404)
        return

    # Liste des PNG pour cette IP (JSON)
    if second == "list":
        pngs = sorted(ip_dir.glob("*.png"))
        out = []
        for f in pngs:
            port, ts = _parse_png_name(f.stem, ip)
            out.append({"file": f.name, "port": port or "?", "timestamp": ts or "?"})
        body = json.dumps({"pngs": out}).encode("utf-8")
        handler.send_response(200)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
        return

    # Fichier PNG par nom : <ip>_<port>_*.png
    if second.endswith(".png") and second.startswith(ip + "_") and ".." not in second:
        file_path = ip_dir / second
        if file_path.is_file():
            try:
                body = file_path.read_bytes()
            except OSError:
                handler.send_error(500)
                return
            handler.send_response(200)
            handler.send_header("Content-Type", "image/png")
            handler.send_header("Content-Length", str(len(body)))
            handler.end_headers()
            handler.wfile.write(body)
            return
        handler.send_error(404)
        return

    # Rapports texte nmap / dns / nikto / traceroute
    if second not in ("nmap", "dns", "nikto", "traceroute"):
        handler.send_error(404)
        return
    file_path = ip_dir / f"{ip}_{second}.txt"
    if not file_path.is_file():
        handler.send_error(404)
        return
    try:
        body = file_path.read_bytes()
    except OSError:
        handler.send_error(500)
        return
    handler.send_response(200)
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)
