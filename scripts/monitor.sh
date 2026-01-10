#!/bin/bash

# Script de monitoring temps réel du honeypot

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

# Charger la configuration (une seule fois)
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
    SERVICE_NAME="endlessh"
fi

# Utiliser un répertoire accessible à l'utilisateur au lieu de /tmp
# S'assurer que le répertoire cache existe et appartient à l'utilisateur
PID_DIR="${DATA_DIR}/cache"
if ! mkdir -p "$PID_DIR" 2>/dev/null; then
    echo "⚠️  Impossible de créer $PID_DIR, utilisation de /tmp" >&2
    PID_DIR="/tmp"
fi

# S'assurer que les fichiers PID/LOCK appartiennent à l'utilisateur actuel (pas root)
PID_FILE="$PID_DIR/honeypot-monitor.pid"
LOCK_FILE="$PID_DIR/honeypot-monitor.lock"

PARSER_SCRIPT="$SCRIPT_DIR/parser.sh"
MARKER_FILE="${DATA_DIR}/cache/last-parsed.txt"

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
    
    # Vérifier si c'est un restart ou un premier démarrage
    local since_timestamp=""
    local marker_exists=false
    
    # Lire le marqueur de dernier parsing (si existe)
    if [ -f "$MARKER_FILE" ]; then
        since_timestamp=$(cat "$MARKER_FILE" 2>/dev/null | head -1 | tr -d '\n\r' || echo "")
        if [ -n "$since_timestamp" ]; then
            marker_exists=true
        fi
    fi
    
    # Si pas de marqueur, essayer de récupérer le timestamp de la dernière ligne du CSV
    if [ "$marker_exists" = false ]; then
        local csv_file="${DATA_DIR}/logs/connections.csv"
        if [ -f "$csv_file" ] && [ -s "$csv_file" ]; then
            # Extraire le timestamp de la dernière ligne (format: timestamp,ip,port,country)
            local last_line=$(tail -n 1 "$csv_file" 2>/dev/null || echo "")
            if [ -n "$last_line" ]; then
                since_timestamp=$(echo "$last_line" | cut -d',' -f1 | tr -d '\n\r' || echo "")
                if [ -n "$since_timestamp" ]; then
                    marker_exists=true
                fi
            fi
        fi
    fi
    
    # Parser l'historique depuis le dernier timestamp (ou tout si premier démarrage)
    if [ "$marker_exists" = true ] && [ -n "$since_timestamp" ]; then
        echo "📜 Parsing depuis le dernier checkpoint (${since_timestamp})..."
        # Utiliser --since pour parser seulement depuis ce timestamp
        # Format attendu: "YYYY-MM-DD HH:MM:SS" ou "YYYY-MM-DD HH:MM:SS" converti en format journalctl
        local journalctl_since="$since_timestamp"
        # Compter les lignes depuis ce timestamp
        local total_lines=$(sudo journalctl -u "$SERVICE_NAME" -o cat --since "$journalctl_since" --no-pager 2>/dev/null | grep -c "ACCEPT" || echo "0")
        
        if [ "$total_lines" -gt 0 ]; then
            echo "📊 $total_lines nouvelles lignes à parser..."
            local count=0
            
            # Parser depuis le timestamp
            while IFS= read -r line; do
                echo "$line" | "$PARSER_SCRIPT" 2>/dev/null
                count=$((count + 1))
                # Afficher la progression toutes les 50 lignes ou toutes les lignes si < 50
                if [ "$total_lines" -le 50 ] || [ $((count % 50)) -eq 0 ] || [ "$count" -eq "$total_lines" ]; then
                    local percent=$((count * 100 / total_lines))
                    printf "\r⏳ Parsing... %d/%d lignes (%d%%)" "$count" "$total_lines" "$percent" >&2
                fi
            done < <(sudo journalctl -u "$SERVICE_NAME" -o cat --since "$journalctl_since" --no-pager 2>/dev/null | grep "ACCEPT")
            
            echo ""  # Nouvelle ligne après la progression
            echo "✅ $count nouvelles lignes parsées"
        else
            echo "✅ Aucune nouvelle ligne depuis le dernier checkpoint"
        fi
    else
        # Premier démarrage : parser tout l'historique
        echo "📜 Parsing de l'historique complet (premier démarrage)..."
        local total_lines=$(sudo journalctl -u "$SERVICE_NAME" -o cat --no-pager 2>/dev/null | grep -c "ACCEPT" || echo "0")
        
        if [ "$total_lines" -gt 0 ]; then
            echo "📊 $total_lines lignes à parser..."
            local count=0
            
            # Parser directement depuis journalctl sans fichier temporaire
            while IFS= read -r line; do
                echo "$line" | "$PARSER_SCRIPT" 2>/dev/null
                count=$((count + 1))
                # Afficher la progression toutes les 50 lignes ou toutes les lignes si < 50
                if [ "$total_lines" -le 50 ] || [ $((count % 50)) -eq 0 ] || [ "$count" -eq "$total_lines" ]; then
                    local percent=$((count * 100 / total_lines))
                    printf "\r⏳ Parsing... %d/%d lignes (%d%%)" "$count" "$total_lines" "$percent" >&2
                fi
            done < <(sudo journalctl -u "$SERVICE_NAME" -o cat --no-pager 2>/dev/null | grep "ACCEPT")
            
            echo ""  # Nouvelle ligne après la progression
            echo "✅ $count lignes parsées"
        else
            echo "⚠️  Aucune ligne à parser"
        fi
    fi
    
    # Sauvegarder le timestamp actuel dans le marqueur (juste avant le suivi en temps réel)
    # Cela garantit qu'au prochain restart, on ne manque pas les connexions arrivées pendant le parsing
    mkdir -p "$(dirname "$MARKER_FILE")" 2>/dev/null
    date '+%Y-%m-%d %H:%M:%S' > "$MARKER_FILE" 2>/dev/null || true
    
    echo "✅ Historique parsé, écoute des nouvelles connexions..."
    
    # Lancer journalctl en arrière-plan avec unbuffer pour éviter le buffering
    # Utiliser stdbuf pour forcer le flush immédiat (si disponible)
    if command -v stdbuf >/dev/null 2>&1; then
        ( stdbuf -oL -eL sudo journalctl -u "$SERVICE_NAME" -f -n 0 -o cat --no-pager 2>/dev/null | stdbuf -oL -eL bash -c "while IFS= read -r line; do
            if echo \"\$line\" | grep -q \"ACCEPT\"; then
                echo \"\$line\" | \"$PARSER_SCRIPT\" 2>/dev/null
            fi
        done" ) &
    else
        # Fallback sans stdbuf
        ( sudo journalctl -u "$SERVICE_NAME" -f -n 0 -o cat --no-pager 2>/dev/null | while IFS= read -r line; do
            if echo "$line" | grep -q "ACCEPT"; then
                echo "$line" | "$PARSER_SCRIPT" 2>/dev/null
            fi
        done ) &
    fi
    
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
