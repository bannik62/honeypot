#!/bin/bash

# Script de monitoring temps réel du honeypot

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"
PID_FILE="/tmp/honeypot-monitor.pid"
LOCK_FILE="/tmp/honeypot-monitor.lock"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
    SERVICE_NAME="endlessh"
fi

PARSER_SCRIPT="$SCRIPT_DIR/parser.sh"

# Fonction pour trouver le PID de journalctl pour endlessh
find_journalctl_pid() {
    local result=$(pgrep -f "journalctl -u $SERVICE_NAME -f" 2>/dev/null | head -1)
    echo "$result"
}

# Fonction pour nettoyer tous les processus journalctl liés
# NOTE: Ne tue PAS les processus monitor.sh (géré par stop_monitor)
cleanup_processes() {
    # Tuer TOUS les processus journalctl liés à endlessh (tous les patterns possibles)
    sudo pkill -f "journalctl.*endlessh" 2>/dev/null
    
    # Tuer TOUS les sudo journalctl restants
    sudo pkill -f "sudo journalctl.*endlessh" 2>/dev/null
    
    # Attendre un peu
    sleep 0.5
    
    # Si certains processus persistent, forcer avec kill -9 sur TOUS
    pgrep -f "journalctl.*endlessh" 2>/dev/null | while read -r pid; do
        sudo kill -9 "$pid" 2>/dev/null
    done
    
    # Tuer aussi les processus sudo qui pointent vers journalctl
    pgrep -f "sudo.*journalctl.*endlessh" 2>/dev/null | while read -r pid; do
        sudo kill -9 "$pid" 2>/dev/null
    done
    
    # Attendre encore un peu pour que les processus se terminent
    sleep 0.5
}

# Fonction pour démarrer le monitoring
start_monitor() {
    # Vérifier si déjà en cours
    if [ -f "$LOCK_FILE" ]; then
        local existing_pid=$(cat "$LOCK_FILE" 2>/dev/null)
        if [ -n "$existing_pid" ] && ps -p "$existing_pid" > /dev/null 2>&1; then
            echo "⚠️  Le monitoring est déjà en cours (PID: $existing_pid)"
            return 1
        else
            rm -f "$LOCK_FILE"
        fi
    fi
    
    # TOUJOURS nettoyer les processus existants avant de démarrer
    local existing_count=$(pgrep -f "journalctl.*endlessh" 2>/dev/null | wc -l)
    if [ "$existing_count" -gt 0 ]; then
        echo "⚠️  $existing_count instance(s) de journalctl détectée(s), nettoyage..."
        cleanup_processes
    else
        # Nettoyer quand même au cas où (processus zombies ou non détectés)
        cleanup_processes
    fi
    
    # Attendre et vérifier à nouveau
    sleep 1
    local remaining=$(pgrep -f "journalctl.*endlessh" 2>/dev/null | wc -l)
    if [ "$remaining" -gt 0 ]; then
        echo "⚠️  $remaining processus restant(s), nettoyage forcé..."
        cleanup_processes
        sleep 1
        remaining=$(pgrep -f "journalctl.*endlessh" 2>/dev/null | wc -l)
        if [ "$remaining" -gt 0 ]; then
            echo "❌ Impossible de nettoyer tous les processus journalctl ($remaining restant(s))"
            return 1
        fi
    fi
    
    echo "🚀 Démarrage du monitoring..."
    
    # Parser l'historique complet au démarrage
    echo "📜 Parsing de l'historique complet d'abord..."
    sudo journalctl -u "$SERVICE_NAME" -o cat --no-pager 2>/dev/null | \
        grep "ACCEPT" | \
        while IFS= read -r line; do
            echo "$line" | "$PARSER_SCRIPT" 2>/dev/null
        done
    
    echo "✅ Historique parsé, écoute des nouvelles connexions..."
    
    # Lancer journalctl en arrière-plan
    ( sudo journalctl -u "$SERVICE_NAME" -f -n 0 -o cat --no-pager 2>/dev/null | while IFS= read -r line; do
        if echo "$line" | grep -q "ACCEPT"; then
            echo "$line" | "$PARSER_SCRIPT" 2>/dev/null
        fi
    done ) &
    
    local monitor_pid=$!
    
    # Attendre un peu pour que journalctl démarre
    sleep 1
    
    # Trouver le PID réel de journalctl
    local jpid=$(find_journalctl_pid)
    if [ -z "$jpid" ]; then
        # Si pas trouvé, utiliser le PID du pipe
        jpid=$monitor_pid
    fi
    
    # Enregistrer le PID
    echo "$jpid" > "$PID_FILE"
    echo "$jpid" > "$LOCK_FILE"
    
    echo "✅ Monitoring démarré (PID: $jpid)"
}

# Fonction pour arrêter
stop_monitor() {
    if [ ! -f "$PID_FILE" ] && [ ! -f "$LOCK_FILE" ]; then
        # Vérifier si un processus tourne quand même
        if find_journalctl_pid > /dev/null; then
            echo "⚠️  PID file manquant, mais processus détecté. Nettoyage..."
            cleanup_processes
            echo "✅ Monitoring arrêté (nettoyage forcé)"
            return 0
        else
            echo "⚠️  Le monitoring n'est pas en cours"
            return 1
        fi
    fi
    
    cleanup_processes
    
    # Nettoyer les fichiers
    rm -f "$PID_FILE" "$LOCK_FILE"
    
    # Vérifier qu'il n'y a plus rien
    sleep 1
    if find_journalctl_pid > /dev/null; then
        echo "⚠️  Certains processus sont encore actifs, nettoyage forcé..."
        cleanup_processes
        sleep 1
    fi
    
    echo "✅ Monitoring arrêté"
}

# Fonction pour le statut
status_monitor() {
    local jpid=$(find_journalctl_pid)
    
    if [ -n "$jpid" ]; then
        echo "✅ Monitoring actif (PID: $jpid)"
        if [ -f "$PID_FILE" ]; then
            local saved_pid=$(cat "$PID_FILE")
            if [ "$saved_pid" != "$jpid" ]; then
                echo "⚠️  PID file ($saved_pid) ne correspond pas au processus réel ($jpid)"
            fi
        fi
    else
        if [ -f "$PID_FILE" ] || [ -f "$LOCK_FILE" ]; then
            echo "⚠️  PID/LOCK file existe mais processus mort"
        else
            echo "❌ Monitoring inactif"
        fi
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
