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

# Tente d'extraire pays + coords depuis geoiplookup (si base City dispo)
geoip_resolve() {
    local ip="$1"
    local out="" country="" lat="" lon=""

    if ! command -v geoiplookup &>/dev/null; then
        echo "||"
        return
    fi

    out="$(geoiplookup "$ip" 2>/dev/null | head -1)"
    [ -z "$out" ] && { echo "||"; return; }

    # Exemple: GeoIP Country Edition: US, United States
    country="$(echo "$out" | sed -n 's/^GeoIP Country Edition: \([^,]*\),.*$/\1/p' | head -1)"

    # Exemple City (legacy): GeoIP City Edition, Rev 1: US, CA, City, 12345, 37.78, -122.41, ...
    if [ -z "$country" ]; then
        country="$(echo "$out" | sed -n 's/^GeoIP City Edition[^:]*: \([^,]*\),.*$/\1/p' | head -1)"
    fi

    lat="$(echo "$out" | awk -F',' '{gsub(/^ +| +$/,"",$6); print $6}')"
    lon="$(echo "$out" | awk -F',' '{gsub(/^ +| +$/,"",$7); print $7}')"

    [[ "$lat" =~ ^-?[0-9]+(\.[0-9]+)?$ ]] || lat=""
    [[ "$lon" =~ ^-?[0-9]+(\.[0-9]+)?$ ]] || lon=""

    echo "${country}|${lat}|${lon}"
}

# Construire un index pays depuis connections.csv
declare -A IP_COUNTRY
if [ -f "$CSV_FILE" ]; then
    while IFS=',' read -r ts ip port country; do
        [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
        IP_COUNTRY["$ip"]="$country"
    done < <(tail -n +2 "$CSV_FILE")
fi

# Compter le total pour la progression
total_dirs=0
for _ in "$SCAN_DIR"/*/; do
    [[ -d "$_" ]] && total_dirs=$((total_dirs + 1))
done
echo "🔍 Parse de $total_dirs IPs en cours..."

echo "[" > "$OUTPUT"
first=1
total=0

for ip_dir in "$SCAN_DIR"/*/; do
    ip=$(basename "$ip_dir")
    # Vérifier que c'est bien une IP
    [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue

    # Pays depuis CSV ou GeoIP + coords (si dispo)
    country="${IP_COUNTRY[$ip]}"
    geo_raw="$(geoip_resolve "$ip")"
    geo_country="${geo_raw%%|*}"
    geo_tail="${geo_raw#*|}"
    geo_lat="${geo_tail%%|*}"
    geo_lon="${geo_tail#*|}"
    [ -z "$country" ] && country="$geo_country"
    [ -z "$country" ] && country="Unknown"

    lat_json="null"
    lon_json="null"
    if [[ "$geo_lat" =~ ^-?[0-9]+(\.[0-9]+)?$ ]] && [[ "$geo_lon" =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then
        lat_json="$geo_lat"
        lon_json="$geo_lon"
    fi

    # Détecter les rapports disponibles
    has_nmap=false
    has_dns=false
    has_screenshot=false
    has_nikto=false
    has_traceroute=false

    [ -f "$ip_dir/${ip}_nmap.txt" ]       && has_nmap=true
    [ -f "$ip_dir/${ip}_dns.txt" ]        && has_dns=true
    [ -f "$ip_dir/${ip}_nikto.txt" ]      && has_nikto=true
    [ -f "$ip_dir/${ip}_traceroute.txt" ] && has_traceroute=true
    ls "$ip_dir"/*.png 2>/dev/null | head -1 | grep -q . && has_screenshot=true

    # Hops du traceroute (ordre des IPs) pour l'onglet Réseau
    hops_json="[]"
    if [ "$has_traceroute" = true ] && [ -f "$ip_dir/${ip}_traceroute.txt" ]; then
        hop_ips=($(grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' "$ip_dir/${ip}_traceroute.txt" 2>/dev/null))
        if [ ${#hop_ips[@]} -gt 0 ]; then
            hops_json="[$(printf '"%s"' "${hop_ips[0]}"; for i in "${hop_ips[@]:1}"; do printf ',"%s"' "$i"; done)]"
        fi
    fi

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
    "lat": $lat_json,
    "lon": $lon_json,
    "nmap": $has_nmap,
    "dns": $has_dns,
    "screenshot": $has_screenshot,
    "nikto": $has_nikto,
    "traceroute": $has_traceroute,
    "hops": $hops_json,
    "vuln_high": $vuln_high,
    "ports": "$ports_safe"
  }
JSONLINE

    total=$((total + 1))
    # Afficher la progression tous les 50 IPs (défilement dans les logs)
    if [ $((total % 50)) -eq 0 ]; then
        echo "  … $total / $total_dirs IPs parsées"
    fi
done

echo "]" >> "$OUTPUT"

echo "✅ Parse data.json terminé — $total IPs parsées ($OUTPUT)"
