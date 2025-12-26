#!/bin/bash
# Script qui parse les logs Endlessh et extrait les IPs

# Charger la config
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
fi

LOG_FILE="$DATA_DIR/logs/connections.csv"
CACHE_FILE="$DATA_DIR/cache/geoip-cache.json"

# Créer les répertoires si nécessaire
mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$CACHE_FILE")"

# Fonction pour géolocaliser une IP
geolocate_ip() {
    local ip="$1"
    
    # Vérifier le cache d'abord
    if [ -f "$CACHE_FILE" ]; then
        local cached=$(jq -r ".[\"$ip\"] // empty" "$CACHE_FILE" 2>/dev/null)
        if [ -n "$cached" ] && [ "$cached" != "null" ]; then
            echo "$cached"
            return
        fi
    fi
    
    # Lookup GeoIP
    local country=$(geoiplookup "$ip" 2>/dev/null | grep -oP 'GeoIP Country Edition: \K[^,]+' | head -1)
    if [ -z "$country" ]; then
        country="Unknown"
    fi
    
    # Sauvegarder dans le cache
    if [ ! -f "$CACHE_FILE" ]; then
        echo "{}" > "$CACHE_FILE"
    fi
    local temp=$(mktemp)
    jq ". + {\"$ip\": \"$country\"}" "$CACHE_FILE" > "$temp" 2>/dev/null && mv "$temp" "$CACHE_FILE"
    
    echo "$country"
}

# Parser les logs depuis journalctl
parse_logs() {
    sudo journalctl -u "${SERVICE_NAME:-endlessh}" -o cat -n 0 | \
    grep "ACCEPT" | \
    while IFS= read -r line; do
        # Extraire IP et port depuis "ACCEPT host=::ffff:IP port=PORT"
        if [[ $line =~ host=([^[:space:]]+) ]]; then
            ip="${BASH_REMATCH[1]}"
            ip=$(echo "$ip" | sed 's/::ffff://')
            
            if [[ $line =~ port=([0-9]+) ]]; then
                port="${BASH_REMATCH[1]}"
            else
                port="unknown"
            fi
            
            timestamp=$(date '+%Y-%m-%d %H:%M:%S')
            country=$(geolocate_ip "$ip")
            
            # Écrire dans le CSV
            echo "$timestamp,$ip,$port,$country" >> "$LOG_FILE"
        fi
    done
}

# Fonction pour parser une ligne depuis stdin
parse_line() {
    local line="$1"
    
    if [ -z "$line" ]; then
        return 1
    fi
    
    # Extraire IP et port depuis "ACCEPT host=::ffff:IP port=PORT"
    if [[ $line =~ host=([^[:space:]]+) ]]; then
        ip="${BASH_REMATCH[1]}"
        ip=$(echo "$ip" | sed 's/::ffff://')

        if [[ $line =~ port=([0-9]+) ]]; then
            port="${BASH_REMATCH[1]}"
        else
            port="unknown"
        fi

        # Vérifier si cette connexion existe déjà (éviter doublons)
        if grep -q ",$ip,$port," "$LOG_FILE" 2>/dev/null; then
            return 0  # Déjà enregistré, skip
        fi

        timestamp=$(date '+%Y-%m-%d %H:%M:%S')
        country=$(geolocate_ip "$ip")

        # Écrire dans le CSV
        echo "$timestamp,$ip,$port,$country" >> "$LOG_FILE"
        return 0
    fi
    
    return 1
}


# Si appelé avec stdin (pipe), parser la ligne
if [ ! -t 0 ]; then
    while IFS= read -r line; do
        parse_line "$line"
    done
# Si appelé directement sans arguments, parser tout l'historique
elif [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    parse_logs
fi
