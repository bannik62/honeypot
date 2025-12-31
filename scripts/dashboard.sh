#!/bin/bash

# Dashboard temps réel du honeypot - Lit uniquement le CSV

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
    REFRESH_INTERVAL=3
    SERVICE_NAME="endlessh"
fi

LOG_FILE="$DATA_DIR/logs/connections.csv"

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
        echo "💡 Astuce: Lancez 'honeypot-monitor start' en arrière-plan pour remplir le CSV"
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
        total_countries=$(tail -n +2 "$LOG_FILE" 2>/dev/null | cut -d"," -f4 | sort -u | wc -l)
        echo "🌎 TOP 10 COUNTRIES (sur $total_countries pays au total):"
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
    echo "🔄 Rafraîchissement automatique toutes les ${REFRESH_INTERVAL}s (Ctrl+C pour quitter)"
    echo "💡 Le CSV est alimenté par 'honeypot-monitor start' en arrière-plan"
}

# Nettoyer à la sortie
trap 'clear; exit 0' INT

# Afficher les stats initiales
clear_screen
show_stats

# Boucle de rafraîchissement périodique
last_refresh=$(date +%s)
while true; do
    current_time=$(date +%s)
    time_since_refresh=$((current_time - last_refresh))

    # Rafraîchissement toutes les REFRESH_INTERVAL secondes
    if [ $time_since_refresh -ge $REFRESH_INTERVAL ]; then
        clear_screen
        show_stats
        last_refresh=$(date +%s)
    fi

    sleep 0.5  # Check toutes les 0.5s
done
