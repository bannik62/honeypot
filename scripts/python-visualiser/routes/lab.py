#!/usr/bin/env python3
"""
routes/lab.py — LAB (étude) : requêtes HTTP et envoi TCP depuis le serveur,
avec liste d’IPs autorisées. Pas d’usage contre des tiers sans autorisation.
"""

from __future__ import annotations

import ipaddress
import json
import re
import socket
import ssl
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from config import CONFIG, IP_RE, ROOT, VISUALIZER_DIR

MAX_BODY_IN = 512 * 1024
MAX_HTTP_RESPONSE = 2 * 1024 * 1024
MAX_TCP_READ = 256 * 1024
HTTP_TIMEOUT = 28
TCP_TIMEOUT_MAX = 60

_PRESET_WEB = VISUALIZER_DIR / "lab" / "presets-web.json"
_PRESET_TCP = VISUALIZER_DIR / "lab" / "presets-tcp.json"


def _read_json_body(handler, max_bytes: int = MAX_BODY_IN) -> dict[str, Any] | None:
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        length = 0
    if length <= 0 or length > max_bytes:
        return None
    try:
        raw = handler.rfile.read(length)
    except OSError:
        return None
    try:
        out = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    return out if isinstance(out, dict) else None


def _send_json(handler, payload: dict[str, Any], status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def get_allowed_ipv4s() -> set[str]:
    """IPs autorisées : 127.0.0.1, IPs vues dans connections.csv, LAB_ALLOW_IPS."""
    s: set[str] = {"127.0.0.1"}
    csv_path = ROOT / "data" / "logs" / "connections.csv"
    if csv_path.is_file():
        try:
            with csv_path.open("r", encoding="utf-8", errors="ignore") as f:
                next(f, None)
                for line in f:
                    parts = line.strip().split(",")
                    if len(parts) >= 2:
                        ip = parts[1].strip()
                        if IP_RE.match(ip):
                            s.add(ip)
        except OSError:
            pass
    extra = (CONFIG.get("LAB_ALLOW_IPS") or "").strip()
    for part in extra.split(","):
        p = part.strip()
        if p and IP_RE.match(p):
            s.add(p)
    return s


def _ipv4_allowed(ip: str, allowed: set[str]) -> bool:
    return ip in allowed


def _parse_headers_dict(raw: Any) -> tuple[dict[str, str] | None, str | None]:
    if raw is None:
        return {}, None
    if not isinstance(raw, dict):
        return None, "headers doit être un objet JSON"
    out: dict[str, str] = {}
    for k, v in raw.items():
        key = str(k).strip()
        if not key:
            continue
        lk = key.lower()
        if lk in ("host", "connection", "content-length", "transfer-encoding"):
            continue
        out[key] = str(v)
    return out, None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def serve_lab_presets_web(handler) -> None:
    _serve_presets_file(handler, _PRESET_WEB)


def serve_lab_presets_tcp(handler) -> None:
    _serve_presets_file(handler, _PRESET_TCP)


def serve_lab_meta(handler) -> None:
    allowed = get_allowed_ipv4s()
    _send_json(
        handler,
        {
            "allowed_ip_count": len(allowed),
            "has_connections_csv": (ROOT / "data" / "logs" / "connections.csv").is_file(),
        },
    )


def _serve_presets_file(handler, path: Path) -> None:
    if not path.is_file():
        _send_json(handler, {"version": 1, "presets": []})
        return
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        _send_json(handler, {"version": 1, "presets": [], "error": "fichier presets illisible"})
        return
    if not isinstance(data, dict):
        _send_json(handler, {"version": 1, "presets": []})
        return
    presets = data.get("presets", [])
    if not isinstance(presets, list):
        presets = []
    _send_json(
        handler,
        {
            "version": int(data.get("version", 1)),
            "presets": presets,
        },
    )


def serve_lab_http(handler) -> None:
    allowed = get_allowed_ipv4s()
    payload = _read_json_body(handler)
    if not payload:
        _send_json(handler, {"ok": False, "error": "JSON invalide ou trop volumineux"}, 400)
        return

    method = str(payload.get("method", "GET")).strip().upper()
    if method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"):
        _send_json(handler, {"ok": False, "error": "Méthode HTTP non supportée"}, 400)
        return

    url = str(payload.get("url", "")).strip()
    if not url or len(url) > 4096:
        _send_json(handler, {"ok": False, "error": "URL manquante ou trop longue"}, 400)
        return

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        _send_json(handler, {"ok": False, "error": "Schéma autorisé : http ou https"}, 400)
        return

    host = parsed.hostname
    if not host:
        _send_json(handler, {"ok": False, "error": "Hôte manquant dans l’URL"}, 400)
        return

    try:
        ip_obj = ipaddress.ip_address(host)
    except ValueError:
        _send_json(
            handler,
            {"ok": False, "error": "Utilisez une adresse IPv4 littérale dans l’URL (pas de nom DNS)."},
            400,
        )
        return

    if ip_obj.version != 4:
        _send_json(handler, {"ok": False, "error": "IPv4 uniquement pour ce premier jet."}, 400)
        return

    ip_str = str(ip_obj)
    if not _ipv4_allowed(ip_str, allowed):
        _send_json(
            handler,
            {"ok": False, "error": f"IP non autorisée : {ip_str}. Ajoutez-la dans connections.csv ou LAB_ALLOW_IPS."},
            403,
        )
        return

    hdrs, herr = _parse_headers_dict(payload.get("headers"))
    if herr:
        _send_json(handler, {"ok": False, "error": herr}, 400)
        return
    assert hdrs is not None

    body_raw = payload.get("body")
    data: bytes | None = None
    if body_raw is not None and method not in ("GET", "HEAD"):
        if not isinstance(body_raw, str):
            _send_json(handler, {"ok": False, "error": "body doit être une chaîne"}, 400)
            return
        data = body_raw.encode("utf-8")
        if len(data) > MAX_BODY_IN:
            _send_json(handler, {"ok": False, "error": "Corps de requête trop volumineux"}, 400)
            return

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    opener = urllib.request.build_opener(
        _NoRedirect,
        urllib.request.HTTPSHandler(context=ctx),
    )

    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)

    try:
        with opener.open(req, timeout=HTTP_TIMEOUT) as resp:
            status = resp.status
            resp_headers = {k: v for k, v in resp.getheaders()}
            chunk = resp.read(MAX_HTTP_RESPONSE + 1)
    except urllib.error.HTTPError as e:
        status = e.code
        resp_headers = dict(e.headers.items()) if e.headers else {}
        try:
            chunk = e.read(MAX_HTTP_RESPONSE + 1)
        except Exception:
            chunk = b""
    except urllib.error.URLError as e:
        _send_json(handler, {"ok": False, "error": f"Erreur réseau : {e.reason!s}"})
        return
    except Exception as e:
        _send_json(handler, {"ok": False, "error": str(e)})
        return

    truncated = len(chunk) > MAX_HTTP_RESPONSE
    if truncated:
        chunk = chunk[:MAX_HTTP_RESPONSE]

    try:
        body_text = chunk.decode("utf-8")
    except UnicodeDecodeError:
        body_text = chunk.decode("utf-8", errors="replace")

    _send_json(
        handler,
        {
            "ok": True,
            "http": {
                "status": status,
                "headers": resp_headers,
                "body_text": body_text,
                "body_length": len(chunk),
                "truncated": truncated,
            },
        },
    )


