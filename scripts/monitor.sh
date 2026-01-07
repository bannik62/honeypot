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
    
    # Vérifier aussi avec pgrep et nettoyer toutes les instances
    local existing_count=$(pgrep -f "journalctl.*endlessh" 2>/dev/null | wc -l)
    if [ "$existing_count" -gt 0 ]; then
        echo "⚠️  $existing_count instance(s) de journalctl détectée(s), nettoyage..."
        cleanup_processes
        sleep 2
        # Vérifier à nouveau
        local remaining=$(pgrep -f "journalctl.*endlessh" 2>/dev/null | wc -l)
        if [ "$remaining" -gt 0 ]; then
            echo "❌ Impossible de nettoyer tous les processus journalctl"
            return 1
        fi
    fi
    
    echo "🚀 Démarrage du monitoring..."
    
    # Nettoyer le cache orphelin du parser (pour éviter les problèmes)
    RECENT_CONNECTIONS_FILE="$SCRIPT_DIR/../data/cache/recent_connections.txt"
    if [ -f "$RECENT_CONNECTIONS_FILE" ]; then
        rm -f "$RECENT_CONNECTIONS_FILE"
    fi
    
    # Parser l'historique complet au démarrage (avec compteur)
    echo "📜 Parsing de l'historique complet..."
    
    local temp_file=$(mktemp)
    trap "rm -f '$temp_file'" EXIT INT TERM
    
    sudo journalctl -u "$SERVICE_NAME" -o cat 2>/dev/null | grep "ACCEPT" > "$temp_file"
    local total_lines=$(wc -l < "$temp_file" 2>/dev/null || echo "0")
    
    if [ "$total_lines" -gt 0 ]; then
        echo "📊 $total_lines lignes à parser..."
        local count=0
        
        while IFS= read -r line; do
            echo "$line" | "$PARSER_SCRIPT" 2>/dev/null
            count=$((count + 1))
            # Afficher la progression toutes les 50 lignes ou toutes les lignes si < 50
            if [ "$total_lines" -le 50 ] || [ $((count % 50)) -eq 0 ] || [ "$count" -eq "$total_lines" ]; then
                local percent=$((count * 100 / total_lines))
                printf "\r⏳ Parsing... %d/%d lignes (%d%%)" "$count" "$total_lines" "$percent"
            fi
        done < "$temp_file"
        
        echo ""  # Nouvelle ligne après la progression
        echo "✅ $count lignes parsées"
    else
        echo "ℹ️  Aucune ligne à parser dans l'historique"
    fi
    
    trap - EXIT INT TERM
    rm -f "$temp_file"
    
    echo "✅ Historique parsé, écoute des nouvelles connexions..."
    
    # Lancer journalctl en daemon (arrière-plan) pour suivre les logs en temps réel
    nohup bash -c "sudo journalctl -u \"$SERVICE_NAME\" -f -o cat --no-pager 2>/dev/null | while IFS= read -r line; do
        if echo \"\$line\" | grep -q \"ACCEPT\"; then
            echo \"\$line\" | \"$PARSER_SCRIPT\" 2>/dev/null
        fi
    done" > /dev/null 2>&1 &
    
    local monitor_pid=$!
    
    # Attendre un peu pour que journalctl démarre
    sleep 2
    
    # Trouver le PID réel de journalctl
    local jpid=$(find_journalctl_pid)
    if [ -z "$jpid" ]; then
        # Si pas trouvé, utiliser le PID du processus
        jpid=$monitor_pid
    fi
    
    # Enregistrer le PID
    echo "$jpid" > "$PID_FILE"
    echo "$jpid" > "$LOCK_FILE"
    
    echo "✅ Monitoring démarré en arrière-plan (PID: $jpid)"
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
