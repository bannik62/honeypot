#!/bin/bash

# Script de désinstallation du Honeypot Monitor
# Nettoie complètement l'installation pour repartir sur de bonnes bases

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Utiliser $HOME pour cohérence (uninstall.sh est lancé par l'utilisateur, pas sudo)
BASHRC="$HOME/.bashrc"

echo "🗑️  DÉSINSTALLATION DU HONEYPOT MONITOR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Fonction pour demander confirmation
ask_confirmation() {
    local prompt="$1"
    read -p "$prompt (o/N) : " response
    case "$response" in
        [oO]|[oO][uU][iI]|yes|YES)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# 1. Arrêter le monitoring
echo "1️⃣  Arrêt du monitoring..."
if [ -f "$SCRIPT_DIR/scripts/monitor.sh" ]; then
    cd "$SCRIPT_DIR"
    if ask_confirmation "   ❓ Arrêter le monitoring en cours ?"; then
        ./scripts/monitor.sh cleanup 2>/dev/null || true
        ./scripts/monitor.sh stop 2>/dev/null || true
        echo "   ✅ Monitoring arrêté"
    else
        echo "   ℹ️  Monitoring conservé"
    fi
else
    echo "   ℹ️  Script monitor.sh introuvable, skip"
fi

# 2. Supprimer le cron si présent
echo ""
echo "2️⃣  Suppression du cron automatique..."
if crontab -l 2>/dev/null | grep -q "run-all-scans.sh"; then
    if ask_confirmation "   ❓ Supprimer le cron de scans automatiques ?"; then
        crontab -l 2>/dev/null | grep -v "run-all-scans.sh" | crontab -
        echo "   ✅ Cron supprimé"
    else
        echo "   ℹ️  Cron conservé"
    fi
else
    echo "   ℹ️  Aucun cron trouvé"
fi

# 3. Nettoyer les processus fantômes
echo ""
echo "3️⃣  Nettoyage des processus restants..."
if ask_confirmation "   ❓ Nettoyer les processus fantômes ?"; then
    sudo pkill -f "journalctl.*endlessh.*-f" 2>/dev/null || true
    pkill -f "monitor.sh" 2>/dev/null || true
    echo "   ✅ Processus nettoyés"
else
    echo "   ℹ️  Processus conservés"
fi

# 4. Supprimer les fichiers temporaires
echo ""
echo "4️⃣  Suppression des fichiers temporaires..."
if ask_confirmation "   ❓ Supprimer les fichiers temporaires (PID, lock) ?"; then
    rm -f /tmp/honeypot-monitor.pid
    rm -f /tmp/honeypot-monitor.lock
    echo "   ✅ Fichiers temporaires supprimés"
else
    echo "   ℹ️  Fichiers temporaires conservés"
fi

# 5. Supprimer les alias du .bashrc avec sed (méthode fiable)
echo ""
echo "5️⃣  Suppression des alias dans ~/.bashrc..."

if [ -f "$BASHRC" ]; then
    # Vérifier si des alias existent (utiliser grep -E pour les expressions régulières)
    if grep -qE "alias honeypot-stats|alias honeypot-dashboard|alias honeypot-monitor|alias scan-web|alias capture-web|alias vuln-scan|alias honeypot-dig|alias honeypot-search-nikto|alias honeypot-logs|alias setup-auto-scan|alias count-ips|alias piegeAbot|alias honeypot-make-visualizer-data|honeypot-start-server()|# Honeypot Monitor Aliases" "$BASHRC" 2>/dev/null; then
        echo "   📋 Alias trouvés dans ~/.bashrc"
        if ask_confirmation "   ❓ Supprimer les alias du .bashrc ?"; then
            # Créer une backup
            cp "$BASHRC" "$BASHRC.backup.$(date +%Y%m%d_%H%M%S)"
            
            # Utiliser sed pour supprimer les lignes (une par une, plus fiable)
            sed -i '/^alias honeypot-stats/d' "$BASHRC"
            sed -i '/^alias honeypot-dashboard/d' "$BASHRC"
            sed -i '/^alias honeypot-monitor/d' "$BASHRC"
            sed -i '/^alias scan-web/d' "$BASHRC"
            sed -i '/^alias capture-web/d' "$BASHRC"
            sed -i '/^alias vuln-scan/d' "$BASHRC"
            sed -i '/^alias honeypot-dig/d' "$BASHRC"
            sed -i '/^alias honeypot-search-nikto/d' "$BASHRC"
            sed -i '/^alias honeypot-logs/d' "$BASHRC"
            sed -i '/^alias setup-auto-scan/d' "$BASHRC"
            sed -i '/^alias count-ips/d' "$BASHRC"
            sed -i '/^alias piegeAbot/d' "$BASHRC"
            sed -i '/^alias honeypot-make-visualizer-data/d' "$BASHRC"
            sed -i '/^honeypot-start-server()/d' "$BASHRC"
            sed -i '/# Honeypot Monitor Aliases/d' "$BASHRC"
            
            # Nettoyer les lignes vides multiples
            sed -i '/^$/N;/^\n$/d' "$BASHRC"
            
            echo "   ✅ Alias supprimés de ~/.bashrc"
            echo "   💾 Backup créé automatiquement"
            
            # Vérifier que c'est bien supprimé
            if grep -qE "alias honeypot-stats|alias honeypot-dashboard|alias honeypot-monitor|alias scan-web|alias capture-web|alias vuln-scan|alias honeypot-dig|alias honeypot-search-nikto|alias honeypot-logs|alias setup-auto-scan|alias count-ips|alias piegeAbot|alias honeypot-make-visualizer-data|honeypot-start-server()" "$BASHRC" 2>/dev/null; then
                echo "   ⚠️  Attention : certains alias semblent toujours présents"
                echo "   💡 Essayez de recharger le .bashrc : source ~/.bashrc"
            fi
        else
            echo "   ℹ️  Alias conservés dans .bashrc"
        fi
    else
        echo "   ℹ️  Aucun alias honeypot trouvé dans .bashrc"
    fi
else
    echo "   ℹ️  ~/.bashrc introuvable, skip"
fi

# 6. Supprimer les alias de la session actuelle
echo ""
echo "6️⃣  Suppression des alias de la session actuelle..."
if ask_confirmation "   ❓ Supprimer les alias de la session actuelle ?"; then
    unalias honeypot-stats honeypot-dashboard honeypot-monitor scan-web capture-web vuln-scan honeypot-dig honeypot-search-nikto honeypot-make-visualizer-data 2>/dev/null || true
    unset -f honeypot-start-server 2>/dev/null || true
    echo "   ✅ Alias supprimés de la session"
else
    echo "   ℹ️  Alias de session conservés"
fi

# 7. Demander si on garde les données
echo ""
echo "7️⃣  Gestion des données..."
if [ -d "$SCRIPT_DIR/data" ]; then
    echo "   📁 Répertoire de données trouvé : $SCRIPT_DIR/data"
    echo "   📊 Contenu :"
    du -sh "$SCRIPT_DIR/data"/* 2>/dev/null | head -5 || echo "      (vide)"
    
    if ask_confirmation "   ❓ Voulez-vous supprimer TOUTES les données (logs, captures, cache) ?"; then
        rm -rf "$SCRIPT_DIR/data"
        echo "   ✅ Données supprimées"
    else
        echo "   ℹ️  Données conservées"
    fi
else
    echo "   ℹ️  Pas de répertoire de données"
fi

# 8. Supprimer la configuration
echo ""
echo "8️⃣  Gestion de la configuration..."
if [ -d "$SCRIPT_DIR/config" ]; then
    if [ -f "$SCRIPT_DIR/config/config" ]; then
        echo "   📋 Configuration personnalisée trouvée"
        if ask_confirmation "   ❓ Voulez-vous supprimer la configuration personnalisée ?"; then
            rm -f "$SCRIPT_DIR/config/config"
            echo "   ✅ Configuration supprimée (config.example conservé)"
        else
            echo "   ℹ️  Configuration conservée"
        fi
    else
        echo "   ℹ️  Pas de configuration personnalisée (seulement config.example)"
    fi
else
    echo "   ℹ️  Pas de répertoire config"
fi

# 9. Supprimer le répertoire honeypot-monitor
echo ""
echo "9️⃣  Suppression du répertoire d'installation..."
if ask_confirmation "   ❓ Voulez-vous supprimer complètement le répertoire d'installation ?"; then
    cd "$HOME"
    rm -rf "$SCRIPT_DIR"
    echo "   ✅ Répertoire supprimé"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ DÉSINSTALLATION TERMINÉE"
    echo ""
    echo "💡 Pour réinstaller :"
    echo "   git clone https://github.com/bannik62/honeypot.git ~/honeypot-monitor"
    echo "   cd ~/honeypot-monitor"
    echo "   sudo ./install.sh"
    exit 0
else
    echo "   ℹ️  Répertoire conservé"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ DÉSINSTALLATION PARTIELLE TERMINÉE"
echo ""
echo "📋 Résumé :"
echo "   ✅ Monitoring arrêté"
echo "   ✅ Processus nettoyés"
echo "   ✅ Fichiers temporaires supprimés"
echo "   ✅ Alias supprimés du .bashrc"
echo "   ✅ Alias supprimés de la session actuelle"
if [ -d "$SCRIPT_DIR/data" ]; then
    echo "   ℹ️  Données conservées dans $SCRIPT_DIR/data"
fi
if [ -d "$SCRIPT_DIR" ]; then
    echo "   ℹ️  Répertoire conservé : $SCRIPT_DIR"
fi
echo ""
echo "🔄 IMPORTANT : Rechargez votre .bashrc pour finaliser :"
echo "   source ~/.bashrc"
echo ""
echo "   Ou fermez/rouvrez votre terminal"