def _decode_tcp_payload(payload: str, encoding: str) -> tuple[bytes | None, str | None]:
    enc = (encoding or "text").strip().lower()
    if enc == "text":
        return payload.encode("utf-8"), None
    if enc == "hex":
        hx = re.sub(r"\s+", "", payload)
        if len(hx) % 2:
            return None, "Chaîne hex : longueur paire requise"
        try:
            return bytes.fromhex(hx), None
        except ValueError:
            return None, "Hex invalide"
    return None, "Encodage : text ou hex"


def serve_lab_tcp(handler) -> None:
    allowed = get_allowed_ipv4s()
    payload = _read_json_body(handler)
    if not payload:
        _send_json(handler, {"ok": False, "error": "JSON invalide ou trop volumineux"}, 400)
        return

    host = str(payload.get("host", "")).strip()
    if not host:
        _send_json(handler, {"ok": False, "error": "host manquant"}, 400)
        return

    try:
        ip_obj = ipaddress.ip_address(host)
    except ValueError:
        _send_json(handler, {"ok": False, "error": "host doit être une IPv4 littérale"}, 400)
        return

    if ip_obj.version != 4:
        _send_json(handler, {"ok": False, "error": "IPv4 uniquement"}, 400)
        return

    ip_str = str(ip_obj)
    if not _ipv4_allowed(ip_str, allowed):
        _send_json(
            handler,
            {"ok": False, "error": f"IP non autorisée : {ip_str}"},
            403,
        )
        return

    try:
        port = int(payload.get("port", 0))
    except (TypeError, ValueError):
        port = 0
    if port < 1 or port > 65535:
        _send_json(handler, {"ok": False, "error": "port invalide (1-65535)"}, 400)
        return

    try:
        timeout_sec = float(payload.get("timeout_sec", 8))
    except (TypeError, ValueError):
        timeout_sec = 8.0
    timeout_sec = max(1.0, min(float(TCP_TIMEOUT_MAX), timeout_sec))

    try:
        read_max = int(payload.get("read_max", 4096))
    except (TypeError, ValueError):
        read_max = 4096
    read_max = max(0, min(MAX_TCP_READ, read_max))

    body_str = payload.get("payload")
    if body_str is None:
        body_str = ""
    if not isinstance(body_str, str):
        _send_json(handler, {"ok": False, "error": "payload doit être une chaîne"}, 400)
        return

    raw, err = _decode_tcp_payload(body_str, str(payload.get("payload_encoding", "text")))
    if err:
        _send_json(handler, {"ok": False, "error": err}, 400)
        return
    assert raw is not None

    if len(raw) > MAX_BODY_IN:
        _send_json(handler, {"ok": False, "error": "payload trop volumineux"}, 400)
        return

    sock: socket.socket | None = None
    try:
        sock = socket.create_connection((ip_str, port), timeout=timeout_sec)
        sock.settimeout(timeout_sec)
        if raw:
            sock.sendall(raw)
        received = b""
        if read_max > 0:
            while len(received) < read_max:
                try:
                    chunk = sock.recv(min(65536, read_max - len(received)))
                except socket.timeout:
                    break
                if not chunk:
                    break
                received += chunk
                if len(received) >= read_max:
                    break
    except OSError as e:
        _send_json(handler, {"ok": False, "error": f"TCP : {e!s}"})
        return
    finally:
        if sock:
            try:
                sock.close()
            except OSError:
                pass

    hex_out = received.hex()
    try:
        ascii_preview = received.decode("utf-8", errors="replace")
    except Exception:
        ascii_preview = ""

    _send_json(
        handler,
        {
            "ok": True,
            "tcp": {
                "bytes_received": len(received),
                "hex": hex_out,
                "text_preview": ascii_preview,
                "read_truncated": len(received) >= read_max and read_max > 0,
            },
        },
    )
