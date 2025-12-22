#!/bin/bash
# Script de monitoring temps réel du honeypot

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"
PID_FILE="/tmp/honeypot-monitor.pid"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
    SERVICE_NAME="endlessh"
fi

PARSER_SCRIPT="$SCRIPT_DIR/parser.sh"

# Fonction pour démarrer le monitoring
start_monitor() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            echo "⚠️  Le monitoring est déjà en cours (PID: $pid)"
            return 1
        else
            rm -f "$PID_FILE"
        fi
    fi
    
    echo "🚀 Démarrage du monitoring..."
    
    # Lancer en background
    (
        while true; do
            # Lire les nouveaux logs
            sudo journalctl -u "$SERVICE_NAME" -f -n 0 --no-pager 2>/dev/null | \
            while IFS= read -r line; do
                if echo "$line" | grep -q "ACCEPT"; then
                    # Parser et enregistrer
                    echo "$line" | "$PARSER_SCRIPT" 2>/dev/null
                fi
            done
        done
    ) &
    
    echo $! > "$PID_FILE"
    echo "✅ Monitoring démarré (PID: $(cat "$PID_FILE"))"
}

# Fonction pour arrêter
stop_monitor() {
    if [ ! -f "$PID_FILE" ]; then
        echo "⚠️  Le monitoring n'est pas en cours"
        return 1
    fi
    
    local pid=$(cat "$PID_FILE")
    if ps -p "$pid" > /dev/null 2>&1; then
        kill "$pid" 2>/dev/null
        rm -f "$PID_FILE"
        echo "✅ Monitoring arrêté"
    else
        rm -f "$PID_FILE"
        echo "⚠️  PID trouvé mais le processus n'existe pas"
    fi
}

# Fonction pour le statut
status_monitor() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            echo "✅ Monitoring actif (PID: $pid)"
        else
            echo "⚠️  PID file existe mais processus mort"
        fi
    else
        echo "❌ Monitoring inactif"
    fi
}

# Gestion des commandes
case "$1" in
    start)
        start_monitor
        ;;
    stop)
        stop_monitor
        ;;
    status)
        status_monitor
        ;;
    restart)
        stop_monitor
        sleep 1
        start_monitor
        ;;
    *)
        echo "Usage: $0 {start|stop|status|restart}"
        exit 1
        ;;
esac
