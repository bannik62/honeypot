#!/usr/bin/env python3
"""
routes/lab.py — LAB (étude) : requêtes HTTP et envoi TCP depuis le serveur.

IPv4 littérales : autorisées seulement si présentes dans la liste (dossiers
data/screenshotAndLog/<ip>/ + LAB_ALLOW_IPS + 127.0.0.1).

Mode « GOD » (header X-Lab-God) : un nom DNS dans l’URL ou l’hôte est résolu vers
la première IPv4 ; cette IP n’est pas filtrée par la whitelist (responsabilité de
l’opérateur). Pas d’usage contre des tiers sans autorisation.
"""

from __future__ import annotations

import ipaddress
import json
import re
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

from config import CONFIG, IP_RE, ROOT, SCAN_DIR, VISUALIZER_DIR

MAX_BODY_IN = 512 * 1024
MAX_HTTP_RESPONSE = 2 * 1024 * 1024
MAX_TCP_READ = 256 * 1024
HTTP_TIMEOUT = 28
TCP_TIMEOUT_MAX = 60

_PRESET_WEB = VISUALIZER_DIR / "lab" / "presets-web.json"
_PRESET_TCP = VISUALIZER_DIR / "lab" / "presets-tcp.json"

# Rate-limit par client (IP du navigateur / tunnel) : compteur par minute calendaire
_RATE_BUCKET: dict[tuple[str, int], int] = {}
_RATE_LOCK = threading.Lock()

_LAB_SEM: threading.BoundedSemaphore | None = None

_RFC1918_NETS = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
)
_LINK_LOCAL_NET = ipaddress.ip_network("169.254.0.0/16")


def _lab_max_concurrency() -> int:
    raw = (CONFIG.get("LAB_MAX_CONCURRENCY") or CONFIG.get("LAB_CONCURRENCY") or "10").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 10
    return max(1, min(n, 200))


def _lab_sem() -> threading.BoundedSemaphore:
    global _LAB_SEM
    if _LAB_SEM is None:
        _LAB_SEM = threading.BoundedSemaphore(_lab_max_concurrency())
    return _LAB_SEM


