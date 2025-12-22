#!/bin/bash
# Script qui affiche les statistiques du honeypot

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
fi

LOG_FILE="$DATA_DIR/logs/connections.csv"

if [ ! -f "$LOG_FILE" ]; then
    echo "⚠️  Aucune donnée trouvée. Le monitoring n'a pas encore capturé de connexions."
    exit 0
fi

# Compter le total
total=$(wc -l < "$LOG_FILE" | tr -d ' ')

# Compter IPs uniques
unique_ips=$(cut -d',' -f2 "$LOG_FILE" | sort -u | wc -l | tr -d ' ')

# Top 5 pays
echo "🍯 HONEYPOT STATISTICS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📈 Total Connections: $total"
echo "🌍 Unique IPs: $unique_ips"
echo ""

# Top pays
echo "🌎 TOP 5 COUNTRIES:"
tail -n +2 "$LOG_FILE" | cut -d',' -f4 | sort | uniq -c | sort -rn | head -5 | \
    while read count country; do
        percentage=$((count * 100 / total))
        echo "  $country: $count ($percentage%)"
    done

echo ""
echo "🔥 LATEST 5 CONNECTIONS:"
tail -5 "$LOG_FILE" | while IFS=',' read -r timestamp ip port country; do
    echo "  $timestamp - $ip ($country) - port $port"
done
