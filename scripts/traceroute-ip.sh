#!/bin/bash
# Traceroute dédié : basé sur connections.csv (IPs récentes).
# Ce script est hors réglage du cron / installation. Usage ponctuel et manuel uniquement
# (ex. backfill après mise en place du traceroute). Une fois que le traceroute via
# vuln-scan.sh (nmap --traceroute) fonctionne bien en production, ce fichier peut
# être supprimé.
#
# ⚠️  À lancer avec sudo : sudo bash scripts/traceroute-ip.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
fi

CSV_FILE="${DATA_DIR}/logs/connections.csv"
OUTPUT_DIR="${DATA_DIR}/screenshotAndLog"
TRACE_PARALLEL="${TRACEROUTE_PARALLEL:-1}"

if [ ! -f "$CSV_FILE" ]; then
    echo "❌ Fichier connections.csv introuvable: $CSV_FILE" >&2
    exit 1
fi

if ! command -v nmap &> /dev/null; then
    echo "❌ nmap n'est pas installé" >&2
    exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
    echo "⚠️  Traceroute nécessite souvent les droits root (raw sockets)." >&2
    echo "   Relancez avec : sudo bash $0" >&2
fi

echo "📁 DATA_DIR   : $DATA_DIR"
echo "📁 Enregistrement des traceroutes : $OUTPUT_DIR"
echo ""

# IPs uniques depuis connections.csv (colonne 2, sans l'en-tête)
all_ips=$(tail -n +2 "$CSV_FILE" | cut -d',' -f2 | sort -u | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$')

# Ne garder que celles qui n'ont pas encore de traceroute
ips_to_do=""
total_done=0
for ip in $all_ips; do
    if [ ! -f "$OUTPUT_DIR/$ip/${ip}_traceroute.txt" ]; then
        ips_to_do="$ips_to_do$ip"$'\n'
    else
        total_done=$((total_done + 1))
    fi
done

total_all=$(echo "$all_ips" | wc -l)
total_todo=$(echo "$ips_to_do" | grep -c . 2>/dev/null || echo 0)

echo "📊 connections.csv: $total_all IP(s) uniques"
echo "✅ Déjà un traceroute: $total_done"
echo "🆕 À faire: $total_todo"
echo ""

if [ "$total_todo" -eq 0 ]; then
    echo "✅ Toutes les IPs de connections.csv ont déjà un traceroute."
    exit 0
fi

do_traceroute() {
    local ip="$1"
    local ip_dir="$OUTPUT_DIR/$ip"
    local out_file="$ip_dir/${ip}_traceroute.txt"
    mkdir -p "$ip_dir"
    local tmp_report
    tmp_report=$(mktemp)
    nmap -sn --traceroute -n --max-rtt-timeout 500ms --host-timeout 90s "$ip" > "$tmp_report" 2>&1
    if [ -s "$tmp_report" ]; then
        awk '/^TRACEROUTE/ { found=1; next } found { print }' "$tmp_report" > "$out_file"
        [ -s "$out_file" ] || rm -f "$out_file"
    fi
    rm -f "$tmp_report"
}

export -f do_traceroute
export OUTPUT_DIR

count=0
while IFS= read -r ip; do
    [ -z "$ip" ] && continue
    count=$((count + 1))
    echo "[$count/$total_todo] 🔍 Traceroute: $ip"
    do_traceroute "$ip"
done <<< "$ips_to_do"

echo ""
echo "✅ Traceroute terminé. Relancez generate-data.sh pour mettre à jour data.json."
