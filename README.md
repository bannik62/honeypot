# 🍯 Honeypot Monitor

Système de monitoring temps réel pour Endlessh (honeypot SSH) avec capture d'écran des interfaces web des attaquants.

## 🎯 Fonctionnalités

- ⚡ Monitoring temps réel des connexions au honeypot
- 🌍 Géolocalisation des attaquants (base GeoIP locale)
- 📊 Dashboard ASCII avec statistiques live
- 📈 Logs structurés en CSV pour analyse
- 🔍 Scan des interfaces web avec nmap
- 📸 Capture d'écran automatique des interfaces web
- 🛡️ Scan de vulnérabilités avec nikto
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

### 2. Système et Dépendances

- Ubuntu/Debian
- sudo pour accéder aux logs systemd
- geoip-bin et geoip-database (installés automatiquement)
- jq pour parser JSON (installé automatiquement)
- chromium-browser pour les captures d'écran (installé automatiquement)
- nmap pour scanner les ports (installé automatiquement)
- nikto pour scanner les vulnérabilités (optionnel, installé manuellement)

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

### Scan et Capture des Interfaces Web

scan-web      # Scanne les IPs avec nmap et crée un CSV avec les interfaces web
capture-web   # Capture les interfaces web + scan nikto (lance scan-web si nécessaire)

### Alias

honeypot-stats      # Affiche les statistiques
honeypot-dashboard  # Lance le dashboard temps réel
honeypot-monitor    # Gère le monitoring (start/stop/status)
scan-web           # Scan nmap des interfaces web
capture-web        # Capture d'écran + scan nikto

## 📂 Structure

honeypot-monitor/
├── data/
│   ├── logs/
│   │   ├── connections.csv      # Toutes les connexions Endlessh
│   │   └── web_interfaces.csv   # Interfaces web trouvées (créé par nmap)
│   ├── screenshots/             # Captures d'écran des interfaces web
│   │   ├── {IP}_{PORT}_{TIMESTAMP}.png
│   │   ├── {IP}_{PORT}_{TIMESTAMP}.txt
│   │   └── {IP}_{PORT}_{TIMESTAMP}_nikto.txt
│   └── cache/
│       └── geoip-cache.json     # Cache géolocalisation
├── scripts/
│   ├── monitor.sh    # Monitoring background (optionnel)
│   ├── stats.sh      # Statistiques rapides
│   ├── dashboard.sh  # Dashboard temps réel
│   ├── parser.sh     # Parser de logs Endlessh
│   ├── nmap-to-csv.sh    # Scan nmap → CSV interfaces web
│   └── nikto-capture.sh  # Capture d'écran + scan nikto
├── config/
│   └── config        # Configuration
├── install.sh        # Script d'installation
└── README.md

## 🔄 Workflow Complet

### 1. Endlessh capture les bots
- Les bots se connectent au port 22
- Endlessh les piège et génère des logs ACCEPT

### 2. Monitoring et logs
- dashboard.sh écoute journalctl en temps réel
- Les connexions sont enregistrées dans connections.csv

### 3. Scan des interfaces web (optionnel)
- scan-web : nmap scanne les IPs capturées
- Détecte les ports HTTP ouverts (80, 443, 8080, etc.)
- Crée web_interfaces.csv avec les IPs qui ont des interfaces web

### 4. Capture d'écran et analyse (optionnel)
- capture-web : lit web_interfaces.csv
- Prend des captures PNG avec chromium-browser
- Scanne les vulnérabilités avec nikto
- Sauvegarde dans data/screenshots/

## 🌍 Géolocalisation

Utilise la base de données GeoIP locale (gratuite) :
- Pas de limite de requêtes
- Lookup < 1ms
- Cache des résultats pour optimiser

## 📈 Format des Logs

### connections.csv (Endlessh)
timestamp,ip,port,country
2025-12-22 10:30:45,51.68.31.100,56954,FR

### web_interfaces.csv (nmap)
timestamp,ip,port,protocol,url
2025-12-22 12:00:00,139.19.117.130,80,http,http://139.19.117.130:80

## 🔧 Configuration

Fichier config/config :

DATA_DIR="/home/ubuntu/honeypot-monitor/data"
SERVICE_NAME="endlessh"
REFRESH_INTERVAL=5
ENABLE_NOTIFICATIONS=false

## 📊 Exemple de Sortie

### Stats Rapides (stats.sh)

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

### Dashboard Temps Réel (dashboard.sh)

Le dashboard affiche les stats en continu et montre immédiatement chaque nouvelle connexion.

## 📸 Captures d'Écran

Les captures sont sauvegardées dans data/screenshots/ :
- Fichiers PNG : captures d'écran des interfaces web
- Fichiers .txt : métadonnées (IP, port, URL, timestamp)
- Fichiers _nikto.txt : rapports de vulnérabilités (si nikto est installé)

## 📝 Licence

MIT - Libre d'utilisation

## 📬 Contact

GitHub: @bannik62
