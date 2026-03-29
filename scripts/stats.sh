#!/bin/bash

# Script qui affiche les statistiques du honeypot

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../lib"
if [ ! -f "$LIB_DIR/common.sh" ]; then
    echo "❌ lib/common.sh introuvable — installation incomplète." >&2
    exit 1
fi
# shellcheck source=../lib/common.sh
source "$LIB_DIR/common.sh"
load_config "$SCRIPT_DIR" || die "Erreur chargement configuration"

LOG_FILE="$DATA_DIR/logs/connections.csv"
PARSER_SCRIPT="$SCRIPT_DIR/parser.sh"

# Créer le CSV avec en-tête si nécessaire
mkdir -p "$(dirname "$LOG_FILE")"
if [ ! -f "$LOG_FILE" ]; then
    echo "timestamp,ip,port,country" > "$LOG_FILE"
fi

# Parser tout l'historique de journalctl pour Endlessh
echo "📊 Chargement de l'historique complet..."
sudo journalctl -u "${SERVICE_NAME:-endlessh}" -o cat -n 0 2>/dev/null | \
    grep "ACCEPT" | \
    while IFS= read -r line; do
        echo "$line" | "$PARSER_SCRIPT"
    done > /dev/null 2>&1

# Compter le total (ignorer la première ligne = en-tête)
total=$(tail -n +2 "$LOG_FILE" 2>/dev/null | wc -l | tr -d ' ')

# Si pas de connexions
if [ "$total" -eq 0 ]; then
    echo "⚠️  Aucune donnée trouvée. Le monitoring n'a pas encore capturé de connexions."
    exit 0
fi

# Compter IPs uniques (ignorer la première ligne = en-tête)
unique_ips=$(tail -n +2 "$LOG_FILE" 2>/dev/null | cut -d',' -f2 | sort -u | wc -l | tr -d ' ')

echo "🍯 HONEYPOT STATISTICS"
log_section
echo ""
echo "📈 Total Connections: $total"
echo "🌍 Unique IPs: $unique_ips"
echo ""

# Top pays (ignorer la première ligne = en-tête)
if [ "$total" -gt 0 ]; then
    echo "🌎 TOP 5 COUNTRIES:"
    tail -n +2 "$LOG_FILE" 2>/dev/null | cut -d',' -f4 | sort | uniq -c | sort -rn | head -5 | \
        while read count country; do
            # Calcul avec arrondi : multiplier par 1000, diviser, puis arrondir
            if [ "$total" -gt 0 ]; then
                # Calcul en dixièmes de pourcent : (count * 1000) / total
                percentage_tenths=$((count * 1000 / total))
                # Arrondir : si le reste >= 5, ajouter 1
                remainder=$((count * 1000 % total))
                if [ "$remainder" -ge $((total / 2)) ]; then
                    percentage_tenths=$((percentage_tenths + 1))
                fi
                # Convertir en pourcentage entier
                percentage=$((percentage_tenths / 10))
                # Si 0 mais qu'il y a des connexions, afficher <1%
                if [ "$percentage" -eq 0 ] && [ "$count" -gt 0 ]; then
                    percentage="<1"
                else
                    percentage="${percentage}%"
                fi
            else
                percentage="0%"
            fi
            echo "  $country: $count ($percentage)"
        done

    echo ""
    echo "🔥 LATEST 5 CONNECTIONS:"
    tail -n +2 "$LOG_FILE" 2>/dev/null | tail -5 | while IFS=',' read -r timestamp ip port country; do
        echo "  $timestamp - $ip ($country) - port $port"
    done
fi
