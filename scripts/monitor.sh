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

# Fonction pour nettoyer les fichiers PID/LOCK orphelins
cleanup_orphan_files() {
    # Vérifier si le PID dans le fichier correspond à un processus actif
    if [ -f "$PID_FILE" ]; then
        local saved_pid=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$saved_pid" ]; then
            if ! ps -p "$saved_pid" > /dev/null 2>&1; then
                # Le processus n'existe plus, nettoyer les fichiers
                rm -f "$PID_FILE" "$LOCK_FILE" 2>/dev/null
            fi
        fi
    fi
    
    # Vérifier aussi le LOCK_FILE
    if [ -f "$LOCK_FILE" ] && [ ! -f "$PID_FILE" ]; then
        local lock_pid=$(cat "$LOCK_FILE" 2>/dev/null)
        if [ -n "$lock_pid" ]; then
            if ! ps -p "$lock_pid" > /dev/null 2>&1; then
                rm -f "$LOCK_FILE" 2>/dev/null
            fi
        else
            # Fichier LOCK vide ou invalide
            rm -f "$LOCK_FILE" 2>/dev/null
        fi
    fi
}

# Fonction pour nettoyer tous les processus liés
cleanup_processes() {
    # Tuer TOUS les processus journalctl liés
    sudo pkill -f "journalctl -u $SERVICE_NAME -f" 2>/dev/null
    
    # Tuer TOUS les sudo journalctl restants
    sudo pkill -f "sudo journalctl -u $SERVICE_NAME" 2>/dev/null
    
    # Tuer tous les monitor.sh en arrière-plan
    pkill -f "monitor.sh start" 2>/dev/null
    
    # Attendre un peu
    sleep 0.5
    
    # Si certains processus persistent, forcer
    local remaining=$(pgrep -f "journalctl.*endlessh" | head -1)
    if [ -n "$remaining" ]; then
        sudo kill -9 "$remaining" 2>/dev/null
    fi
    
    local sudo_journal=$(pgrep -f "sudo journalctl.*endlessh" | head -1)
    if [ -n "$sudo_journal" ]; then
        sudo kill -9 "$sudo_journal" 2>/dev/null
    fi
    
    # Nettoyer les fichiers PID/LOCK après avoir tué les processus
    cleanup_orphan_files
}

# Fonction pour démarrer le monitoring
start_monitor() {
    # Nettoyer d'abord les fichiers orphelins
    cleanup_orphan_files
    
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
    
    # Vérifier aussi avec pgrep
    local existing_jpid=$(find_journalctl_pid)
if [ -n "$existing_jpid" ]; then
        echo "⚠️  Un processus journalctl est déjà actif"
        return 1
    fi
    
    echo "🚀 Démarrage du monitoring..."
    
    # Lancer journalctl en arrière-plan pour suivre les logs en temps réel
    ( sudo journalctl -u "$SERVICE_NAME" -f -o cat --no-pager 2>/dev/null | while IFS= read -r line; do
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
