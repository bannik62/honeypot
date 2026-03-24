#!/bin/bash
# honeypot-check — Diagnostic rapide de l'installation

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$ROOT_DIR/config/config"

if [ -f "$CONFIG_FILE" ]; then
    # shellcheck disable=SC1090
    source "$CONFIG_FILE"
fi

DATA_DIR="${DATA_DIR:-$ROOT_DIR/data}"
SSH_USER="${SUDO_USER:-$USER}"

if [ -t 1 ]; then
    GREEN='\033[0;32m'
    RED='\033[0;31m'
    YELLOW='\033[1;33m'
    NC='\033[0m'
else
    GREEN=''
    RED=''
    YELLOW=''
    NC=''
fi

ok()   { echo -e "  ${GREEN}OK${NC}  $1"; }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; }
err()  { echo -e "  ${RED}ERR${NC} $1"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   HONEYPOT MONITOR — DIAGNOSTIC"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1) Endlessh
echo "1) Endlessh"
if sudo systemctl is-active --quiet endlessh 2>/dev/null; then
    ok "endlessh actif"
else
    err "endlessh inactif — lancez: sudo systemctl start endlessh"
fi

# 2) Monitoring daemon
echo ""
echo "2) Monitoring daemon"
if pgrep -f "journalctl.*endlessh" >/dev/null 2>&1; then
    ok "honeypot-monitor actif"
else
    warn "honeypot-monitor inactif — lancez: honeypot-monitor start"
fi

# 3) Donnees
echo ""
echo "3) Données"
CSV="$DATA_DIR/logs/connections.csv"
if [ -f "$CSV" ]; then
    lines=$(tail -n +2 "$CSV" 2>/dev/null | wc -l | tr -d ' ')
    ok "connections.csv présent (${lines} connexions)"
else
    err "connections.csv absent — lancez: honeypot-monitor start"
fi

# 4) data.json
DATA_JSON="$DATA_DIR/visualizer-dashboard/data.json"
if [ -f "$DATA_JSON" ]; then
    age_h=$(( ( $(date +%s) - $(stat -c %Y "$DATA_JSON" 2>/dev/null || echo 0) ) / 3600 ))
    if [ "$age_h" -lt 24 ]; then
        ok "data.json présent (mis à jour il y a ${age_h}h)"
    else
        warn "data.json présent mais ancien (${age_h}h) — lancez: honeypot-make-visualizer-data"
    fi
else
    warn "data.json absent — lancez: honeypot-make-visualizer-data"
fi

# 5) Serveur visualiseur
echo ""
echo "4) Serveur visualiseur"
PID_FILE="/tmp/honeypot-visualizer.pid"
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    ok "serveur actif sur http://127.0.0.1:8765"
    echo "      Tunnel SSH: ssh -L 8765:127.0.0.1:8765 ${SSH_USER}@IP_DU_VPS"
else
    warn "serveur inactif — lancez: honeypot-start-server start"
fi

# 6) sudo ufw
echo ""
echo "5) Permissions sudo"
if sudo -n ufw status verbose >/dev/null 2>&1; then
    ok "sudo ufw accessible (onglet Audit fonctionnel)"
else
    err "sudo ufw inaccessible — onglet Audit limité"
    echo "      Ajoutez dans sudoers (exemple):"
    echo "        ${SSH_USER} ALL=(ALL) NOPASSWD: /usr/sbin/ufw status verbose"
fi

# 7) sudo tcpdump
if sudo -n tcpdump -D >/dev/null 2>&1; then
    ok "sudo tcpdump accessible (onglet Sonde fonctionnel)"
else
    err "sudo tcpdump inaccessible — onglet Sonde non fonctionnel"
    echo "      Ajoutez dans sudoers (exemple):"
    echo "        ${SSH_USER} ALL=(ALL) NOPASSWD: /usr/sbin/tcpdump"
fi

# 8) Dependances
echo ""
echo "6) Dépendances"
for cmd in nmap geoiplookup jq sqlite3 python3; do
    if command -v "$cmd" >/dev/null 2>&1; then
        ok "$cmd"
    else
        err "$cmd manquant — lancez: sudo apt install $cmd"
    fi
done

if command -v google-chrome >/dev/null 2>&1 || command -v google-chrome-stable >/dev/null 2>&1; then
    ok "google-chrome"
else
    warn "google-chrome manquant — captures d'écran désactivées"
fi

# 9) Cron
echo ""
echo "7) Scans automatiques"
if crontab -l 2>/dev/null | grep -q "run-all-scans.sh"; then
    cron_line=$(crontab -l 2>/dev/null | grep "run-all-scans.sh" | head -n 1)
    ok "cron actif: $cron_line"
else
    warn "cron inactif — lancez: setup-auto-scan"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
