#!/bin/bash

# Script de désinstallation du Honeypot Monitor
# Nettoie complètement l'installation pour repartir sur de bonnes bases

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
    ./scripts/monitor.sh cleanup 2>/dev/null || true
    ./scripts/monitor.sh stop 2>/dev/null || true
    echo "   ✅ Monitoring arrêté"
else
    echo "   ℹ️  Script monitor.sh introuvable, skip"
fi

# 2. Nettoyer les processus fantômes
echo ""
echo "2️⃣  Nettoyage des processus restants..."
sudo pkill -f "journalctl.*endlessh.*-f" 2>/dev/null || true
pkill -f "monitor.sh" 2>/dev/null || true
echo "   ✅ Processus nettoyés"

# 3. Supprimer les fichiers temporaires
echo ""
echo "3️⃣  Suppression des fichiers temporaires..."
rm -f /tmp/honeypot-monitor.pid
rm -f /tmp/honeypot-monitor.lock
echo "   ✅ Fichiers temporaires supprimés"

# 4. Supprimer les alias du .bashrc
echo ""
echo "4️⃣  Suppression des alias dans ~/.bashrc..."

if [ -f "$BASHRC" ]; then
    # Créer une backup
    cp "$BASHRC" "$BASHRC.backup.$(date +%Y%m%d_%H%M%S)"
    
    # Utiliser grep -v pour filtrer toutes les lignes problématiques en une fois
    grep -v "alias honeypot-stats" "$BASHRC" | \
    grep -v "alias honeypot-dashboard" | \
    grep -v "alias honeypot-monitor" | \
    grep -v "alias scan-web" | \
    grep -v "alias capture-web" | \
    grep -v "# Honeypot Monitor Aliases" > "$BASHRC.tmp" 2>/dev/null
    
    # Remplacer le fichier original
    mv "$BASHRC.tmp" "$BASHRC"
    
    echo "   ✅ Alias supprimés de ~/.bashrc"
    echo "   💾 Backup créé automatiquement"
else
    echo "   ℹ️  ~/.bashrc introuvable, skip"
fi

# 5. Supprimer les alias de la session actuelle
echo ""
echo "5️⃣  Suppression des alias de la session actuelle..."
unalias honeypot-stats honeypot-dashboard honeypot-monitor scan-web capture-web 2>/dev/null || true
echo "   ✅ Alias supprimés de la session"

# 6. Demander si on garde les données
echo ""
echo "6️⃣  Gestion des données..."
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

# 7. Supprimer la configuration
echo ""
echo "7️⃣  Gestion de la configuration..."
if [ -d "$SCRIPT_DIR/config" ]; then
    if [ -f "$SCRIPT_DIR/config/config" ]; then
        if ask_confirmation "   ❓ Voulez-vous supprimer la configuration personnalisée ?"; then
            rm -f "$SCRIPT_DIR/config/config"
            echo "   ✅ Configuration supprimée (config.example conservé)"
        else
            echo "   ℹ️  Configuration conservée"
        fi
    else
        echo "   ℹ️  Pas de configuration personnalisée"
    fi
fi

# 8. Supprimer le répertoire honeypot-monitor
echo ""
echo "8️⃣  Suppression du répertoire d'installation..."
if ask_confirmation "   ❓ Voulez-vous supprimer complètement ~/honeypot-monitor ?"; then
    cd "$HOME"
    rm -rf "$SCRIPT_DIR"
    echo "   ✅ Répertoire ~/honeypot-monitor supprimé"
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
    echo ""
    echo "💡 Pour terminer la désinstallation :"
    echo "   rm -rf ~/honeypot-monitor"
fi
echo ""
echo "🔄 IMPORTANT : Rechargez votre .bashrc pour finaliser :"
echo "   source ~/.bashrc"
echo ""
echo "   Ou fermez/rouvrez votre terminal"
