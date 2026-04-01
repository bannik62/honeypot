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
import urllib.parse
import urllib.error
import urllib.request
import http.client
from html.parser import HTMLParser
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse, urljoin

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
_LAB_SEM_GOD: threading.BoundedSemaphore | None = None

_LAB_SESSIONS: dict[str, tuple[CookieJar, float]] = {}
_LAB_SESSIONS_LOCK = threading.Lock()


def _lab_sessions_ttl_sec() -> int:
    raw = (CONFIG.get("LAB_SESSION_TTL_SEC") or "1800").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 1800
    return max(60, min(n, 24 * 3600))


def _lab_sessions_wipe_old(now: float) -> None:
    ttl = _lab_sessions_ttl_sec()
    dead = [k for k, (_jar, ts) in _LAB_SESSIONS.items() if (now - ts) > ttl]
    for k in dead:
        _LAB_SESSIONS.pop(k, None)


def _lab_get_cookiejar(session_id: str) -> CookieJar:
    now = time.time()
    with _LAB_SESSIONS_LOCK:
        _lab_sessions_wipe_old(now)
        jar, _ts = _LAB_SESSIONS.get(session_id, (CookieJar(), now))
        _LAB_SESSIONS[session_id] = (jar, now)
        return jar


def _lab_max_concurrency() -> int:
    raw = (CONFIG.get("LAB_MAX_CONCURRENCY") or CONFIG.get("LAB_CONCURRENCY") or "10").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 10
    return max(1, min(n, 200))


def _lab_god_max_concurrency() -> int:
    raw = (CONFIG.get("LAB_GOD_MAX_CONCURRENCY") or "").strip()
    if not raw:
        return _lab_max_concurrency()
    try:
        n = int(raw)
    except ValueError:
        n = _lab_max_concurrency()
    return max(1, min(n, 500))


def _lab_god_max_per_minute() -> int:
    raw = (CONFIG.get("LAB_GOD_RATE_PER_MINUTE") or CONFIG.get("LAB_GOD_RATE_PER_MIN") or "").strip()
    if not raw:
        return _lab_max_per_minute()
    try:
        n = int(raw)
    except ValueError:
        n = _lab_max_per_minute()
    return max(5, min(n, 5000))


def _lab_sem() -> threading.BoundedSemaphore:
    global _LAB_SEM
    if _LAB_SEM is None:
        _LAB_SEM = threading.BoundedSemaphore(_lab_max_concurrency())
    return _LAB_SEM


def _lab_sem_god() -> threading.BoundedSemaphore:
    global _LAB_SEM_GOD
    if _LAB_SEM_GOD is None:
        _LAB_SEM_GOD = threading.BoundedSemaphore(_lab_god_max_concurrency())
    return _LAB_SEM_GOD


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