def _lab_allow_private_ipv4() -> bool:
    raw = str(CONFIG.get("LAB_ALLOW_PRIVATE") or CONFIG.get("LAB_ALLOW_PRIVATE_IPV4") or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _is_private_or_link_local_ipv4(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    if ip.version != 4:
        return False
    return any(ip in n for n in _RFC1918_NETS) or (ip in _LINK_LOCAL_NET)


def _lab_max_per_minute() -> int:
    raw = (CONFIG.get("LAB_RATE_PER_MINUTE") or CONFIG.get("LAB_RATE_PER_MIN") or "60").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 60
    return max(5, min(n, 600))


def _lab_rate_wipe_old(minute_epoch: int) -> None:
    keys = [k for k in _RATE_BUCKET if k[1] < minute_epoch - 1]
    for k in keys:
        del _RATE_BUCKET[k]


def _lab_rate_ok(handler) -> bool:
    try:
        client = handler.client_address[0] if getattr(handler, "client_address", None) else "unknown"
    except Exception:
        client = "unknown"
    minute_epoch = int(time.time() // 60)
    with _RATE_LOCK:
        _lab_rate_wipe_old(minute_epoch)
        key = (str(client), minute_epoch)
        cap = _lab_max_per_minute()
        cur = _RATE_BUCKET.get(key, 0) + 1
        if cur > cap:
            return False
        _RATE_BUCKET[key] = cur
        return True


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
    """IPs autorisées : 127.0.0.1, dossiers data/screenshotAndLog/<ip>/ (attaquants), LAB_ALLOW_IPS.

    On n'utilise pas connections.csv ni data.json enrichi (traceroute, etc.) pour éviter d'autoriser de l'infra par erreur.
    """
    s: set[str] = {"127.0.0.1"}
    try:
        if SCAN_DIR.is_dir():
            for p in SCAN_DIR.iterdir():
                if not p.is_dir():
                    continue
                name = p.name.strip()
                if name and IP_RE.match(name):
                    s.add(name)
    except OSError:
        pass
    extra = (CONFIG.get("LAB_ALLOW_IPS") or "").strip()
    for part in extra.split(","):
        p = part.strip()
        if p and IP_RE.match(p):
            s.add(p)
    return s


def _is_god_mode(handler) -> bool:
    try:
        v = (handler.headers.get("X-Lab-God", "") or "").strip().lower()
    except Exception:
        v = ""
    return v in ("1", "true", "yes", "on")


_HOST_HEADER_RE = re.compile(r"^[a-zA-Z0-9._-]{1,253}$")


def _sanitize_host_header(raw: Any) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or len(s) > 253:
        return None
    if not _HOST_HEADER_RE.match(s):
        return None
    return s


def _url_with_ip_netloc(parsed, ip_str: str) -> str:
    """Recolle une URL avec l'hôte = IPv4 (port conservé)."""
    port = parsed.port
    if port is None:
        netloc = ip_str
    else:
        netloc = f"{ip_str}:{port}"
    return urlunparse(
        (parsed.scheme, netloc, parsed.path or "", parsed.params, parsed.query, parsed.fragment)
    )


def _ipv4_allowed(ip: str, allowed: set[str]) -> bool:
    return ip in allowed


def _normalize_lab_http_url(url: str) -> str:
    """Sans schéma, urllib met le domaine dans path → hostname vide. On préfixe https://."""
    u = url.strip()
    if not u:
        return u
    if "://" not in u:
        # "https" seul → ne pas produire https://https (hostname invalide, DNS pour « https »)
        low = u.lower().rstrip("/")
        if low in ("http", "https"):
            return u
        return f"https://{u}"
    return u


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
            "scan_dir": str(SCAN_DIR),
            "scan_dir_exists": SCAN_DIR.is_dir(),
            "god_mode_header": _is_god_mode(handler),
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
    sem = _lab_sem()
    if not sem.acquire(blocking=False):
        _send_json(
            handler,
            {"ok": False, "error": "Trop de requêtes LAB en parallèle. Réessayez dans quelques secondes."},
            429,
        )
        return
    try:
        if not _lab_rate_ok(handler):
            _send_json(
                handler,
                {"ok": False, "error": "Limite LAB atteinte (requêtes par minute). Réessayez plus tard."},
                429,
            )
            return

        god = _is_god_mode(handler)
        allowed = get_allowed_ipv4s()
        payload = _read_json_body(handler)
        if not payload:
            _send_json(handler, {"ok": False, "error": "JSON invalide ou trop volumineux"}, 400)
            return

        method = str(payload.get("method", "GET")).strip().upper()
        if method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"):
            _send_json(handler, {"ok": False, "error": "Méthode HTTP non supportée"}, 400)
            return

        url = _normalize_lab_http_url(str(payload.get("url", "")))
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
        if host in ("http", "https"):
            _send_json(
                handler,
                {
                    "ok": False,
                    "error": "URL invalide : indiquez un domaine ou une IP (ex. https://codeurbase.fr). « http » ou « https » seul n’est pas une adresse.",
                },
                400,
            )
            return

        host_for_header: str | None = None
        ip_str: str | None = None
        try:
            ip_obj = ipaddress.ip_address(host)
        except ValueError:
            ip_obj = None

        if ip_obj is not None:
            if ip_obj.version != 4:
                _send_json(handler, {"ok": False, "error": "IPv6 non supporté (IPv4 uniquement)."}, 400)
                return
            ip_str = str(ip_obj)
        else:
            if not god:
                _send_json(
                    handler,
                    {
                        "ok": False,
                        "error": "Nom DNS dans l’URL : activez le mode GOD (Konami) côté LAB, ou utilisez une IPv4 littérale.",
                    },
                    400,
                )
                return

            # En mode GOD, on résout le nom d'hôte vers la première IPv4 trouvée,
            # sans vérifier si elle est dans la liste autorisée.
            try:
                infos = socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_STREAM)
                if not infos:
                    _send_json(handler, {"ok": False, "error": f"Impossible de résoudre le nom d'hôte : {host}"}, 403)
                    return
                # On prend la première IPv4 retournée
                ip_str = infos[0][4][0]
                host_for_header = host
                url = _url_with_ip_netloc(parsed, ip_str)
            except OSError:
                _send_json(handler, {"ok": False, "error": f"Erreur de résolution DNS pour {host}"}, 403)
                return

        assert ip_str is not None

        # IPv4 littérale : whitelist. DNS + GOD : pas de filtre sur l’IP résolue (ip_str déjà défini ci-dessus).
        if ip_obj is not None and not _ipv4_allowed(ip_str, allowed):
            _send_json(
                handler,
                {
                    "ok": False,
                    "error": f"IP non autorisée : {ip_str}. Vérifiez data/screenshotAndLog/<ip>/ ou LAB_ALLOW_IPS.",
                },
                403,
            )
            return

        if not _lab_allow_private_ipv4() and _is_private_or_link_local_ipv4(ip_str):
            _send_json(
                handler,
                {
                    "ok": False,
                    "error": f"IPv4 privée / link-local refusée par sécurité : {ip_str}. (Activez LAB_ALLOW_PRIVATE=1 pour autoriser.)",
                },
                403,
            )
            return

        hdrs, herr = _parse_headers_dict(payload.get("headers"))
        if herr:
            _send_json(handler, {"ok": False, "error": herr}, 400)
            return
        assert hdrs is not None

        override = _sanitize_host_header(payload.get("host_header"))
        if override is not None:
            hdrs["Host"] = override
        elif host_for_header is not None:
            hdrs["Host"] = host_for_header

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
                    "request_url": url,
                    "resolved_ipv4": ip_str,
                    "dns_used": bool(host_for_header),
                    "god_mode": god,
                },
            },
        )
    finally:
        sem.release()


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
    sem = _lab_sem()
    if not sem.acquire(blocking=False):
        _send_json(
            handler,
            {"ok": False, "error": "Trop de requêtes LAB en parallèle. Réessayez dans quelques secondes."},
            429,
        )
        return
    try:
        if not _lab_rate_ok(handler):
            _send_json(
                handler,
                {"ok": False, "error": "Limite LAB atteinte (requêtes par minute). Réessayez plus tard."},
                429,
            )
            return

        god = _is_god_mode(handler)
        allowed = get_allowed_ipv4s()
        payload = _read_json_body(handler)
        if not payload:
            _send_json(handler, {"ok": False, "error": "JSON invalide ou trop volumineux"}, 400)
            return

        host = str(payload.get("host", "")).strip()
        if not host:
            _send_json(handler, {"ok": False, "error": "host manquant"}, 400)
            return

        ip_str: str | None = None
        try:
            ip_obj = ipaddress.ip_address(host)
        except ValueError:
            ip_obj = None

        if ip_obj is not None:
            if ip_obj.version != 4:
                _send_json(handler, {"ok": False, "error": "IPv6 non supporté (IPv4 uniquement)."}, 400)
                return
            ip_str = str(ip_obj)
        else:
            if not god:
                _send_json(
                    handler,
                    {
                        "ok": False,
                        "error": "Host non-IPv4 : activez le mode GOD (Konami) ou utilisez une IPv4 littérale.",
                    },
                    400,
                )
                return

            # En mode GOD, on résout le nom d'hôte vers la première IPv4 trouvée,
            # sans vérifier si elle est dans la liste autorisée.
            try:
                infos = socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_STREAM)
                if not infos:
                    _send_json(handler, {"ok": False, "error": f"Impossible de résoudre le nom d'hôte : {host}"}, 403)
                    return
                ip_str = infos[0][4][0]
            except OSError:
                _send_json(handler, {"ok": False, "error": f"Erreur de résolution DNS pour {host}"}, 403)
                return

        assert ip_str is not None

        if ip_obj is not None and not _ipv4_allowed(ip_str, allowed):
            _send_json(
                handler,
                {"ok": False, "error": f"IP non autorisée : {ip_str}"},
                403,
            )
            return

        if not _lab_allow_private_ipv4() and _is_private_or_link_local_ipv4(ip_str):
            _send_json(
                handler,
                {
                    "ok": False,
                    "error": f"IPv4 privée / link-local refusée par sécurité : {ip_str}. (Activez LAB_ALLOW_PRIVATE=1 pour autoriser.)",
                },
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
    finally:
        sem.release()
