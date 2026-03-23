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
from urllib.parse import parse_qs, urlparse

_sonde_lock = threading.Lock()
_sonde_proc: subprocess.Popen | None = None

_VALID_LAYER = frozenset({"L3", "L4", "L7"})
# Filtres autorisés par couche (whitelist)
_FILTERS_L3 = frozenset({"all", "tcp", "udp", "icmp"})
_FILTERS_L4 = frozenset({"syn", "fin", "rst", "synfinrst"})
_FILTERS_L7 = frozenset({"gt50", "gt128"})
_VALID_DIRECTION = frozenset({"both", "in", "out"})

# Lignes de démarrage tcpdump sur « -i any » (promiscuous, LINUX_SLL2, etc.) — bruit sans intérêt.
_TCPDUMP_STARTUP_NOISE = re.compile(
    r"(?i)(tcpdump:\s*)?(WARNING:.*promiscuous|"
    r"\(Promiscuous mode not supported|"
    r"data link type LINUX_|"
    r"verbose output suppressed|"
    r"listening on any, link-type|"
    r"snapshot length \d+ bytes\s*$)",
)


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


def _build_filter_expr(port: int, layer: str, filt: str, direction: str) -> str:
    """Expression tcpdump (sans shell). direction: both | in (dst) | out (src)."""
    p = str(port)
    if direction not in _VALID_DIRECTION:
        direction = "both"

    if layer == "L3":
        # Pas de « not broadcast / not multicast » : avec -i any (LINUX_SLL2),
        # tcpdump renvoie « not a broadcast link » et quitte en erreur (code 1).
        if filt == "all":
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
            return _tcp_port(p, direction, "tcp")
        if filt == "udp":
            return _tcp_port(p, direction, "udp")
        if filt == "icmp":
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
        base = _tcp_port(p, direction, "tcp")
        return f"{base} and ({flags})"
    if layer == "L7":
        gt = "50" if filt == "gt50" else "128"
        base = _tcp_port(p, direction, "tcp")
        return f"{base} and greater {gt}"
    raise ValueError("layer")


def _tcpdump_cmd(port: int, layer: str, filt: str, direction: str) -> list[str]:
    expr = _build_filter_expr(port, layer, filt, direction)
    cmd = ["sudo", "tcpdump", "-n", "-i", "any", "-l"]
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


def serve_sonde_stream(handler) -> None:
    """GET /api/sonde/stream?port=&layer=&filter= — SSE."""
    global _sonde_proc

    qs = parse_qs(urlparse(handler.path).query)
    try:
        port_s = (qs.get("port") or [""])[0]
        layer = (qs.get("layer") or ["L3"])[0].upper()
        filt = (qs.get("filter") or [""])[0] or "all"
        direction = (qs.get("direction") or ["both"])[0].lower()
        port = int(port_s)
    except (ValueError, TypeError):
        handler.send_response(400)
        handler.send_header("Content-Type", "text/plain; charset=utf-8")
        handler.end_headers()
        handler.wfile.write(b"port/layer/filter invalides.\n")
        return

    if not (1 <= port <= 65535) or layer not in _VALID_LAYER:
        handler.send_response(400)
        handler.send_header("Content-Type", "text/plain; charset=utf-8")
        handler.end_headers()
        handler.wfile.write(b"port (1-65535) ou layer (L3|L4|L7) invalide.\n")
        return

    if layer == "L3" and filt not in _FILTERS_L3:
        filt = "all"
    elif layer == "L4" and filt not in _FILTERS_L4:
        filt = "synfinrst"
    elif layer == "L7" and filt not in _FILTERS_L7:
        filt = "gt50"

    if direction not in _VALID_DIRECTION:
        direction = "both"

    cmd = _tcpdump_cmd(port, layer, filt, direction)

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
    info = json.dumps(
        {
            "t": f"# tcpdump layer={layer} filter={filt} port={port} direction={direction}",
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
