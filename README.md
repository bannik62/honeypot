# 🍯 Honeypot Monitor

Système de monitoring temps réel pour Endlessh (honeypot SSH).

## 🎯 Fonctionnalités

- ⚡ Monitoring temps réel des connexions au honeypot
- 🌍 Géolocalisation des attaquants (base GeoIP locale)
- 📊 Dashboard ASCII avec statistiques live
- 📈 Logs structurés en CSV pour analyse
- 💾 Cache intelligent pour limiter les lookups
- 🚀 Léger : <1% CPU, ~10MB RAM

## 📋 Prérequis

### 1. Endlessh Installé et Configuré

Ce système nécessite Endlessh comme honeypot SSH. Assurez-vous que :

- ✅ Endlessh est installé : sudo apt install endlessh
- ✅ Endlessh est configuré pour écouter sur le port 22
- ✅ Le service systemd endlessh.service est actif : sudo systemctl status endlessh
- ✅ Endlessh génère des logs avec le format ACCEPT host=IP port=PORT

Configuration Endlessh recommandée (/etc/endlessh/config) :
Port 22
Delay 10000
MaxLineLength 32
MaxClients 4096
LogLevel 1

Service systemd (/usr/lib/systemd/system/endlessh.service) :
- Doit avoir AmbientCapabilities=CAP_NET_BIND_SERVICE pour écouter sur port 22
- PrivateUsers=true doit être commenté

### 2. Système

- Ubuntu/Debian
- sudo pour accéder aux logs systemd
- geoip-bin et geoip-database (installés automatiquement)
- jq pour parser JSON (installé automatiquement)

## 🚀 Installation

git clone https://github.com/bannik62/honeypot.git
cd honeypot
sudo ./install.sh
cp config/config.example config/config
nano config/config

## 📊 Utilisation

### Commandes Rapides

./scripts/stats.sh          # Stats rapides
./scripts/dashboard.sh      # Dashboard temps réel (écoute live)
./scripts/monitor.sh start  # Monitoring background (optionnel)

### Alias

honeypot-stats      # Affiche les statistiques
honeypot-dashboard  # Lance le dashboard temps réel
honeypot-monitor    # Gère le monitoring (start/stop/status)

## 📂 Structure

honeypot-monitor/
├── data/
│   ├── logs/connections.csv
│   └── cache/geoip-cache.json
├── scripts/
│   ├── monitor.sh
│   ├── stats.sh
│   ├── dashboard.sh
│   └── parser.sh
├── config/config
├── install.sh
└── README.md

## 🌍 Géolocalisation

Utilise la base de données GeoIP locale (gratuite) :
- Pas de limite de requêtes
- Lookup < 1ms
- Cache des résultats pour optimiser

## 📈 Format des Logs

Les connexions sont enregistrées en CSV :

timestamp,ip,port,country
2025-12-22 10:30:45,51.68.31.100,56954,FR
2025-12-22 10:31:12,45.78.217.123,52341,US

## 🔧 Configuration

Fichier config/config :

DATA_DIR="/home/ubuntu/honeypot-monitor/data"
SERVICE_NAME="endlessh"
REFRESH_INTERVAL=5
ENABLE_NOTIFICATIONS=false

## 📊 Exemple de Sortie

Stats Rapides (stats.sh) :

🍯 HONEYPOT STATISTICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 Total Connections: 127
🌍 Unique IPs: 89
🌎 TOP 5 COUNTRIES:
  FR: 45 (35%)
  US: 23 (18%)
  RU: 15 (12%)
🔥 LATEST 5 CONNECTIONS:
  10:45:23 - 45.78.217.123 (US) - port 52341

Dashboard Temps Réel (dashboard.sh) :

Le dashboard affiche les stats en continu et montre immédiatement chaque nouvelle connexion.

## 🔄 Workflow Recommandé

1. Endlessh capte les bots sur le port 22
2. journalctl enregistre les logs avec ACCEPT host=IP port=PORT
3. dashboard.sh écoute en temps réel et affiche immédiatement
4. Les connexions sont enregistrées dans connections.csv
5. Les stats se mettent à jour automatiquement

## 📝 Licence

MIT - Libre d'utilisation

## 📬 Contact

GitHub: @bannik62
