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

# Vérifier que SUDO_USER est défini
if [ -z "$SUDO_USER" ]; then
    echo "❌ Erreur: SUDO_USER n'est pas défini"
    echo "💡 Utilisez: sudo -u votre_utilisateur ./install.sh"
    exit 1
fi

# Vérifier que l'utilisateur existe
if ! id "$SUDO_USER" &>/dev/null; then
    echo "❌ Erreur: L'utilisateur '$SUDO_USER' n'existe pas"
    exit 1
fi

# Installer les dépendances
echo "📦 Installation des dépendances..."
apt-get update -qq
apt-get install -y geoip-bin geoip-database jq chromium-browser nmap nikto sqlite3 > /dev/null 2>&1

# Créer la structure de répertoires
echo "📁 Création de la structure..."
mkdir -p "$DATA_DIR/logs" "$DATA_DIR/cache" "$SCRIPT_DIR/config" "$SCRIPT_DIR/lib"

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
echo "🔧 Rendre les scripts exécutables..."
# Scripts dans scripts/
if [ -d "$SCRIPT_DIR/scripts" ]; then
    find "$SCRIPT_DIR/scripts" -name "*.sh" -type f -exec chmod +x {} \;
    echo "   ✅ Scripts dans scripts/ rendus exécutables"
fi
# Scripts dans lib/
if [ -d "$SCRIPT_DIR/lib" ]; then
    find "$SCRIPT_DIR/lib" -name "*.sh" -type f -exec chmod +x {} \;
    echo "   ✅ Scripts dans lib/ rendus exécutables"
fi
# Scripts à la racine (install.sh, uninstall.sh)
if [ -f "$SCRIPT_DIR/install.sh" ]; then
    chmod +x "$SCRIPT_DIR/install.sh"
fi
if [ -f "$SCRIPT_DIR/uninstall.sh" ]; then
    chmod +x "$SCRIPT_DIR/uninstall.sh"
fi

# Définir les permissions et propriétaire
chown -R "$SUDO_USER:$SUDO_USER" "$SCRIPT_DIR"

# Ajouter les alias dans .bashrc
# Utiliser le home directory de l'utilisateur (peut être ailleurs que /home/)
USER_HOME=$(eval echo ~"$SUDO_USER")
BASHRC="$USER_HOME/.bashrc"

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
        echo "alias honeypot-dig='cd \"$SCRIPT_DIR_ABS\" && ./scripts/dig-ip.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias honeypot-search-nikto=" "$BASHRC" 2>/dev/null; then
        echo "alias honeypot-search-nikto='cd \"$SCRIPT_DIR_ABS\" && ./scripts/search-nikto.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias honeypot-logs=" "$BASHRC" 2>/dev/null; then
        echo "alias honeypot-logs='tail -n 50 -f \"$SCRIPT_DIR_ABS/data/logs/run-all-scans.log\"'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias setup-auto-scan=" "$BASHRC" 2>/dev/null; then
        echo "alias setup-auto-scan='cd \"$SCRIPT_DIR_ABS\" && ./scripts/setup-auto-scan.sh'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias count-ips=" "$BASHRC" 2>/dev/null; then
        echo "alias count-ips='echo \"📊 Journal endlessh (lignes ACCEPT):\" && sudo journalctl -u endlessh -o cat --no-pager 2>/dev/null | grep \"ACCEPT\" | grep -oE \"[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\" | sort -u | wc -l && echo \"📊 connections.csv:\" && tail -n +2 \"$SCRIPT_DIR_ABS/data/logs/connections.csv\" 2>/dev/null | cut -d\",\" -f2 | sort -u | wc -l && echo \"📊 Différence (manquantes dans connections.csv):\" && comm -23 <(sudo journalctl -u endlessh -o cat --no-pager 2>/dev/null | grep \"ACCEPT\" | grep -oE \"[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\" | sort -u) <(tail -n +2 \"$SCRIPT_DIR_ABS/data/logs/connections.csv\" 2>/dev/null | cut -d\",\" -f2 | sort -u | grep -E \"^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}$\") | wc -l'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    if ! grep -q "alias piegeAbot=" "$BASHRC" 2>/dev/null; then
        echo "alias piegeAbot='sudo journalctl -u endlessh -f'" >> "$BASHRC"
        ALIASES_ADDED=true
    fi
    
    if [ "$ALIASES_ADDED" = true ]; then
        echo "✅ Aliases ajoutés à $BASHRC"
    else
        echo "ℹ️  Tous les aliases sont déjà présents dans $BASHRC"
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
echo "   • honeypot-logs      → Suivre les logs des scans (tail -f)"
echo "   • setup-auto-scan    → Configurer les scans automatiques"
echo "   • count-ips          → Compter les IPs (journal vs connections.csv)"
echo "   • piegeAbot          → Suivre les connexions en temps réel (journalctl)"
echo ""
echo "⚠️  Pour utiliser les aliases dans cette session :"
echo "   source ~/.bashrc"
echo "   (Ou ouvrez un nouveau terminal)"
echo ""

