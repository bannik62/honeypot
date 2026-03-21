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
    # shellcheck source=/dev/null
    source "$CONFIG_FILE"
fi

# Même logique que generate-data.sh : data souvent dans .../honeypot/data/ (pas honeypot/honeypot/data)
DATA_DIR_CANDIDATE_PARENT="$(cd "$SCRIPT_DIR/../.." && pwd)/data"
DATA_DIR_CANDIDATE_SIBLING="$SCRIPT_DIR/../data"
if [ -z "${DATA_DIR:-}" ] || [ ! -d "${DATA_DIR}/screenshotAndLog" ]; then
    if [ -d "$DATA_DIR_CANDIDATE_PARENT/screenshotAndLog" ]; then
        DATA_DIR="$DATA_DIR_CANDIDATE_PARENT"
    else
        DATA_DIR="$DATA_DIR_CANDIDATE_SIBLING"
    fi
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
echo "📁 OUTPUT_DIR (traceroutes) : $OUTPUT_DIR"
echo "📁 CSV        : $CSV_FILE"
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
    # -Pn : ne pas abandonner si le ping ICMP échoue (hôte « down ») — beaucoup d’IPs ne répondent pas au -sn seul
    #        mais le traceroute fonctionne quand même (cf. cas firewall / hôtes distants).
    nmap -Pn -sn --traceroute -n --max-rtt-timeout 500ms --host-timeout 90s "$ip" > "$tmp_report" 2>&1
    if [ -s "$tmp_report" ]; then
        # nmap : section "TRACEROUTE" (majuscules) la plus courante ; variantes selon version / locale
        awk '/^TRACEROUTE/ { found=1; next } found { print }' "$tmp_report" > "$out_file"
        if [ ! -s "$out_file" ]; then
            awk '/^Traceroute/ { found=1; next } found { print }' "$tmp_report" > "$out_file"
        fi
        if [ ! -s "$out_file" ] && command -v gawk &>/dev/null; then
            gawk 'BEGIN{IGNORECASE=1} $0 ~ /^traceroute/ { found=1; next } found { print }' "$tmp_report" > "$out_file"
        fi
        # Si toujours vide : garder la sortie brute pour que generate-data puisse au moins extraire des IPv4
        if [ ! -s "$out_file" ] && grep -qE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' "$tmp_report"; then
            cp "$tmp_report" "$out_file"
        fi
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
if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_UID:-}" ] && [ -n "${SUDO_GID:-}" ]; then
    echo "🔧 Remise des droits sur $OUTPUT_DIR à l'utilisateur (pour que le cron puisse écrire)."
    chown -R "${SUDO_UID}:${SUDO_GID}" "$OUTPUT_DIR"
fi
