#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Fichier config introuvable: $CONFIG_FILE"
    exit 1
fi

# Charger la config
source "$CONFIG_FILE"

SCRIPT_DIR_ABS="$(cd "$SCRIPT_DIR" && pwd)"

# Vérifier si AUTO_SCAN_ENABLED est défini
if [ -z "$AUTO_SCAN_ENABLED" ]; then
    echo "⚠️  AUTO_SCAN_ENABLED non défini dans config, utilisation de false par défaut"
    AUTO_SCAN_ENABLED="false"
fi

# Si désactivé, supprimer le cron
if [ "$AUTO_SCAN_ENABLED" != "true" ]; then
    if crontab -l 2>/dev/null | grep -q "run-all-scans.sh"; then
        crontab -l 2>/dev/null | grep -v "run-all-scans.sh" | crontab -
        echo "✅ Cron supprimé (AUTO_SCAN_ENABLED=false)"
    else
        echo "ℹ️  Pas de cron à supprimer"
    fi
    exit 0
fi

# Vérifier si AUTO_SCAN_HOUR est défini
if [ -z "$AUTO_SCAN_HOUR" ]; then
    echo "⚠️  AUTO_SCAN_HOUR non défini dans config, utilisation de 1 heure par défaut"
    AUTO_SCAN_HOUR=1
fi

# Valider l'heure (1-23)
if ! [[ "$AUTO_SCAN_HOUR" =~ ^[0-9]+$ ]] || [ "$AUTO_SCAN_HOUR" -lt 1 ] || [ "$AUTO_SCAN_HOUR" -gt 23 ]; then
    echo "⚠️  AUTO_SCAN_HOUR invalide ($AUTO_SCAN_HOUR), utilisation de 1 heure par défaut"
    AUTO_SCAN_HOUR=1
fi

# Construire la commande cron
if [ "$AUTO_SCAN_HOUR" = "1" ]; then
    CRON_COMMAND="0 * * * * $SCRIPT_DIR_ABS/scripts/run-all-scans.sh"
else
    CRON_COMMAND="0 */$AUTO_SCAN_HOUR * * * $SCRIPT_DIR_ABS/scripts/run-all-scans.sh"
fi

# Supprimer l'ancien cron s'il existe
if crontab -l 2>/dev/null | grep -q "run-all-scans.sh"; then
    crontab -l 2>/dev/null | grep -v "run-all-scans.sh" | crontab -
fi

# Ajouter le nouveau cron
(crontab -l 2>/dev/null; echo "$CRON_COMMAND") | crontab -

echo "✅ Cron mis à jour : exécution toutes les $AUTO_SCAN_HOUR heure(s)"
