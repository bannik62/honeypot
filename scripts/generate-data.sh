#!/bin/bash
# generate-data.sh — Scanne data/screenshotAndLog/ et génère data.json

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    # shellcheck source=/dev/null
    source "$CONFIG_FILE"
fi

# Layout fréquent : scripts dans .../honeypot/honeypot/scripts/ mais DATA dans .../honeypot/data/
# Le défaut scripts/../data = .../honeypot/honeypot/data (souvent vide ou sans traceroute).
DATA_DIR_CANDIDATE_PARENT="$(cd "$SCRIPT_DIR/../.." && pwd)/data"
DATA_DIR_CANDIDATE_SIBLING="$SCRIPT_DIR/../data"

if [ -z "${DATA_DIR:-}" ] || [ ! -d "${DATA_DIR}/screenshotAndLog" ]; then
    if [ -d "$DATA_DIR_CANDIDATE_PARENT/screenshotAndLog" ]; then
        DATA_DIR="$DATA_DIR_CANDIDATE_PARENT"
    else
        DATA_DIR="$DATA_DIR_CANDIDATE_SIBLING"
    fi
elif [ -d "$DATA_DIR_CANDIDATE_PARENT/screenshotAndLog" ] && [ "$DATA_DIR" != "$DATA_DIR_CANDIDATE_PARENT" ]; then
    # Config pointe ailleurs : si le parent a des traceroute et pas le dossier choisi, basculer.
    n_cfg="$(find "$DATA_DIR/screenshotAndLog" -type f -name '*_traceroute.txt' 2>/dev/null | wc -l)"
    n_par="$(find "$DATA_DIR_CANDIDATE_PARENT/screenshotAndLog" -type f -name '*_traceroute.txt' 2>/dev/null | wc -l)"
    if [ "${n_cfg// /}" -eq 0 ] && [ "${n_par// /}" -gt 0 ]; then
        echo "⚠️  DATA_DIR=$DATA_DIR ne contient aucun *_traceroute.txt ; utilisation de $DATA_DIR_CANDIDATE_PARENT ($n_par fichier(s))."
        DATA_DIR="$DATA_DIR_CANDIDATE_PARENT"
    fi
fi

SCAN_DIR="$DATA_DIR/screenshotAndLog"
CSV_FILE="$DATA_DIR/logs/connections.csv"
VIZ_DIR="$DATA_DIR/visualizer-dashboard"
OUTPUT="$VIZ_DIR/data.json"

echo "📂 DATA_DIR=$DATA_DIR"
echo "📂 SCAN_DIR=$SCAN_DIR"

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
declare -A HOP_COUNTRY_CACHE
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
count_tr=0
count_hops_nonempty=0

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
    # Traceroute : nom attendu IP_traceroute.txt ; sinon tout *traceroute*.txt dans le dossier
    traceroute_file=""
    if [ -f "$ip_dir/${ip}_traceroute.txt" ]; then
        traceroute_file="$ip_dir/${ip}_traceroute.txt"
    else
        shopt -s nullglob
        for f in "$ip_dir"/*traceroute*.txt "$ip_dir"/*TRACEROUTE*.txt; do
            if [ -f "$f" ]; then traceroute_file="$f"; break; fi
        done
        shopt -u nullglob
    fi
    [ -n "$traceroute_file" ] && [ -f "$traceroute_file" ] && has_traceroute=true
    ls "$ip_dir"/*.png 2>/dev/null | head -1 | grep -q . && has_screenshot=true

    # Hops du traceroute (ordre des IPs) pour l'onglet Réseau
    hops_json="[]"
    hop_names_json="{}"
    hop_countries_json="{}"
    if [ "$has_traceroute" = true ] && [ -n "$traceroute_file" ]; then
        hop_ips=($(grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' "$traceroute_file" 2>/dev/null))
        if [ ${#hop_ips[@]} -gt 0 ]; then
            hops_json="[$(printf '"%s"' "${hop_ips[0]}"; for i in "${hop_ips[@]:1}"; do printf ',"%s"' "$i"; done)]"
        fi

        # Reverse DNS (PTR) pour les hops : si <hop_ip>_dns.txt existe, on map vers hostname.
        # Objectif : permettre au front d'afficher name (hostname) au hover du graphe réseau.
        hop_names_pairs=()
        hop_countries_pairs=()
        for hop_ip in "${hop_ips[@]}"; do
            dns_file="$SCAN_DIR/$hop_ip/${hop_ip}_dns.txt"
            if [ -f "$dns_file" ]; then
                # Prendre la première ligne non vide après "Reverse DNS (PTR):"
                ptr="$(awk '/Reverse DNS \\(PTR\\):/{found=1; next} found && $0 ~ /[^[:space:]]/{print $0; exit}' "$dns_file" 2>/dev/null | tr -d '\r' | sed 's/[[:space:]]*$//')"
                # Nettoyage : si dig n'a rien trouvé, ptr contient souvent "❌ Aucun résultat"
                if [ -n "$ptr" ] && ! echo "$ptr" | grep -q "Aucun résultat"; then
                    ptr_safe="$(echo "$ptr" | sed 's/"/\\"/g')"
                    hop_names_pairs+=("\"$hop_ip\":\"$ptr_safe\"")
                fi
            fi

            # Pays pour les hops (optionnel, via geoiplookup si dispo)
            hop_country=""
            if [ -n "${IP_COUNTRY[$hop_ip]}" ]; then
                hop_country="${IP_COUNTRY[$hop_ip]}"
            elif [ -n "${HOP_COUNTRY_CACHE[$hop_ip]}" ]; then
                hop_country="${HOP_COUNTRY_CACHE[$hop_ip]}"
            else
                geo_raw="$(geoip_resolve "$hop_ip")"
                if [ "$geo_raw" = "||" ] || [ -z "$geo_raw" ]; then
                    hop_country=""
                else
                    hop_country="${geo_raw%%|*}"
                fi
                [ -n "$hop_country" ] && HOP_COUNTRY_CACHE[$hop_ip]="$hop_country"
            fi
            [ -z "$hop_country" ] && hop_country="Unknown"

            hop_country_safe="$(echo "$hop_country" | sed 's/"/\\"/g' | tr -d '\n')"
            hop_countries_pairs+=("\"$hop_ip\":\"$hop_country_safe\"")
        done

        if [ ${#hop_names_pairs[@]} -gt 0 ]; then
            hop_names_json="{$(printf '%s,' "${hop_names_pairs[@]}" | sed 's/,$//')}"
        fi
        if [ ${#hop_countries_pairs[@]} -gt 0 ]; then
            hop_countries_json="{$(printf '%s,' "${hop_countries_pairs[@]}" | sed 's/,$//')}"
        fi
        count_tr=$((count_tr + 1))
        if [ ${#hop_ips[@]} -gt 0 ]; then
            count_hops_nonempty=$((count_hops_nonempty + 1))
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
    "hop_names": $hop_names_json,
    "hop_countries": $hop_countries_json,
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
echo "📊 Traceroute détectés (fichier présent): $count_tr — dont avec hops (IPv4 extraits): $count_hops_nonempty"