# Configuration de la mise à jour automatique
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   ⏰ Configuration de la mise à jour automatique"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Voulez-vous activer la mise à jour automatique des scans ?"
echo "  • scan-web (nmap-to-csv)"
echo "  • capture-web (nikto-capture)"
echo "  • honeypot-dig (dig-ip)"
echo "  • vuln-scan"
echo ""
read -p "Activer la mise à jour automatique ? (O/n) [Oui par défaut] : " -n 1 -r
echo ""
AUTO_SCAN_ENABLED="true"
if [[ $REPLY =~ ^[Nn]$ ]]; then
    AUTO_SCAN_ENABLED="false"
fi

if [ "$AUTO_SCAN_ENABLED" = "true" ]; then
    echo ""
    read -p "Toutes les combien d'heures ? (1-23) [1 par défaut] : " AUTO_SCAN_HOUR
    AUTO_SCAN_HOUR=${AUTO_SCAN_HOUR:-1}
    if ! [[ "$AUTO_SCAN_HOUR" =~ ^[0-9]+$ ]] || [ "$AUTO_SCAN_HOUR" -lt 1 ] || [ "$AUTO_SCAN_HOUR" -gt 23 ]; then
        AUTO_SCAN_HOUR=1
        echo "⚠️  Valeur invalide, utilisation de 1 heure par défaut"
    fi
fi

# Ajouter dans le fichier config
CONFIG_FILE="$SCRIPT_DIR/config/config"
if [ -f "$CONFIG_FILE" ]; then
    # Supprimer les anciennes valeurs si elles existent
    sed -i "/^AUTO_SCAN_ENABLED=/d" "$CONFIG_FILE"
    sed -i "/^AUTO_SCAN_HOUR=/d" "$CONFIG_FILE"
    # Ajouter les nouvelles valeurs
    echo "" >> "$CONFIG_FILE"
    echo "# Mise à jour automatique des scans (true/false)" >> "$CONFIG_FILE"
    echo "AUTO_SCAN_ENABLED=$AUTO_SCAN_ENABLED" >> "$CONFIG_FILE"
    if [ "$AUTO_SCAN_ENABLED" = "true" ]; then
        echo "# Intervalle entre chaque exécution automatique (heures, 1-23)" >> "$CONFIG_FILE"
        echo "AUTO_SCAN_HOUR=$AUTO_SCAN_HOUR" >> "$CONFIG_FILE"
    else
        echo "# AUTO_SCAN_HOUR=1  # Non utilisé si AUTO_SCAN_ENABLED=false" >> "$CONFIG_FILE"
    fi
fi

# Créer le cron si activé
if [ "$AUTO_SCAN_ENABLED" = "true" ]; then
    CRON_USER="$SUDO_USER"
    CRON_COMMAND="0 * * * * $SCRIPT_DIR_ABS/scripts/run-all-scans.sh"
    # Si l'heure est différente de 1, ajuster le cron
    if [ "$AUTO_SCAN_HOUR" != "1" ]; then
        CRON_COMMAND="0 */$AUTO_SCAN_HOUR * * * $SCRIPT_DIR_ABS/scripts/run-all-scans.sh"
    fi
    # Vérifier si le cron existe déjà
    if ! sudo -u "$CRON_USER" crontab -l 2>/dev/null | grep -q "run-all-scans.sh"; then
        (sudo -u "$CRON_USER" crontab -l 2>/dev/null; echo "$CRON_COMMAND") | sudo -u "$CRON_USER" crontab -
        echo "✅ Cron ajouté : exécution toutes les $AUTO_SCAN_HOUR heure(s)"
    else
        # Remplacer le cron existant
        sudo -u "$CRON_USER" crontab -l 2>/dev/null | grep -v "run-all-scans.sh" | sudo -u "$CRON_USER" crontab -
        (sudo -u "$CRON_USER" crontab -l 2>/dev/null; echo "$CRON_COMMAND") | sudo -u "$CRON_USER" crontab -
        echo "✅ Cron mis à jour : exécution toutes les $AUTO_SCAN_HOUR heure(s)"
    fi
else
    # Supprimer le cron si désactivé
    if sudo -u "$SUDO_USER" crontab -l 2>/dev/null | grep -q "run-all-scans.sh"; then
        sudo -u "$SUDO_USER" crontab -l 2>/dev/null | grep -v "run-all-scans.sh" | sudo -u "$SUDO_USER" crontab -
        echo "✅ Cron supprimé (mise à jour automatique désactivée)"
    fi
fi
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
