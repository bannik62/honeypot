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
echo "  • installer les dépendances (geoip, jq, chromium, nmap, nikto, sqlite3)"
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
apt-get install -y geoip-bin geoip-database jq chromium-browser nmap nikto sqlite3 > /dev/null 2>&1

# Créer la structure de répertoires
echo "📁 Création de la structure..."
mkdir -p "$DATA_DIR/logs" "$DATA_DIR/cache" "$SCRIPT_DIR/config"

# Créer config depuis config.example si config n'existe pas
if [ ! -f "$SCRIPT_DIR/config/config" ]; then
    if [ -f "$SCRIPT_DIR/config/config.example" ]; then
        cp "$SCRIPT_DIR/config/config.example" "$SCRIPT_DIR/config/config"
        chown "$SUDO_USER:$SUDO_USER" "$SCRIPT_DIR/config/config"
        echo "✅ Fichier config créé depuis config.example"
    fi
fi

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
    # Vérifier et ajouter chaque alias individuellement
    ALIASES_ADDED=false
    
    if ! grep -q "# Honeypot Monitor Aliases" "$BASHRC" 2>/dev/null; then
        echo "" >> "$BASHRC"
        echo "# Honeypot Monitor Aliases" >> "$BASHRC"
    fi
    
    if ! grep -q "alias honeypot-stats=" "$BASHRC" 2>/dev/null; then
        echo "alias honeypot-stats='cd \"$SCRIPT_DIR_ABS\" && ./scripts/stats.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias honeypot-dashboard=" "$BASHRC" 2>/dev/null; then
        echo "alias honeypot-dashboard='cd \"$SCRIPT_DIR_ABS\" && ./scripts/dashboard.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias honeypot-monitor=" "$BASHRC" 2>/dev/null; then
        echo "alias honeypot-monitor='cd \"$SCRIPT_DIR_ABS\" && ./scripts/monitor.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias scan-web=" "$BASHRC" 2>/dev/null; then
        echo "alias scan-web='cd \"$SCRIPT_DIR_ABS\" && ./scripts/nmap-to-csv.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias capture-web=" "$BASHRC" 2>/dev/null; then
        echo "alias capture-web='cd \"$SCRIPT_DIR_ABS\" && ./scripts/nikto-capture.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias vuln-scan=" "$BASHRC" 2>/dev/null; then
        echo "alias vuln-scan='cd \"$SCRIPT_DIR_ABS\" && ./scripts/vuln-scan.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias honeypot-dig=" "$BASHRC" 2>/dev/null; then
        echo "alias honeypot-search-nikto='cd "$SCRIPT_DIR_ABS" && ./scripts/search-nikto.sh'" >> "$BASHRC"
        echo "alias honeypot-dig='cd \"$SCRIPT_DIR_ABS\" && ./scripts/dig-ip.sh'" >> "$BASHRC"
        echo "alias honeypot-search-nikto='cd "$SCRIPT_DIR_ABS" && ./scripts/search-nikto.sh'" >> "$BASHRC"
        echo "alias honeypot-search-nikto='cd "$SCRIPT_DIR_ABS" && ./scripts/search-nikto.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    
    if [ "$ALIASES_ADDED" = true ]; then
        echo "✅ Aliases ajoutés à $BASHRC"
    else
        echo "ℹ️  Tous les aliases sont déjà présents dans $BASHRC"
    fifi
    if ! grep -q "alias honeypot-dashboard=" "$BASHRC" 2>/dev/null; then
        echo "alias honeypot-dashboard='cd \"$SCRIPT_DIR_ABS\" && ./scripts/dashboard.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias honeypot-monitor=" "$BASHRC" 2>/dev/null; then
        echo "alias honeypot-monitor='cd \"$SCRIPT_DIR_ABS\" && ./scripts/monitor.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias scan-web=" "$BASHRC" 2>/dev/null; then
        echo "alias scan-web='cd \"$SCRIPT_DIR_ABS\" && ./scripts/nmap-to-csv.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias capture-web=" "$BASHRC" 2>/dev/null; then
        echo "alias capture-web='cd \"$SCRIPT_DIR_ABS\" && ./scripts/nikto-capture.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias vuln-scan=" "$BASHRC" 2>/dev/null; then
        echo "alias vuln-scan='cd \"$SCRIPT_DIR_ABS\" && ./scripts/vuln-scan.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias honeypot-dig=" "$BASHRC" 2>/dev/null; then
        echo "alias honeypot-search-nikto='cd "$SCRIPT_DIR_ABS" && ./scripts/search-nikto.sh'" >> "$BASHRC"
        echo "alias honeypot-dig='cd \"$SCRIPT_DIR_ABS\" && ./scripts/dig-ip.sh'" >> "$BASHRC"
        echo "alias honeypot-search-nikto='cd "$SCRIPT_DIR_ABS" && ./scripts/search-nikto.sh'" >> "$BASHRC"
        echo "alias honeypot-search-nikto='cd "$SCRIPT_DIR_ABS" && ./scripts/search-nikto.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    
    if [ "$ALIASES_ADDED" = true ]; then
        echo "✅ Aliases ajoutés à $BASHRC"
    else
        echo "ℹ️  Tous les aliases sont déjà présents dans $BASHRC"
    fi
    fi
fi

echo ""
echo "✅ Installation terminée !"
echo ""

echo "📋 Aliases disponibles :"
echo "   • honeypot-stats     → Afficher les statistiques"
echo "   • honeypot-dashboard → Dashboard en temps réel"
echo "   • honeypot-monitor   → Démarrer/arrêter le monitoring (start|stop|status|restart)"
echo "   • scan-web           → Scanner les ports web des IPs"
echo "   • capture-web        → Capturer les screenshots des interfaces web"
echo "   • vuln-scan          → Scanner les vulnérabilités avec nmap"
echo "   • honeypot-dig       → Requêtes DNS/WHOIS sur les IPs"
echo "   • honeypot-search-nikto → Recherche dans les rapports Nikto"
echo ""
echo "⚠️  Pour utiliser les aliases dans cette session :"
echo "   source ~/.bashrc"
echo "   (Ou ouvrez un nouveau terminal)"
echo ""
read -p "🚀 Voulez-vous démarrer le monitoring maintenant ? (o/N) : " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Oo]$ ]]; then
    echo "🚀 Démarrage du monitoring..."
    cd "$SCRIPT_DIR_ABS"
    ./scripts/monitor.sh start
    echo ""
    echo "✅ Monitoring démarré !"
    echo "💡 Utilisez 'honeypot-dashboard' pour voir le dashboard en temps réel"
else
    echo "ℹ️  Vous pourrez démarrer le monitoring plus tard avec :"
    echo "   honeypot-monitor start"
fi
