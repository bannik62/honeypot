#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/../data/logs"

# Créer le répertoire de logs si nécessaire
mkdir -p "$LOG_DIR"

# Fonction pour logger
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_DIR/run-all-scans.log"
}

log "========================================="
log "Démarrage de la séquence de scans"
log "========================================="

# 1. scan-web (nmap-to-csv)
log "1/4 - Démarrage de scan-web..."
cd "$SCRIPT_DIR"
if "$SCRIPT_DIR/nmap-to-csv.sh" >> "$LOG_DIR/run-all-scans.log" 2>&1; then
    log "✅ scan-web terminé"
sleep 30
else
    log "❌ Erreur dans scan-web"
    exit 1
fi

# 2. capture-web (nikto-capture)
log "2/4 - Démarrage de capture-web..."
if "$SCRIPT_DIR/nikto-capture.sh" >> "$LOG_DIR/run-all-scans.log" 2>&1; then
    log "✅ capture-web terminé"
sleep 30
else
    log "❌ Erreur dans capture-web"
    exit 1
fi

# 3. dig-ip
log "3/4 - Démarrage de dig-ip..."
if "$SCRIPT_DIR/dig-ip.sh" >> "$LOG_DIR/run-all-scans.log" 2>&1; then
    log "✅ dig-ip terminé"
sleep 30
else
    log "❌ Erreur dans dig-ip"
    exit 1
fi

# 4. vuln-scan
log "4/4 - Démarrage de vuln-scan..."
if "$SCRIPT_DIR/vuln-scan.sh" >> "$LOG_DIR/run-all-scans.log" 2>&1; then
    log "✅ vuln-scan terminé"
else
    log "❌ Erreur dans vuln-scan"
    exit 1
fi

log "========================================="
log "Tous les scans sont terminés"
log "========================================="
