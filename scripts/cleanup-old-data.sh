#!/bin/bash
# Script de nettoyage automatique des anciennes données

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Charger la bibliothèque commune
LIB_DIR="$SCRIPT_DIR/../lib"
if [ -f "$LIB_DIR/common.sh" ]; then
    source "$LIB_DIR/common.sh"
fi

# Charger la configuration
load_config "$SCRIPT_DIR" || die "Erreur lors du chargement de la configuration"

init_logging "cleanup-old-data"

echo "🧹 Nettoyage des anciennes données..."
echo ""

# 1. Nettoyer les captures d'écran anciennes (> 30 jours)
if [ -d "$DATA_DIR/screenshotAndLog" ]; then
    OLD_SCREENSHOTS=$(find "$DATA_DIR/screenshotAndLog" -name "*.png" -type f -mtime +30 2>/dev/null | wc -l)
    if [ "$OLD_SCREENSHOTS" -gt 0 ]; then
        log_info "Suppression de $OLD_SCREENSHOTS captures d'écran de plus de 30 jours..."
        find "$DATA_DIR/screenshotAndLog" -name "*.png" -type f -mtime +30 -delete 2>/dev/null
        # Supprimer les répertoires vides
        find "$DATA_DIR/screenshotAndLog" -type d -empty -delete 2>/dev/null
        log_info "✅ Captures d'écran nettoyées"
    else
        log_info "Aucune capture d'écran ancienne à supprimer"
    fi
fi

# 2. Nettoyer les rapports nmap anciens (> 60 jours)
if [ -d "$DATA_DIR/screenshotAndLog" ]; then
    OLD_NMAP=$(find "$DATA_DIR/screenshotAndLog" -name "*_nmap.txt" -type f -mtime +60 2>/dev/null | wc -l)
    if [ "$OLD_NMAP" -gt 0 ]; then
        log_info "Suppression de $OLD_NMAP rapports nmap de plus de 60 jours..."
        find "$DATA_DIR/screenshotAndLog" -name "*_nmap.txt" -type f -mtime +60 -delete 2>/dev/null
        log_info "✅ Rapports nmap nettoyés"
    fi
fi

# 3. Nettoyer les fichiers de backup compressés anciens (> 90 jours)
if [ -d "$DATA_DIR/logs" ]; then
    OLD_BACKUPS=$(find "$DATA_DIR/logs" -name "*.bak.gz" -type f -mtime +90 2>/dev/null | wc -l)
    if [ "$OLD_BACKUPS" -gt 0 ]; then
        log_info "Suppression de $OLD_BACKUPS fichiers de backup de plus de 90 jours..."
        find "$DATA_DIR/logs" -name "*.bak.gz" -type f -mtime +90 -delete 2>/dev/null
        log_info "✅ Backups nettoyés"
    fi
fi

# 4. Limiter la taille du cache GeoIP (garder max 10MB)
if [ -f "$DATA_DIR/cache/geoip-cache.json" ]; then
    CACHE_SIZE=$(stat -f%z "$DATA_DIR/cache/geoip-cache.json" 2>/dev/null || stat -c%s "$DATA_DIR/cache/geoip-cache.json" 2>/dev/null || echo 0)
    if [ "$CACHE_SIZE" -gt 10485760 ]; then  # 10MB
        log_info "Réduction du cache GeoIP (${CACHE_SIZE} bytes)..."
        temp_cache=$(mktemp)
        jq 'to_entries | sort_by(.key) | reverse | .[0:50000] | from_entries' "$DATA_DIR/cache/geoip-cache.json" > "$temp_cache" 2>/dev/null
        if [ $? -eq 0 ] && [ -s "$temp_cache" ]; then
            mv "$temp_cache" "$DATA_DIR/cache/geoip-cache.json"
            log_info "✅ Cache GeoIP réduit"
        else
            rm -f "$temp_cache"
        fi
    fi
fi


echo ""
echo "✅ Nettoyage terminé !"

