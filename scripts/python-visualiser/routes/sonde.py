#!/usr/bin/env python3
"""
routes/sonde.py — Sonde tcpdump (SSE) + arrêt subprocess.
Un seul tcpdump actif à la fois (nouvelle connexion tue l’ancien).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlparse

_sonde_lock = threading.Lock()
_sonde_proc: subprocess.Popen | None = None

_VALID_LAYER = frozenset({"L3", "L4", "L7"})
# Filtres autorisés par couche (whitelist)
_FILTERS_L3 = frozenset({"all", "tcp", "udp", "icmp"})
_FILTERS_L4 = frozenset({"syn", "fin", "rst", "synfinrst"})
_FILTERS_L7 = frozenset({"gt50", "gt128"})
_VALID_DIRECTION = frozenset({"both", "in", "out"})

# Lignes de démarrage tcpdump (promiscuous, LINUX_SLL2, etc.) — bruit sans intérêt.
_TCPDUMP_STARTUP_NOISE = re.compile(
    r"(?i)(tcpdump:\s*)?(WARNING:.*promiscuous|"
    r"\(Promiscuous mode not supported|"
    r"data link type LINUX_|"
    r"verbose output suppressed|"
    r"listening on [^,]+, link-type|"
    r"snapshot length \d+ bytes\s*$)",
)

# Noms d’interface autorisés pour -i (pas de shell, argv seul) — évite l’injection.
_IFACE_LITERALS = frozenset({"any", "lo", "docker0"})
_IFACE_REGEX = (
    re.compile(r"^ens\d+$"),
    re.compile(r"^enp\d+s\d+$"),
    re.compile(r"^enx[0-9a-f]{12}$", re.I),
    re.compile(r"^eth\d+$"),
    re.compile(r"^wlan\d+$"),
    re.compile(r"^tun\d+$"),
    re.compile(r"^tap\d+$"),
    re.compile(r"^br-[0-9a-f]{12}$", re.I),
    re.compile(r"^veth[a-z0-9]{4,24}$", re.I),
)


def normalize_sonde_iface(raw: str | None) -> str | None:
    """Retourne le nom d’interface sûr ou None si refusé."""
    s = (raw or "").strip() or "any"
    if len(s) > 32:
        return None
    if not re.match(r"^[a-zA-Z0-9._-]+$", s):
        return None
    if s in _IFACE_LITERALS:
        return s
    for pat in _IFACE_REGEX:
        if pat.match(s):
            return s
    return None


def list_sonde_interfaces() -> list[str]:
    """Interfaces présentes sur l’hôte et autorisées pour la sonde."""
    found: set[str] = set()
    try:
        net = Path("/sys/class/net")
        if net.is_dir():
            for p in net.iterdir():
                n = normalize_sonde_iface(p.name)
                if n is not None and n == p.name:
                    found.add(p.name)
    except OSError:
        pass
    # Toujours proposer les choix usuels même si sysfs vide
    for lit in ("any", "lo", "docker0"):
        found.add(lit)
    return sorted(found, key=lambda x: (0 if x == "any" else 1, x.lower()))


def sonde_iface_role_hint(iface: str) -> str:
    """
    Rôle indicatif d’après le nom (heuristique, pas une vérité matérielle).
    Les noms varient selon les distros ; le texte reste générique.
    """
    if iface == "any":
        return (
            "Toutes les interfaces : vue globale, souvent plus de bruit. "
            "Utile pour explorer sans choisir une carte."
        )
    if iface == "lo":
        return (
            "Loopback : trafic 127.0.0.1 / ::1 sur cet hôte. "
            "Pas le trafic Internet direct ; rarement le trafic des conteneurs sauf config spéciale."
        )
    if iface == "docker0":
        return (
            "Bridge Docker par défaut : échanges hôte ↔ conteneurs sur le réseau classique 172.17.x."
        )
    if re.match(r"^ens\d+$", iface):
        return (
            "Interface Ethernet (nom ens…) : souvent carte principale LAN/WAN sur serveur. "
            "Sur un VPS, typiquement le trafic public entrant (ex. TLS 443)."
        )
    if re.match(r"^enp\d+s\d+$", iface):
        return (
            "Interface Ethernet (nom enp…s…) : même usage qu’une carte physique selon la machine."
        )
    if re.match(r"^eth\d+$", iface):
        return "Interface Ethernet classique (eth…) : LAN/WAN selon ta configuration."
    if re.match(r"^enx[0-9a-f]{12}$", iface, re.I):
        return "Ethernet USB (enx…) : rôle identique à une carte filaire selon le branchement."
    if re.match(r"^wlan\d+$", iface):
        return "Interface Wi-Fi."
    if re.match(r"^br-[0-9a-f]{12}$", iface, re.I):
        return (
            "Bridge Linux : souvent un réseau Docker Compose ou custom. "
            "Trafic entre conteneurs ; parfois la jambe proxy→backend selon Apache/nginx."
        )
    if re.match(r"^veth[a-z0-9]{4,24}$", iface, re.I):
        return (
            "Paire virtuelle hôte ↔ conteneur : trafic d’un conteneur ; le nom seul n’identifie pas le service."
        )
    if re.match(r"^tun\d+$", iface):
        return "Tunnel (souvent VPN)."
    if re.match(r"^tap\d+$", iface):
        return "TAP (VPN ou réseau virtuel)."
    return "Interface réseau Linux : le rôle exact dépend de ton installation (ip -br link, test tcpdump)."


def _kill_sonde_unlocked() -> None:
    global _sonde_proc
    if _sonde_proc is None:
        return
    if _sonde_proc.poll() is not None:
        _sonde_proc = None
        return
    try:
        _sonde_proc.terminate()
        try:
            _sonde_proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            _sonde_proc.kill()
            _sonde_proc.wait(timeout=2)
    except Exception:
        pass
    finally:
        _sonde_proc = None


def _tcp_port(port: str, direction: str, proto: str = "tcp") -> str:
    """Qualifiant de port selon sens (comme In/Out dans la sortie tcpdump)."""
    if direction == "in":
        return f"{proto} and dst port {port}"
    if direction == "out":
        return f"{proto} and src port {port}"
    return f"{proto} and port {port}"


def _build_filter_expr(port: int | None, layer: str, filt: str, direction: str) -> str:
    """Expression tcpdump (sans shell). direction: both | in (dst) | out (src).

    Si port is None (mode exploration), on ignore direction (pas de dst/src port possible).
    """
    if direction not in _VALID_DIRECTION:
        direction = "both"
    if port is None:
        direction = "both"
        p = None
    else:
        p = str(port)

    if layer == "L3":
        # Pas de « not broadcast / not multicast » : avec -i any (LINUX_SLL2),
        # tcpdump renvoie « not a broadcast link » et quitte en erreur (code 1).
        if filt == "all":
            if p is None:
                return "(tcp or udp or icmp)"
            if direction == "both":
                return f"(tcp or udp or icmp) and port {p}"
            if direction == "in":
                return (
                    f"(tcp and dst port {p}) or (udp and dst port {p}) or "
                    f"(icmp and dst port {p})"
                )
            return (
                f"(tcp and src port {p}) or (udp and src port {p}) or "
                f"(icmp and src port {p})"
            )
        if filt == "tcp":
            if p is None:
                return "tcp"
            return _tcp_port(p, direction, "tcp")
        if filt == "udp":
            if p is None:
                return "udp"
            return _tcp_port(p, direction, "udp")
        if filt == "icmp":
            if p is None:
                return "icmp"
            if direction == "both":
                return f"icmp and port {p}"
            if direction == "in":
                return f"icmp and dst port {p}"
            return f"icmp and src port {p}"
    if layer == "L4":
        if filt == "syn":
            flags = "(tcp[tcpflags] & tcp-syn != 0)"
        elif filt == "fin":
            flags = "(tcp[tcpflags] & tcp-fin != 0)"
        elif filt == "rst":
            flags = "(tcp[tcpflags] & tcp-rst != 0)"
        else:  # synfinrst — les trois (OU)
            flags = (
                "(tcp[tcpflags] & tcp-syn != 0) or (tcp[tcpflags] & tcp-fin != 0) or "
                "(tcp[tcpflags] & tcp-rst != 0)"
            )
        if p is None:
            base = "tcp"
        else:
            base = _tcp_port(p, direction, "tcp")
        return f"{base} and ({flags})"
    if layer == "L7":
        if p is None:
            raise ValueError("port")
        gt = "50" if filt == "gt50" else "128"
        base = _tcp_port(p, direction, "tcp")
        return f"{base} and greater {gt}"
    raise ValueError("layer")


def _tcpdump_cmd(
    port: int | None, layer: str, filt: str, direction: str, iface: str
) -> list[str]:
    expr = _build_filter_expr(port, layer, filt, direction)
    cmd = ["sudo", "tcpdump", "-n", "-i", iface, "-l"]
    if layer == "L7":
        cmd.append("-A")
    cmd.append(expr)
    stdbuf = shutil.which("stdbuf")
    if stdbuf:
        return [stdbuf, "-oL", "-eL"] + cmd
    return cmd


def _sse_write(handler, text: str) -> None:
    handler.wfile.write(text.encode("utf-8"))
    handler.wfile.flush()


def serve_sonde_interfaces(handler) -> None:
    """GET /api/sonde/interfaces — liste {name, role} pour le sélecteur UI (infobulle)."""
    names = list_sonde_interfaces()
    items = [{"name": n, "role": sonde_iface_role_hint(n)} for n in names]
    body = json.dumps({"interfaces": items}, ensure_ascii=False).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def serve_sonde_stream(handler) -> None:
    """GET /api/sonde/stream?port=&layer=&filter=&iface=&explore= — SSE.

    explore=1 : mode découverte (pas de port, interface any recommandée).
    """
    global _sonde_proc

    qs = parse_qs(urlparse(handler.path).query)
    layer = (qs.get("layer") or ["L3"])[0].upper()
    filt = (qs.get("filter") or [""])[0] or "all"
    direction = (qs.get("direction") or ["both"])[0].lower()
    explore = (qs.get("explore") or [""])[0] in ("1", "true", "yes", "on")

    port: int | None = None
    if not explore:
        try:
            port_s = (qs.get("port") or [""])[0]
            port = int(port_s)
        except (ValueError, TypeError):
            handler.send_response(400)
            handler.send_header("Content-Type", "text/plain; charset=utf-8")
            handler.end_headers()
            handler.wfile.write(b"port/layer/filter invalides.\n")
            return

    iface_raw = (qs.get("iface") or qs.get("interface") or ["any"])[0]
    iface = normalize_sonde_iface(iface_raw)
    if iface is None:
        handler.send_response(400)
        handler.send_header("Content-Type", "text/plain; charset=utf-8")
        handler.end_headers()
        handler.wfile.write("iface invalide (nom d'interface non autorise).\n".encode("utf-8"))
        return

    if layer not in _VALID_LAYER:
        handler.send_response(400)
        handler.send_header("Content-Type", "text/plain; charset=utf-8")
        handler.end_headers()
        handler.wfile.write(b"layer (L3|L4|L7) invalide.\n")
        return
    if not explore:
        assert port is not None
        if not (1 <= port <= 65535):
            handler.send_response(400)
            handler.send_header("Content-Type", "text/plain; charset=utf-8")
            handler.end_headers()
            handler.wfile.write(b"port (1-65535) invalide.\n")
            return
    else:
        # Exploration : pas de payload ASCII (-A), trop volumineux et souvent TLS illisible
        if layer == "L7":
            handler.send_response(400)
            handler.send_header("Content-Type", "text/plain; charset=utf-8")
            handler.end_headers()
            handler.wfile.write(b"exploration: L7 interdit (choisir L3 ou L4).\n")
            return

    if layer == "L3" and filt not in _FILTERS_L3:
        filt = "all"
    elif layer == "L4" and filt not in _FILTERS_L4:
        filt = "synfinrst"
    elif layer == "L7" and filt not in _FILTERS_L7:
        filt = "gt50"

    if direction not in _VALID_DIRECTION:
        direction = "both"

    cmd = _tcpdump_cmd(port if not explore else None, layer, filt, direction, iface)

    my_proc: subprocess.Popen | None = None
    with _sonde_lock:
        _kill_sonde_unlocked()
        try:
            my_proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=0,
                text=True,
            )
            _sonde_proc = my_proc
        except OSError as e:
            handler.send_response(500)
            handler.send_header("Content-Type", "text/plain; charset=utf-8")
            handler.end_headers()
            handler.wfile.write(f"Erreur lancement tcpdump: {e}\n".encode())
            return

    assert my_proc is not None

    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Connection", "keep-alive")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()

    # Ligne d’info (JSON) pour le front
    port_str = "*" if explore else str(port)
    explore_str = "1" if explore else "0"
    info = json.dumps(
        {
            "t": f"# tcpdump -i {iface} layer={layer} filter={filt} port={port_str} direction={direction} explore={explore_str}",
            "info": True,
        },
        ensure_ascii=False,
    )
    _sse_write(handler, f"data: {info}\n\n")

    assert my_proc.stdout is not None

    try:
        for line in iter(my_proc.stdout.readline, ""):
            if line == "":
                break
            line = line.rstrip("\r\n")
            if _TCPDUMP_STARTUP_NOISE.search(line):
                continue
            payload = json.dumps({"t": line}, ensure_ascii=False)
            _sse_write(handler, f"data: {payload}\n\n")
        rc = my_proc.wait(timeout=2)
    except BrokenPipeError:
        rc = -1
    except Exception as e:
        err = json.dumps({"t": f"# erreur lecture: {e}", "error": True}, ensure_ascii=False)
        try:
            _sse_write(handler, f"data: {err}\n\n")
        except Exception:
            pass
        rc = 1
    finally:
        with _sonde_lock:
            if _sonde_proc is my_proc:
                if my_proc.poll() is None:
                    try:
                        my_proc.terminate()
                        my_proc.wait(timeout=1)
                    except Exception:
                        try:
                            my_proc.kill()
                        except Exception:
                            pass
                _sonde_proc = None

    end = json.dumps({"t": f"# fin (code {rc})", "end": True, "code": rc}, ensure_ascii=False)
    try:
        _sse_write(handler, f"data: {end}\n\n")
    except Exception:
        pass


def serve_sonde_stop(handler) -> None:
    """POST /api/sonde/stop — tue le tcpdump actif."""
    global _sonde_proc

    with _sonde_lock:
        _kill_sonde_unlocked()

    body = json.dumps({"ok": True, "stopped": True}).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)
