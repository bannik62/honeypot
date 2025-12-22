#!/bin/bash
# Dashboard temps réel du honeypot avec écoute live

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
    REFRESH_INTERVAL=5
    SERVICE_NAME="endlessh"
fi

LOG_FILE="$DATA_DIR/logs/connections.csv"
PARSER_SCRIPT="$SCRIPT_DIR/parser.sh"

# Fonction pour nettoyer l'écran
clear_screen() {
    clear
    echo "🍯 HONEYPOT LIVE DASHBOARD (Temps Réel)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# Fonction pour afficher les stats
show_stats() {
    if [ ! -f "$LOG_FILE" ]; then
        echo "⏳ En attente de connexions..."
        return
    fi
    
    # Total
    total=$(tail -n +2 "$LOG_FILE" 2>/dev/null | wc -l | tr -d ' ')
    unique_ips=$(tail -n +2 "$LOG_FILE" 2>/dev/null | cut -d',' -f2 | sort -u | wc -l | tr -d ' ')
    
    # Dernière connexion
    if [ -f "$LOG_FILE" ] && [ "$total" -gt 0 ]; then
        last_line=$(tail -1 "$LOG_FILE")
        if [ -n "$last_line" ]; then
            IFS=',' read -r last_time last_ip last_port last_country <<< "$last_line"
        fi
    fi
    
    echo "📊 Total: $total connexions | 🌍 IPs uniques: $unique_ips"
    if [ -n "$last_ip" ]; then
        echo "🆕 Dernière: $last_time - $last_ip ($last_country) - port $last_port"
    fi
    echo ""
    
    # Top pays
    if [ "$total" -gt 0 ]; then
        echo "🌎 TOP 10 COUNTRIES:"
        tail -n +2 "$LOG_FILE" 2>/dev/null | cut -d',' -f4 | sort | uniq -c | sort -rn | head -10 | \
            while read count country; do
                bar_length=$((count * 50 / total))
                bar=$(printf '█%.0s' $(seq 1 $bar_length))
                percentage=$((count * 100 / total))
                printf "  %-3s %s %s (%d%%)\n" "$count" "$country" "$bar" "$percentage"
            done
        
        echo ""
        echo "🔥 DERNIÈRES 10 CONNEXIONS:"
        tail -10 "$LOG_FILE" 2>/dev/null | while IFS=',' read -r timestamp ip port country; do
            echo "  $timestamp - $ip ($country)"
        done
    fi
    
    echo ""
    echo "🔄 Écoute en temps réel (Ctrl+C pour quitter)"
}

# Fonction pour parser une ligne ACCEPT
parse_and_display() {
    local line="$1"
    if echo "$line" | grep -q "ACCEPT"; then
        # Parser la ligne
        if [[ $line =~ host=([^[:space:]]+) ]]; then
            ip="${BASH_REMATCH[1]}"
            ip=$(echo "$ip" | sed 's/::ffff://')
            
            if [[ $line =~ port=([0-9]+) ]]; then
                port="${BASH_REMATCH[1]}"
            else
                port="unknown"
            fi
            
            # Géolocaliser
            country=$(geoiplookup "$ip" 2>/dev/null | grep -oP 'GeoIP Country Edition: \K[^,]+' | head -1 || echo "Unknown")
            timestamp=$(date '+%Y-%m-%d %H:%M:%S')
            
            # Écrire dans le CSV
            echo "$timestamp,$ip,$port,$country" >> "$LOG_FILE"
            
            # Afficher immédiatement
            clear_screen
            show_stats
            echo ""
            echo "✨ NOUVELLE CONNEXION: $timestamp - $ip ($country) - port $port"
        fi
    fi
}

# Nettoyer à la sortie
trap 'clear; exit 0' INT

# Afficher les stats initiales
clear_screen
show_stats
echo ""

# Écouter en temps réel
sudo journalctl -u "$SERVICE_NAME" -f -n 0 --no-pager 2>/dev/null | while IFS= read -r line; do
    parse_and_display "$line"
done
