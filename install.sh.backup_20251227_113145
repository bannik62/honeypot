#!/bin/bash

# Script d'installation du système de monitoring honeypot

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/data"

echo "🍯 Installation du Honeypot Monitor..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   🛡️  HONEYPOT MONITOR INSTALLATION  🛡️"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Demander confirmation
echo "Cette installation va :"
echo "  • Installer les dépendances (geoip, jq, chromium, nmap, nikto)"
echo "  • Créer la structure de répertoires"
echo "  • Ajouter des alias dans ~/.bashrc"
echo ""
read -p "Voulez-vous continuer ? (o/N) : " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[OoYy]$ ]]; then
    echo "❌ Installation annulée."
    exit 0
fi

echo ""


# Vérifier si root
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  Cette installation nécessite sudo. Utilisez: sudo ./install.sh"
    exit 1
fi

# Installer les dépendances
echo "📦 Installation des dépendances..."
apt-get update -qq
apt-get install -y geoip-bin geoip-database jq chromium-browser nmap nikto > /dev/null 2>&1

# Créer la structure de répertoires
echo "📁 Création de la structure..."
mkdir -p "$DATA_DIR/logs" "$DATA_DIR/cache" "$SCRIPT_DIR/config"

# Créer le fichier de log CSV avec en-têtes si nécessaire
LOG_FILE="$DATA_DIR/logs/connections.csv"
if [ ! -f "$LOG_FILE" ]; then
    echo "timestamp,ip,port,country" > "$LOG_FILE"
    chown "$SUDO_USER:$SUDO_USER" "$LOG_FILE"
fi

# Créer le cache GeoIP si nécessaire
CACHE_FILE="$DATA_DIR/cache/geoip-cache.json"
if [ ! -f "$CACHE_FILE" ]; then
    echo "{}" > "$CACHE_FILE"
    chown "$SUDO_USER:$SUDO_USER" "$CACHE_FILE"
fi

# Rendre les scripts exécutables
chmod +x "$SCRIPT_DIR/scripts/"*.sh
chown -R "$SUDO_USER:$SUDO_USER" "$SCRIPT_DIR"

# Ajouter les alias dans .bashrc
BASHRC="/home/$SUDO_USER/.bashrc"

# S'assurer que SCRIPT_DIR est un chemin absolu (au cas où)
SCRIPT_DIR_ABS="$(cd "$SCRIPT_DIR" && pwd)"

if [ -f "$BASHRC" ]; then
    if ! grep -q "honeypot-stats" "$BASHRC"; then
        echo "" >> "$BASHRC"
        echo "# Honeypot Monitor Aliases" >> "$BASHRC"
        echo "alias honeypot-stats='cd \"$SCRIPT_DIR_ABS\" && ./scripts/stats.sh'" >> "$BASHRC"
        echo "alias honeypot-dashboard='cd \"$SCRIPT_DIR_ABS\" && ./scripts/dashboard.sh'" >> "$BASHRC"
        echo "alias honeypot-monitor='cd \"$SCRIPT_DIR_ABS\" && ./scripts/monitor.sh'" >> "$BASHRC"
        echo "alias scan-web='cd \"$SCRIPT_DIR_ABS\" && ./scripts/nmap-to-csv.sh'" >> "$BASHRC"
        echo "alias capture-web='cd \"$SCRIPT_DIR_ABS\" && ./scripts/nikto-capture.sh'" >> "$BASHRC"
        echo "✅ Aliases ajoutés à $BASHRC"
    else
        echo "ℹ️  Aliases déjà présents dans $BASHRC"
        echo "💡 Utilisez ./uninstall.sh puis réinstallez si vous voulez les mettre à jour"
    fi
fi

echo ""
echo "✅ Installation terminée !"
echo ""
echo "📋 Prochaines étapes:"
echo "   1. Créer le fichier de config: cp config/config.example config/config"
echo "   2. Éditer si nécessaire: nano config/config"
echo "   3. Lancer le monitoring: ./scripts/monitor.sh start"
echo "   4. Voir les stats: ./scripts/stats.sh"
echo "   5. Dashboard live: ./scripts/dashboard.sh"
echo ""
echo "💡 Ou utilisez les alias: honeypot-stats, honeypot-dashboard, honeypot-monitor, scan-web, capture-web"
