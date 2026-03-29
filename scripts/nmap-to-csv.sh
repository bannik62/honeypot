#!/bin/bash

# Nettoyage des fichiers temporaires en cas d'interruption
cleanup_temp_files() {
    # Nettoyer les fichiers temporaires créés par scan_one_ip
    find /tmp -name "tmp.*" -user "$(whoami)" -type f -mmin -10 2>/dev/null | \
        xargs -r grep -l "scan_one_ip\|nmap-to-csv" 2>/dev/null | \
        xargs -r rm -f 2>/dev/null || true
}

trap cleanup_temp_files EXIT INT TERM

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../lib"
if [ ! -f "$LIB_DIR/common.sh" ]; then
    echo "❌ lib/common.sh introuvable — installation incomplète." >&2
    exit 1
fi
# shellcheck source=../lib/common.sh
source "$LIB_DIR/common.sh"
load_config "$SCRIPT_DIR" || die "Erreur chargement configuration"

for cmd in nmap curl; do
    if ! command -v "$cmd" &> /dev/null; then
        echo "❌ Erreur: $cmd n'est pas installé" >&2
        echo "💡 Installez-le avec: sudo apt install nmap curl" >&2
        exit 1
    fi
done

export NMAP_PARALLEL
if [ -z "$NMAP_PARALLEL" ] || [ "$NMAP_PARALLEL" -lt 1 ]; then
    NMAP_PARALLEL=1
fi

LOG_FILE="$DATA_DIR/logs/connections.csv"

CSV_OUTPUT="$DATA_DIR/logs/web_interfaces.csv"

# Rotation du fichier CSV si trop gros (50MB)
if [ -f "$CSV_OUTPUT" ]; then
    rotate_file_if_needed "$CSV_OUTPUT" 50 || true
    cleanup_old_backups "$CSV_OUTPUT" 3
fi

if [ ! -f "$LOG_FILE" ]; then

    echo "❌ Fichier $LOG_FILE introuvable"

    echo "💡 Lancez d'abord honeypot-monitor pour générer les connexions"

    exit 1

fi

if [ ! -f "$CSV_OUTPUT" ]; then

    echo "timestamp,ip,port,protocol,url,scanned" > "$CSV_OUTPUT"

fi

SCAN_PORTS_NMAP=$(echo "$SCAN_PORTS" | tr ',' ' ' | xargs | tr ' ' ',')

echo "🔍 Scan des ports web sur les IPs du honeypot..."

echo "📋 Ports à scanner: $SCAN_PORTS"

echo "⚙️  Processus parallèles: $NMAP_PARALLEL"

echo ""

scanned_ips=$(tail -n +2 "$CSV_OUTPUT" 2>/dev/null | awk -F',' '$6=="1" {print $2}' | sort -u)

all_ips=$(tail -n +2 "$LOG_FILE" | cut -d',' -f2 | sort -u)

if [ -z "$scanned_ips" ]; then

    ips_to_scan="$all_ips"

    echo "🆕 Premier scan : toutes les IPs seront scannées"

else

    ips_to_scan=$(comm -23 <(echo "$all_ips") <(echo "$scanned_ips"))

    total_all=$(echo "$all_ips" | wc -l)

    total_scanned=$(echo "$scanned_ips" | wc -l)

    total_new=$(echo "$ips_to_scan" | grep -v '^$' | wc -l)

    echo "📊 IPs dans connections.csv: $total_all"

    echo "✅ Déjà scannées: $total_scanned"

    echo "🆕 Nouvelles IPs à scanner: $total_new"

    echo ""

fi

if [ -z "$ips_to_scan" ] || [ -z "$(echo "$ips_to_scan" | grep -v '^$')" ]; then

    echo "✅ Toutes les IPs ont déjà été scannées !"

    echo "💡 Utilisez 'capture-web' pour prendre des screenshotAndLog"

    exit 0

fi

total=$(echo "$ips_to_scan" | grep -v '^$' | wc -l)

scan_one_ip() {

    local ip="$1"

    local temp_written=$(mktemp)
    # Nettoyer le fichier temporaire à la sortie de la fonction
    trap "rm -f '$temp_written' 2>/dev/null" RETURN

    # --host-timeout évite les blocages sur IPs lentes ou "collantes" (ex. endlessh)
    result=$(nmap -p "$SCAN_PORTS_NMAP" -T4 --open --host-timeout 90s "$ip" 2>/dev/null | grep -E "^[0-9]+/(tcp|udp)" | grep "open")

    if [ -n "$result" ]; then

        echo "$result" | while read -r line; do

            port=$(echo "$line" | awk '{print $1}' | cut -d'/' -f1)

            protocol=$(echo "$line" | awk '{print $1}' | cut -d'/' -f2)

            if [ "$port" = "443" ] || [ "$port" = "8443" ]; then

                url_protocol="https"

            else

                url_protocol="http"

            fi

            url="${url_protocol}://${ip}:${port}"

            http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 --connect-timeout 3 --insecure "$url" 2>/dev/null)

            if [ -z "$http_code" ] || [ "$http_code" = "000" ]; then

                wget_response=$(wget --spider --timeout=3 --tries=1 -S "$url" 2>&1 | head -1 | grep -i "http" || echo "")

                if [ -z "$wget_response" ]; then

                    continue

                fi

                http_code="200"

            fi

            if [ "$http_code" != "000" ] && [ -n "$http_code" ]; then

                timestamp=$(date '+%Y-%m-%d %H:%M:%S')

                echo "  ✅ $url ($protocol)"

                echo "$timestamp,$ip,$port,$url_protocol,$url,1" >> "$CSV_OUTPUT"

                echo "1" > "$temp_written"

            fi

        done

        if [ ! -s "$temp_written" ]; then

            timestamp=$(date '+%Y-%m-%d %H:%M:%S')

            echo "$timestamp,$ip,0,none,none,1" >> "$CSV_OUTPUT"

        fi

        rm -f "$temp_written"

    else

        timestamp=$(date '+%Y-%m-%d %H:%M:%S')

        echo "$timestamp,$ip,0,none,none,1" >> "$CSV_OUTPUT"

    fi

}

export -f scan_one_ip

export CSV_OUTPUT SCAN_PORTS_NMAP

if [ "$NMAP_PARALLEL" -eq 1 ]; then

    count=0

    echo "$ips_to_scan" | grep -v '^$' | while IFS= read -r ip; do

        count=$((count + 1))

        echo "[$count/$total] Scanning $ip..."

        scan_one_ip "$ip"

    done

else

    echo "$ips_to_scan" | grep -v '^$' | xargs -P "$NMAP_PARALLEL" -I {} bash -c '

        ip="$1"

        echo "🔍 Scanning: $ip"

        scan_one_ip "$ip"

    ' _ {}

fi

echo ""

echo "✅ Scan terminé ! Résultats dans: $CSV_OUTPUT"

echo "💡 Utilisez 'capture-web' pour prendre des screenshotAndLog"

tty -s && stty sane || true