def _lab_rate_ok(handler, cap: int | None = None) -> bool:
    try:
        client = handler.client_address[0] if getattr(handler, "client_address", None) else "unknown"
    except Exception:
        client = "unknown"
    minute_epoch = int(time.time() // 60)
    with _RATE_LOCK:
        _lab_rate_wipe_old(minute_epoch)
        key = (str(client), minute_epoch)
        cap = int(cap if cap is not None else _lab_max_per_minute())
        cur = _RATE_BUCKET.get(key, 0) + 1
        if cur > cap:
            return False
        _RATE_BUCKET[key] = cur
        return True


def _lab_limits_mode(god: bool, payload: dict[str, Any] | None) -> str:
    if not god:
        return "strict"
    raw = ""
    if payload:
        raw = str(payload.get("limits_mode") or "").strip().lower()
    if raw in ("strict", "boost", "off"):
        return raw
    return "strict"


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


def _send_err(
    handler,
    *,
    status: int,
    kind: str,
    error: str,
    details: dict[str, Any] | None = None,
    retry_after_sec: int | None = None,
) -> None:
    payload: dict[str, Any] = {"ok": False, "kind": kind, "error": error}
    if details:
        payload["details"] = details
    if retry_after_sec is not None:
        payload["retry_after_sec"] = int(max(1, retry_after_sec))
    _send_json(handler, payload, status)


def _retry_after_to_next_minute_sec() -> int:
    return int(max(1, 60 - (time.time() % 60)))


def _classify_urlerror_reason(reason: Any) -> tuple[str, str]:
    # urllib.error.URLError.reason can be a string, OSError, or ssl.SSLError.
    if isinstance(reason, ssl.SSLError):
        return "tls", f"Erreur TLS : {reason!s}"
    s = str(reason or "")
    low = s.lower()
    if "certificate verify failed" in low or "certificat" in low:
        return "tls", f"Erreur TLS : {s}"
    return "network", f"Erreur réseau : {s}"


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


def _replace_resolved_ip_netloc_with_hostname(
    target: str,
    logical_url: str,
    resolved_ip: str,
) -> str:
    """Si target pointe vers l’IPv4 résolue (GOD) alors que logical_url est un hostname, réécrit le netloc."""
    try:
        t = urlparse(target)
        if t.hostname != resolved_ip:
            return target
        l = urlparse(logical_url)
        lhn = l.hostname
        if not lhn:
            return target
        try:
            ipaddress.ip_address(lhn)
            return target
        except ValueError:
            pass
        if t.port and not ((t.scheme == "https" and t.port == 443) or (t.scheme == "http" and t.port == 80)):
            netloc = f"{lhn}:{t.port}"
        else:
            netloc = lhn
        return urlunparse((t.scheme, netloc, t.path, t.params, t.query, t.fragment))
    except Exception:
        return target


def _ipv4_allowed(ip: str, allowed: set[str]) -> bool:
    return ip in allowed


def _normalize_lab_http_url(url: str) -> str:
    """Sans schéma, urllib met le domaine dans path → hostname vide. On préfixe https://."""
    u = url.strip()
    if not u:
        return u
    if "://" not in u:
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


class _HttpsConnectionWithSni(http.client.HTTPSConnection):
    """HTTPSConnection that forces SNI hostname (vhosts over IP)."""

    def __init__(self, host, port=None, *, sni_hostname: str | None = None, **kwargs):
        self._sni_hostname = sni_hostname
        super().__init__(host, port=port, **kwargs)

    def connect(self):
        # Based on http.client.HTTPSConnection.connect (stdlib)
        sock = socket.create_connection(
            (self.host, self.port),
            self.timeout,
            self.source_address,
        )
        if self._tunnel_host:
            self.sock = sock
            self._tunnel()
        server_hostname = self._sni_hostname or self.host
        self.sock = self._context.wrap_socket(sock, server_hostname=server_hostname)


class _HttpsHandlerWithSni(urllib.request.HTTPSHandler):
    """HTTPS handler that forces SNI hostname (for vhosts over IP)."""

    def __init__(self, context: ssl.SSLContext, sni_hostname: str | None):
        super().__init__(context=context)
        self._sni = sni_hostname

    def https_open(self, req):
        sni = self._sni

        def _conn(host, **kwargs):
            # urllib passes host as 'host:port' sometimes; do_open handles port separately in kwargs.
            return _HttpsConnectionWithSni(host, sni_hostname=sni, **kwargs)

        return self.do_open(_conn, req)


class _LabHtmlExtract(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden_fields: dict[str, str] = {}
        self.form_fields: list[dict[str, str]] = []
        self.csrf_meta_token: str | None = None
        self.csrf_meta_param: str | None = None
        self.authenticity_token: str | None = None
        self.csrf_hidden_token: str | None = None
        self.csrf_hidden_name: str | None = None
        self.textareas: list[dict[str, str]] = []
        self.selects: list[dict[str, str]] = []
        self.submit_fields: list[dict[str, str]] = []
        self._first_form_action: str | None = None
        self._first_form_method: str | None = None
        self._cur_textarea_name: str | None = None
        self._cur_textarea_buf: list[str] | None = None
        self._cur_select_name: str | None = None
        self._cur_select_value: str | None = None
        self._cur_select_has_selected: bool = False
        self._cur_option_value: str | None = None
        self._cur_option_selected: bool = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            name = (a.get("name") or "").strip().lower()
            if name == "csrf-token":
                v = a.get("content")
                if v:
                    self.csrf_meta_token = str(v)
            elif name == "csrf-param":
                v = a.get("content")
                if v:
                    self.csrf_meta_param = str(v)
            return

        if tag == "form" and self._first_form_action is None:
            act = a.get("action")
            if act:
                self._first_form_action = str(act)
            m = a.get("method")
            if m:
                self._first_form_method = str(m).strip().upper()
            return

        if tag == "input":
            name = a.get("name")
            if not name:
                return
            name = str(name)
            typ = str(a.get("type") or "").strip().lower()
            val = a.get("value")
            if name == "authenticity_token" and val is not None:
                self.authenticity_token = str(val)
            # CSRF hidden field names seen in common frameworks
            # Django: csrfmiddlewaretoken, Laravel/Symfony: _token, ASP.NET: __RequestVerificationToken, Spring: _csrf
            if val is not None and name in ("csrfmiddlewaretoken", "_token", "__RequestVerificationToken", "_csrf"):
                self.csrf_hidden_name = name
                self.csrf_hidden_token = str(val)
            if typ == "hidden" and val is not None:
                self.hidden_fields[name] = str(val)
                return
            # Capture des champs de formulaire usuels (login/pwd/etc.) pour préremplir les clés.
            if typ in ("text", "email", "password", "tel", "number", "search", "url"):
                self.form_fields.append(
                    {
                        "name": name,
                        "type": typ,
                        "value": "" if val is None else str(val),
                    }
                )
                return
            # Boutons submit utiles (ex: commit=Sign in)
            if typ in ("submit", "button", "image"):
                if val is None:
                    return
                self.submit_fields.append({"name": name, "type": typ, "value": str(val)})
                return
            return

        if tag == "textarea":
            nm = a.get("name")
            if not nm:
                return
            self._cur_textarea_name = str(nm)
            self._cur_textarea_buf = []
            return

        if tag == "select":
            nm = a.get("name")
            if not nm:
                return
            self._cur_select_name = str(nm)
            self._cur_select_value = None
            self._cur_select_has_selected = False
            return

        if tag == "option" and self._cur_select_name:
            self._cur_option_selected = "selected" in a
            v = a.get("value")
            self._cur_option_value = None if v is None else str(v)
            # If selected and value already known, we can set immediately (text may come later though).
            if self._cur_option_selected and self._cur_option_value is not None:
                self._cur_select_value = self._cur_option_value
                self._cur_select_has_selected = True
            return

        if tag == "button":
            typ = str(a.get("type") or "").strip().lower()
            if typ and typ != "submit":
                return
            nm = a.get("name")
            val = a.get("value")
            if nm and val is not None:
                self.submit_fields.append({"name": str(nm), "type": "button", "value": str(val)})
            return

    def handle_data(self, data: str) -> None:
        if self._cur_textarea_buf is not None:
            self._cur_textarea_buf.append(data)
            return
        if self._cur_select_name and self._cur_option_selected and self._cur_option_value is None:
            # option selected but no explicit value -> fallback to its text content
            t = (data or "").strip()
            if t:
                self._cur_select_value = t
                self._cur_select_has_selected = True
            return

    def handle_endtag(self, tag: str) -> None:
        if tag == "textarea" and self._cur_textarea_name and self._cur_textarea_buf is not None:
            txt = "".join(self._cur_textarea_buf)
            self.textareas.append({"name": self._cur_textarea_name, "value": txt})
            self._cur_textarea_name = None
            self._cur_textarea_buf = None
            return
        if tag == "select" and self._cur_select_name:
            self.selects.append(
                {
                    "name": self._cur_select_name,
                    "value": "" if self._cur_select_value is None else str(self._cur_select_value),
                }
            )
            self._cur_select_name = None
            self._cur_select_value = None
            self._cur_select_has_selected = False
            return
        if tag == "option":
            # For non-selected options without value, we don't store anything. For selected without explicit value,
            # handle_data sets it from the text.
            self._cur_option_value = None
            self._cur_option_selected = False
            return


def _extract_html_fields(base_url: str, body_text: str) -> dict[str, Any]:
    p = _LabHtmlExtract()
    try:
        p.feed(body_text)
    except Exception:
        return {}
    form_action = None
    if p._first_form_action:
        form_action = urljoin(base_url, p._first_form_action)
    return {
        "form_action": form_action,
        "form_method": p._first_form_method or None,
        "hidden_fields": p.hidden_fields,
        "form_fields": p.form_fields,
        "textareas": p.textareas,
        "selects": p.selects,
        "submit_fields": p.submit_fields,
        "csrf": {
            "authenticity_token": p.authenticity_token,
            "csrf_token_meta": p.csrf_meta_token,
            "csrf_param_meta": p.csrf_meta_param,
            "hidden_name": p.csrf_hidden_name,
            "hidden_token": p.csrf_hidden_token,
        },
    }


def _cookies_as_kv(jar: CookieJar) -> list[str]:
    out: list[str] = []
    for c in jar:
        try:
            out.append(f"{c.name}={c.value}")
        except Exception:
            continue
    return out


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
    try:
        god = _is_god_mode(handler)
        allowed = get_allowed_ipv4s()
        payload = _read_json_body(handler)
        if not payload:
            _send_err(handler, status=400, kind="input", error="JSON invalide ou trop volumineux")
            return

        limits_mode = _lab_limits_mode(god, payload)
        if limits_mode != "off":
            sem = _lab_sem_god() if limits_mode == "boost" else _lab_sem()
            if not sem.acquire(blocking=False):
                _send_err(
                    handler,
                    status=429,
                    kind="concurrency",
                    error="Trop de requêtes LAB en parallèle. Réessayez dans quelques secondes.",
                    retry_after_sec=3,
                )
                return
            sem_acquired = True
        else:
            sem = None
            sem_acquired = False

        if limits_mode != "off":
            cap = _lab_god_max_per_minute() if limits_mode == "boost" else None
            if not _lab_rate_ok(handler, cap=cap):
                retry_after = _retry_after_to_next_minute_sec()
                _send_err(
                    handler,
                    status=429,
                    kind="rate",
                    error=f"Limite LAB atteinte (requêtes par minute). Réessayez dans {retry_after} s.",
                    retry_after_sec=retry_after,
                )
                return

        method = str(payload.get("method", "GET")).strip().upper()
        if method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"):
            _send_err(
                handler,
                status=400,
                kind="input",
                error="Méthode HTTP non supportée",
                details={"allowed_methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]},
            )
            return

        url = _normalize_lab_http_url(str(payload.get("url", "")))
        if not url or len(url) > 4096:
            _send_err(handler, status=400, kind="input", error="URL manquante ou trop longue")
            return

        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            _send_err(handler, status=400, kind="input", error="Schéma autorisé : http ou https")
            return

        host = parsed.hostname
        if not host:
            _send_err(handler, status=400, kind="input", error="Hôte manquant dans l’URL")
            return
        if host in ("http", "https"):
            _send_err(
                handler,
                status=400,
                kind="input",
                error="URL invalide : indiquez un domaine ou une IP (ex. https://codeurbase.fr). « http » ou « https » seul n’est pas une adresse.",
            )
            return

        # URL affichée côté client / préremplissage (avant réécriture éventuelle en IP pour la socket).
        logical_url = url

        host_for_header: str | None = None
        ip_str: str | None = None
        try:
            ip_obj = ipaddress.ip_address(host)
        except ValueError:
            ip_obj = None

        if ip_obj is not None:
            if ip_obj.version != 4:
                _send_err(handler, status=400, kind="input", error="IPv6 non supporté (IPv4 uniquement).")
                return
            ip_str = str(ip_obj)
        else:
            if not god:
                _send_err(
                    handler,
                    status=400,
                    kind="forbidden",
                    error="Nom DNS dans l’URL non autorisé. Utilisez une IPv4 littérale.",
                    details={"host": host},
                )
                return

            # En mode GOD, on résout le nom d'hôte vers la première IPv4 trouvée,
            # sans vérifier si elle est dans la liste autorisée.
            try:
                infos = socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_STREAM)
                if not infos:
                    _send_err(
                        handler,
                        status=403,
                        kind="dns",
                        error=f"Impossible de résoudre le nom d'hôte : {host}",
                        details={"host": host},
                    )
                    return
                # On prend la première IPv4 retournée
                ip_str = infos[0][4][0]
                host_for_header = host
                url = _url_with_ip_netloc(parsed, ip_str)
            except OSError:
                _send_err(
                    handler,
                    status=403,
                    kind="dns",
                    error=f"Erreur de résolution DNS pour {host}",
                    details={"host": host},
                )
                return

        assert ip_str is not None

        # IPv4 littérale : whitelist. DNS + GOD : pas de filtre sur l’IP résolue (ip_str déjà défini ci-dessus).
        if ip_obj is not None and not _ipv4_allowed(ip_str, allowed):
            _send_err(
                handler,
                status=403,
                kind="forbidden",
                error=f"IP non autorisée : {ip_str}. Vérifiez data/screenshotAndLog/<ip>/ ou LAB_ALLOW_IPS.",
                details={"ip": ip_str},
            )
            return

        hdrs, herr = _parse_headers_dict(payload.get("headers"))
        if herr:
            _send_err(handler, status=400, kind="input", error=herr)
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
                _send_err(handler, status=400, kind="input", error="body doit être une chaîne")
                return
            data = body_raw.encode("utf-8")
            if len(data) > MAX_BODY_IN:
                _send_err(handler, status=400, kind="input", error="Corps de requête trop volumineux")
                return

        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        follow_redirects = bool(payload.get("follow_redirects"))
        session_id = str(payload.get("session_id") or "").strip()
        extract_prefill = bool(payload.get("extract_prefill"))

        # SNI: si on se connecte en IP pour un vhost HTTPS, il faut garder le hostname en SNI,
        # sinon Apache/Nginx peut renvoyer 421 (misdirected request).
        sni_host: str | None = None
        if parsed.scheme == "https":
            # Priorité : override Host (si hostname) puis hostname DNS original (host_for_header).
            cand = override or host_for_header
            if cand:
                try:
                    ipaddress.ip_address(cand)
                    cand_is_ip = True
                except ValueError:
                    cand_is_ip = False
                if not cand_is_ip:
                    sni_host = cand

        handlers: list[Any] = [_HttpsHandlerWithSni(context=ctx, sni_hostname=sni_host)]
        if not follow_redirects:
            handlers.insert(0, _NoRedirect)
        jar: CookieJar | None = None
        if session_id:
            jar = _lab_get_cookiejar(session_id)
            handlers.append(urllib.request.HTTPCookieProcessor(jar))
        opener = urllib.request.build_opener(*handlers)

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
            kind, msg = _classify_urlerror_reason(getattr(e, "reason", None))
            _send_err(
                handler,
                status=502,
                kind=kind,
                error=msg,
                details={
                    "logical_url": logical_url,
                    "request_url": url,
                    "resolved_ipv4": ip_str,
                },
            )
            return
        except Exception as e:
            _send_err(handler, status=500, kind="internal", error=str(e))
            return

        truncated = len(chunk) > MAX_HTTP_RESPONSE
        if truncated:
            chunk = chunk[:MAX_HTTP_RESPONSE]

        try:
            body_text = chunk.decode("utf-8")
        except UnicodeDecodeError:
            body_text = chunk.decode("utf-8", errors="replace")

        extracted: dict[str, Any] | None = None
        prefill: dict[str, Any] | None = None
        if extract_prefill:
            ctype = (resp_headers.get("Content-Type") or resp_headers.get("content-type") or "").lower()
            if ("text/html" in ctype) or ("<html" in body_text.lower()) or ("<form" in body_text.lower()):
                extracted = _extract_html_fields(logical_url, body_text)
                if extracted:
                    hidden = extracted.get("hidden_fields") or {}
                    # Rails: include authenticity_token and utf8 if present
                    body_fields = dict(hidden) if isinstance(hidden, dict) else {}
                    # Ajoute aussi les champs de formulaire "visibles" (login/pwd/etc.) avec valeurs vides,
                    # pour que l'utilisateur n'ait pas à deviner les clés.
                    ff = extracted.get("form_fields") or []
                    if isinstance(ff, list):
                        for f in ff:
                            if not isinstance(f, dict):
                                continue
                            nm = f.get("name")
                            if not nm or nm in body_fields:
                                continue
                            body_fields[str(nm)] = ""
                    csrf = extracted.get("csrf") or {}
                    atok = csrf.get("authenticity_token") if isinstance(csrf, dict) else None
                    if atok and "authenticity_token" not in body_fields:
                        body_fields["authenticity_token"] = atok
                    # Other frameworks: csrfmiddlewaretoken / _token / __RequestVerificationToken / _csrf
                    if isinstance(csrf, dict):
                        hname = csrf.get("hidden_name")
                        htok = csrf.get("hidden_token")
                        if hname and htok and str(hname) not in body_fields:
                            body_fields[str(hname)] = str(htok)

                    tas = extracted.get("textareas") or []
                    if isinstance(tas, list):
                        for t in tas:
                            if not isinstance(t, dict):
                                continue
                            nm = t.get("name")
                            if not nm or nm in body_fields:
                                continue
                            body_fields[str(nm)] = str(t.get("value") or "")

                    sels = extracted.get("selects") or []
                    if isinstance(sels, list):
                        for s in sels:
                            if not isinstance(s, dict):
                                continue
                            nm = s.get("name")
                            if not nm or nm in body_fields:
                                continue
                            body_fields[str(nm)] = str(s.get("value") or "")

                    subs = extracted.get("submit_fields") or []
                    if isinstance(subs, list):
                        for sf in subs:
                            if not isinstance(sf, dict):
                                continue
                            nm = sf.get("name")
                            val = sf.get("value")
                            if not nm or val is None or nm in body_fields:
                                continue
                            body_fields[str(nm)] = str(val)
                    post_url = extracted.get("form_action") or logical_url
                    post_url = _replace_resolved_ip_netloc_with_hostname(post_url, logical_url, ip_str)
                    pl = urlparse(logical_url)
                    origin_host = pl.hostname or host
                    origin = f"{pl.scheme}://{origin_host}" if origin_host else f"{parsed.scheme}://{host}"
                    headers_out = {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Origin": origin,
                        "Referer": logical_url,
                    }
                    # If meta csrf token exists, also suggest X-CSRF-Token (some apps use it)
                    mtok = csrf.get("csrf_token_meta") if isinstance(csrf, dict) else None
                    if mtok:
                        headers_out["X-CSRF-Token"] = str(mtok)
                    prefill = {"post_url": post_url, "headers": headers_out, "body_fields": body_fields}

        http_obj: dict[str, Any] = {
            "status": status,
            "headers": resp_headers,
            "body_text": body_text,
            "body_length": len(chunk),
            "truncated": truncated,
            "request_url": url,
            "logical_url": logical_url,
            "resolved_ipv4": ip_str,
            "dns_used": bool(host_for_header),
            "god_mode": god,
            "follow_redirects": follow_redirects,
        }
        if sni_host is not None:
            http_obj["sni_hostname"] = sni_host
        if jar is not None:
            http_obj["session"] = {"session_id": session_id, "cookies": _cookies_as_kv(jar)}
        if extracted is not None:
            http_obj["extracted"] = extracted
        if prefill is not None:
            http_obj["prefill"] = prefill

        http_obj["limits_mode"] = limits_mode
        _send_json(handler, {"ok": True, "http": http_obj})
    finally:
        if "sem" in locals() and sem is not None and locals().get("sem_acquired"):
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
    try:
        god = _is_god_mode(handler)
        allowed = get_allowed_ipv4s()
        payload = _read_json_body(handler)
        if not payload:
            _send_err(handler, status=400, kind="input", error="JSON invalide ou trop volumineux")
            return

        limits_mode = _lab_limits_mode(god, payload)
        if limits_mode != "off":
            sem = _lab_sem_god() if limits_mode == "boost" else _lab_sem()
            if not sem.acquire(blocking=False):
                _send_err(
                    handler,
                    status=429,
                    kind="concurrency",
                    error="Trop de requêtes LAB en parallèle. Réessayez dans quelques secondes.",
                    retry_after_sec=3,
                )
                return
            sem_acquired = True
        else:
            sem = None
            sem_acquired = False

        if limits_mode != "off":
            cap = _lab_god_max_per_minute() if limits_mode == "boost" else None
            if not _lab_rate_ok(handler, cap=cap):
                retry_after = _retry_after_to_next_minute_sec()
                _send_err(
                    handler,
                    status=429,
                    kind="rate",
                    error=f"Limite LAB atteinte (requêtes par minute). Réessayez dans {retry_after} s.",
                    retry_after_sec=retry_after,
                )
                return

        host = str(payload.get("host", "")).strip()
        if not host:
            _send_err(handler, status=400, kind="input", error="host manquant")
            return

        ip_str: str | None = None
        try:
            ip_obj = ipaddress.ip_address(host)
        except ValueError:
            ip_obj = None

        if ip_obj is not None:
            if ip_obj.version != 4:
                _send_err(handler, status=400, kind="input", error="IPv6 non supporté (IPv4 uniquement).")
                return
            ip_str = str(ip_obj)
        else:
            if not god:
                _send_err(
                    handler,
                    status=400,
                    kind="forbidden",
                    error="Host non-IPv4 non autorisé. Utilisez une IPv4 littérale.",
                    details={"host": host},
                )
                return

            # En mode GOD, on résout le nom d'hôte vers la première IPv4 trouvée,
            # sans vérifier si elle est dans la liste autorisée.
            try:
                infos = socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_STREAM)
                if not infos:
                    _send_err(
                        handler,
                        status=403,
                        kind="dns",
                        error=f"Impossible de résoudre le nom d'hôte : {host}",
                        details={"host": host},
                    )
                    return
                ip_str = infos[0][4][0]
            except OSError:
                _send_err(
                    handler,
                    status=403,
                    kind="dns",
                    error=f"Erreur de résolution DNS pour {host}",
                    details={"host": host},
                )
                return

        assert ip_str is not None

        if ip_obj is not None and not _ipv4_allowed(ip_str, allowed):
            _send_err(
                handler,
                status=403,
                kind="forbidden",
                error=f"IP non autorisée : {ip_str}",
                details={"ip": ip_str},
            )
            return

        try:
            port = int(payload.get("port", 0))
        except (TypeError, ValueError):
            port = 0
        if port < 1 or port > 65535:
            _send_err(handler, status=400, kind="input", error="port invalide (1-65535)")
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
            _send_err(handler, status=400, kind="input", error="payload doit être une chaîne")
            return

        raw, err = _decode_tcp_payload(body_str, str(payload.get("payload_encoding", "text")))
        if err:
            _send_err(handler, status=400, kind="input", error=err)
            return
        if raw is None:
            _send_err(handler, status=400, kind="input", error="payload décodé vide")
            return

        if len(raw) > MAX_BODY_IN:
            _send_err(handler, status=400, kind="input", error="payload trop volumineux")
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
            _send_err(
                handler,
                status=502,
                kind="network",
                error=f"TCP : {e!s}",
                details={"host": host, "resolved_ipv4": ip_str, "port": port, "timeout_sec": timeout_sec},
            )
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
        if "sem" in locals() and sem is not None and locals().get("sem_acquired"):
            sem.release()
