#!/bin/bash
# Dashboard temps réel du honeypot

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
    REFRESH_INTERVAL=5
fi

LOG_FILE="$DATA_DIR/logs/connections.csv"

# Fonction pour nettoyer l'écran
clear_screen() {
    clear
    echo "🍯 HONEYPOT LIVE DASHBOARD"
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
    total=$(wc -l < "$LOG_FILE" 2>/dev/null | tr -d ' ')
    unique_ips=$(cut -d',' -f2 "$LOG_FILE" 2>/dev/null | sort -u | wc -l | tr -d ' ')
    
    # Dernière connexion
    if [ -f "$LOG_FILE" ]; then
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
    
    echo ""
    echo "🔄 Rafraîchissement toutes les ${REFRESH_INTERVAL}s (Ctrl+C pour quitter)"
}

# Boucle principale
trap 'clear; exit 0' INT

while true; do
    clear_screen
    show_stats
    sleep "${REFRESH_INTERVAL:-5}"
done
