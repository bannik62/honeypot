#!/bin/bash
# generate-data.sh — Scanne data/screenshotAndLog/ et génère data.json

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
fi

SCAN_DIR="$DATA_DIR/screenshotAndLog"
CSV_FILE="$DATA_DIR/logs/connections.csv"
VIZ_DIR="$DATA_DIR/visualizer-dashboard"
OUTPUT="$VIZ_DIR/data.json"

mkdir -p "$VIZ_DIR"

if [ ! -d "$SCAN_DIR" ]; then
    echo "[]" > "$OUTPUT"
    echo "❌ Dossier $SCAN_DIR introuvable"
    exit 1
fi

echo "🔍 Scan de $SCAN_DIR..."

# Construire un index pays depuis connections.csv
declare -A IP_COUNTRY
if [ -f "$CSV_FILE" ]; then
    while IFS=',' read -r ts ip port country; do
        [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
        IP_COUNTRY["$ip"]="$country"
    done < <(tail -n +2 "$CSV_FILE")
fi

echo "[" > "$OUTPUT"
first=1
total=0

for ip_dir in "$SCAN_DIR"/*/; do
    ip=$(basename "$ip_dir")
    # Vérifier que c'est bien une IP
    [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue

    # Pays depuis CSV ou geoiplookup
    country="${IP_COUNTRY[$ip]}"
    if [ -z "$country" ] && command -v geoiplookup &>/dev/null; then
        country=$(geoiplookup "$ip" 2>/dev/null | grep -oP 'GeoIP Country Edition: \K[^,]+' | head -1)
    fi
    [ -z "$country" ] && country="Unknown"

    # Détecter les rapports disponibles
    has_nmap=false
    has_dns=false
    has_screenshot=false
    has_nikto=false

    [ -f "$ip_dir/${ip}_nmap.txt" ]   && has_nmap=true
    [ -f "$ip_dir/${ip}_dns.txt" ]    && has_dns=true
    [ -f "$ip_dir/${ip}_nikto.txt" ]  && has_nikto=true
    ls "$ip_dir"/*.png 2>/dev/null | head -1 | grep -q . && has_screenshot=true

    # Compter les vulnérabilités HIGH dans le rapport nmap
    vuln_high=0
    if [ "$has_nmap" = true ]; then
        vuln_high=$(grep -c "VULNERABLE\|HIGH\|10\.[0-9]" "$ip_dir/${ip}_nmap.txt" 2>/dev/null | tr -d '\n' || echo 0)
    fi

    # Ports ouverts depuis nmap
    ports=""
    if [ "$has_nmap" = true ]; then
        ports=$(grep -oP '^\d+/tcp\s+open' "$ip_dir/${ip}_nmap.txt" 2>/dev/null | grep -oP '^\d+' | tr '\n' ',' | sed 's/,$//')
    fi

    # Séparateur JSON
    [ $first -eq 0 ] && echo "," >> "$OUTPUT"
    first=0

    # Échapper les valeurs
    country_safe=$(echo "$country" | sed 's/"/\\"/g' | tr -d '\n')
    ports_safe=$(echo "$ports" | sed 's/"/\\"/g' | tr -d '\n')

    cat >> "$OUTPUT" << JSONLINE
  {
    "ip": "$ip",
    "country": "$country_safe",
    "nmap": $has_nmap,
    "dns": $has_dns,
    "screenshot": $has_screenshot,
    "nikto": $has_nikto,
    "vuln_high": $vuln_high,
    "ports": "$ports_safe"
  }
JSONLINE

    total=$((total + 1))
done

echo "]" >> "$OUTPUT"

echo "✅ $total IPs exportées → $OUTPUT"
