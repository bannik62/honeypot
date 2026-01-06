#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/../data/logs"

# Créer le répertoire de logs si nécessaire
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/run-all-scans.log"

# Rotation du fichier de log si trop gros (10MB)
if [ -f "$LOG_FILE" ]; then
    LOG_SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$LOG_SIZE" -gt 10485760 ]; then  # 10MB
        BACKUP_FILE="${LOG_FILE}.$(date +%Y%m%d_%H%M%S).bak"
        mv "$LOG_FILE" "$BACKUP_FILE"
        # Compresser l'ancien log en arrière-plan
        (gzip "$BACKUP_FILE" 2>/dev/null) &
        # Nettoyer les anciens logs (garder les 5 derniers)
        find "$LOG_DIR" -name "run-all-scans.log.*.bak*" -type f -printf '%T@ %p\n' 2>/dev/null | \
            sort -rn | tail -n +6 | cut -d' ' -f2- | xargs -r rm -f 2>/dev/null
    fi
fi

# Fonction pour logger
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
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
