#!/usr/bin/env python3
"""
routing/audit.py — Audit réseau (phase 1, read-only).

Objectif :
- Récupérer les ports ouverts via ss
- Récupérer le statut UFW (si disponible)
- Classifier les ports ouverts selon :
  - DENY explicite sur port => ✅ Protégé
  - Policy défaut DENY et aucune règle explicite => ✅ Protégé
  - Pas de règle et policy ALLOW => ⚠️ À l'air libre
  - DENY explicite sur port sans service derrière => 🟡 Règle morte (snapshot)

Notes :
- Docker : mapping best-effort via /proc/<pid>/cgroup (pas de bypass iptables, phase 1).
- Si UFW non supporté / commandes indisponibles => on retourne compatible=false.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from typing import Any

from config import ROOT


_IPV4_RE = re.compile(r"(?:\d{1,3}\.){3}\d{1,3}")
_CONTAINER_ID_RE = re.compile(r"(?:docker[-/]|/docker/)([0-9a-f]{12,64})", re.IGNORECASE)


def _send_json(handler, payload: dict[str, Any], status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _run(args: list[str], timeout_s: int = 15) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=timeout_s,
        env=os.environ.copy(),
    )


def _extract_container_from_pid(pid: int) -> tuple[str | None, str | None]:
    """Retourne (container_id, container_name) best-effort."""
    try:
        cgroup = ""
        with open(f"/proc/{pid}/cgroup", "r", encoding="utf-8", errors="ignore") as f:
            cgroup = f.read()
        m = _CONTAINER_ID_RE.search(cgroup)
        if not m:
            return None, None
        cid = m.group(1)
    except Exception:
        return None, None

    # Name : best-effort via docker inspect (si utilisable)
    name = None
    if shutil.which("docker"):
        try:
            proc = _run(["docker", "inspect", "--format", "{{.Name}}", cid], timeout_s=10)
            if proc.returncode == 0:
                name = (proc.stdout or "").strip().lstrip("/")
        except Exception:
            name = None
    return cid, name


def _parse_ss_ports(output: str) -> list[dict[str, Any]]:
    """
    ss -ltnup (H) sort de lignes type:
      tcp LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1234,fd=3))
      udp UNCONN 0 0 0.0.0.0:53 0.0.0.0:* users:(("named",pid=5678,fd=...)

    On extrait : proto, state, port, process, pid.
    """
    ports: list[dict[str, Any]] = []
    for raw in (output or "").splitlines():
        line = raw.strip()
        if not line:
            continue

        # proto token: tcp / tcp6 / udp / udp6
        tokens = line.split()
        if len(tokens) < 5:
            continue
        proto_token = tokens[0].lower()
        proto = "tcp" if proto_token.startswith("tcp") else ("udp" if proto_token.startswith("udp") else "")
        if not proto:
            continue
        state = tokens[1]
        # tokens[4] ~ local_address:port
        local_field = tokens[4]

        m_port = re.search(r":(?P<port>\d+)$", local_field)
        if not m_port:
            continue
        port = int(m_port.group("port"))

        pid = None
        proc_name = None
        m_proc = re.search(r'users:\(\("(?P<name>[^"]+)",pid=(?P<pid>\d+)', line)
        if m_proc:
            try:
                proc_name = m_proc.group("name")
                pid = int(m_proc.group("pid"))
            except Exception:
                pid = None

        origin = "natif"
        container_name = None
        if pid is not None:
            cid, cname = _extract_container_from_pid(pid)
            if cid:
                origin = "docker"
                container_name = cname or cid[:12]

        ports.append(
            {
                "port": port,
                "proto": proto,
                "state": state,
                "pid": pid,
                "process": proc_name,
                "origin": origin,
                "container": container_name,
            }
        )
    return ports


def _get_ports_open() -> list[dict[str, Any]]:
    # Première tentative avec -p (process) ; si permissions insuffisantes, on retente sans.
    ss_cmds = [
        ["ss", "-H", "-l", "-n", "-t", "-u", "-p"],
        ["ss", "-H", "-l", "-n", "-t", "-u"],
    ]
    last_out = ""
    for cmd in ss_cmds:
        try:
            proc = _run(cmd, timeout_s=20)
            last_out = (proc.stdout or "") + (proc.stderr or "")
            if proc.returncode == 0:
                ports = _parse_ss_ports(proc.stdout or "")
                if ports:
                    return ports
        except Exception:
            continue
    return _parse_ss_ports(last_out)


def _parse_ufw_status(text: str) -> dict[str, Any]:
    # Supported ?
    supported = bool(text)
    out = text or ""
    # Default incoming policy
    policy_in = None
    m_default = re.search(r"Default:\s*(?P<in>allow|deny)\s*\(incoming\)", out, re.IGNORECASE)
    if m_default:
        policy_in = m_default.group("in").lower()

    active = None
    if re.search(r"Status:\s*active", out, re.IGNORECASE):
        active = True
    elif re.search(r"Status:\s*inactive", out, re.IGNORECASE):
        active = False

    rules_lines = [ln.strip() for ln in out.splitlines() if ln.strip()]
    ufw_rules: list[dict[str, Any]] = []
    denied_ports: set[tuple[int, str]] = set()
    explicit_ports: set[tuple[int, str]] = set()

    # On cherche des lignes qui contiennent <port>/<proto> et DENY/ALLOW
    # Exemple (selon version) :
    #   22/tcp DENY IN Anywhere
    #   DENY IN 22/tcp ...
    for ln in rules_lines:
        # action
        action_m = re.search(r"\b(ALLOW|DENY)\b", ln, re.IGNORECASE)
        if not action_m:
            continue
        action = action_m.group(1).upper()

        port_m = re.search(r"(?P<port>\d+)\s*/\s*(?P<proto>tcp|udp)\b", ln, re.IGNORECASE)
        if not port_m:
            continue
        port = int(port_m.group("port"))
        proto = port_m.group("proto").lower()

        explicit_ports.add((port, proto))
        if action == "DENY":
            denied_ports.add((port, proto))

        ufw_rules.append({"port": port, "proto": proto, "action": action, "raw": ln})

    # Compte règles : on garde un nombre best-effort.
    rules_count = len(ufw_rules)

    return {
        "supported": supported,
        "active": active,
        "policy_in": policy_in,
        "rules_count": rules_count,
        "explicit_ports": sorted([{"port": p, "proto": proto} for (p, proto) in explicit_ports]),
        "denied_ports": sorted([{"port": p, "proto": proto} for (p, proto) in denied_ports]),
        "raw": out[:4000],
    }


def _get_ufw_status() -> dict[str, Any]:
    if not shutil.which("ufw"):
        return {"supported": False, "active": None, "policy_in": None, "rules_count": 0}
    try:
        proc = _run(["ufw", "status", "verbose"], timeout_s=20)
        # ufw peut renvoyer code !=0 selon cas ; on parse quand même le stdout/stderr.
        text = (proc.stdout or "") + (proc.stderr or "")
        return _parse_ufw_status(text)
    except Exception:
        return {"supported": False, "active": None, "policy_in": None, "rules_count": 0}


def _classify_port(
    port: int,
    proto: str,
    open_set: set[tuple[int, str]],
    policy_in: str | None,
    explicit_ports: set[tuple[int, str]],
    denied_ports: set[tuple[int, str]],
) -> dict[str, Any]:
    key = (port, proto)
    if key in denied_ports:
        return {"key": key, "status": "protected", "label": "✅ Protégé"}
    if key in explicit_ports:
        # règle explicite mais pas DENY (donc pas protégée au sens de ta phase 1)
        return {"key": key, "status": "open", "label": "⚠️ À l'air libre"}
    # Pas de règle explicite
    if policy_in == "deny":
        return {"key": key, "status": "protected", "label": "✅ Protégé"}
    if policy_in == "allow":
        return {"key": key, "status": "open", "label": "⚠️ À l'air libre"}
    return {"key": key, "status": "unknown", "label": "🟨 Inconnu (policy UFW)"}


def serve_audit(handler) -> None:
    snapshot_ts = int(time.time())

    ports_open = _get_ports_open()
    open_set = {(p["port"], p["proto"]) for p in ports_open}

    ufw = _get_ufw_status()
    if not ufw.get("supported"):
        _send_json(
            handler,
            {
                "ok": True,
                "snapshot_ts": snapshot_ts,
                "ufw_supported": False,
                "ports_open": ports_open,
                "cross_open_ports": [],
                "dead_deny_rules": [],
            },
        )
        return

    policy_in = ufw.get("policy_in")
    explicit_ports = {(r["port"], r["proto"]) for r in ufw.get("explicit_ports") or []}
    denied_ports = {(r["port"], r["proto"]) for r in ufw.get("denied_ports") or []}

    cross = []
    for key in sorted(open_set, key=lambda x: (x[1], x[0])):
        port, proto = key
        cross.append(_classify_port(port, proto, open_set, policy_in, explicit_ports, denied_ports))

    # Règles mortes DENY : deny-explicite sur port/proto non observé en écoute
    dead_deny = []
    for key in sorted(denied_ports):
        if key not in open_set:
            dead_deny.append({"port": key[0], "proto": key[1], "label": "🟡 Règle morte (snapshot)"})

    _send_json(
        handler,
        {
            "ok": True,
            "snapshot_ts": snapshot_ts,
            "ufw_supported": True,
            "ufw": {
                "active": ufw.get("active"),
                "policy_in": policy_in,
                "rules_count": ufw.get("rules_count"),
            },
            "ports_open": ports_open,
            "cross_open_ports": cross,
            "dead_deny_rules": dead_deny,
        },
    )

