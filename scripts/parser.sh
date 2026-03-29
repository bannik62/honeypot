#!/bin/bash
# Script qui parse les logs Endlessh et extrait les IPs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../lib"
if [ ! -f "$LIB_DIR/common.sh" ]; then
    echo "❌ lib/common.sh introuvable — impossible d'exécuter parser.sh." >&2
    exit 1
fi
# shellcheck source=../lib/common.sh
source "$LIB_DIR/common.sh"

for cmd in geoiplookup jq; do
    check_command "$cmd" "geoip-bin" || die "Dépendances manquantes (geoip-bin, jq)"
done

load_config "$SCRIPT_DIR" || die "Erreur chargement configuration"

CSV_FILE="$DATA_DIR/logs/connections.csv"
CACHE_FILE="$DATA_DIR/cache/geoip-cache.json"

safe_mkdir "$(dirname "$CSV_FILE")"
safe_mkdir "$(dirname "$CACHE_FILE")"
init_logging "parser" 2>/dev/null || true

rotate_file_if_needed "$CSV_FILE" 50 2>/dev/null || true
cleanup_old_backups "$CSV_FILE" 3 2>/dev/null || true

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
        safe_create_file "$CACHE_FILE" "{}"
    fi
    
    # Limiter la taille du cache GeoIP (max 10MB, ~100k entrées)
    local cache_size=$(stat -f%z "$CACHE_FILE" 2>/dev/null || stat -c%s "$CACHE_FILE" 2>/dev/null || echo 0)
    if [ "$cache_size" -gt 10485760 ]; then  # 10MB
        log_warn "Cache GeoIP trop volumineux (${cache_size} bytes), nettoyage..."
        # Garder seulement les 50000 dernières entrées (environ)
        local temp_cache=$(mktemp)
        jq 'to_entries | sort_by(.key) | reverse | .[0:50000] | from_entries' "$CACHE_FILE" > "$temp_cache" 2>/dev/null
        if [ $? -eq 0 ] && [ -s "$temp_cache" ]; then
            mv "$temp_cache" "$CACHE_FILE" 2>/dev/null || true
        else
            rm -f "$temp_cache" 2>/dev/null
            # Si le nettoyage échoue, recréer un cache vide
            echo "{}" > "$CACHE_FILE"
        fi
    fi
    
    local temp=$(mktemp)
    if jq ". + {\"$ip\": \"$country\"}" "$CACHE_FILE" > "$temp" 2>/dev/null; then
        mv "$temp" "$CACHE_FILE" 2>/dev/null || true
    else
        rm -f "$temp" 2>/dev/null
    fi
    
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
            echo "$timestamp,$ip,$port,$country" >> "$CSV_FILE"
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
        # Vérifier les dernières lignes pour l'optimisation (ajusté dynamiquement)
        # Utiliser 50% du fichier ou 5000 lignes max pour équilibrer performance/précision
        if [ -f "$CSV_FILE" ] && [ -s "$CSV_FILE" ]; then
            local total_lines=$(wc -l < "$CSV_FILE" 2>/dev/null || echo 0)
            local check_lines=$((total_lines / 2))
            if [ "$check_lines" -gt 5000 ]; then
                check_lines=5000
            elif [ "$check_lines" -lt 1000 ]; then
                check_lines=1000
            fi
            if tail -n "$check_lines" "$CSV_FILE" 2>/dev/null | grep -q ",$ip,$port,"; then
                return 0  # Déjà enregistré, skip
            fi
        fi

        timestamp=$(date '+%Y-%m-%d %H:%M:%S')
        country=$(geolocate_ip "$ip")

        # Écrire dans le CSV
        echo "$timestamp,$ip,$port,$country" >> "$CSV_FILE"
        
        # Rotation périodique (toutes les 1000 connexions environ)
        local line_count=$(wc -l < "$CSV_FILE" 2>/dev/null || echo 0)
        if [ $((line_count % 1000)) -eq 0 ] && [ "$line_count" -gt 0 ]; then
            rotate_file_if_needed "$CSV_FILE" 50 2>/dev/null || true
        fi
        
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
