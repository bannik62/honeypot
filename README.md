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

- ✅ Endlessh est installé : `sudo apt install endlessh`
- ✅ Endlessh est configuré pour écouter sur le port 22
- ✅ Le service systemd endlessh.service est actif : `sudo systemctl status endlessh`
- ✅ Endlessh génère des logs avec le format ACCEPT host=IP port=PORT

**Configuration Endlessh recommandée** (`/etc/endlessh/config`) :
```
Port 22
Delay 10000
MaxLineLength 32
MaxClients 4096
LogLevel 1
```

**Service systemd** (`/usr/lib/systemd/system/endlessh.service`) :
- Doit avoir `AmbientCapabilities=CAP_NET_BIND_SERVICE` pour écouter sur port 22
- `PrivateUsers=true` doit être commenté

### 2. Système et Dépendances

- Ubuntu/Debian
- `sudo` pour accéder aux logs systemd
- `geoip-bin` et `geoip-database` (installés automatiquement)
- `jq` pour parser JSON (installés automatiquement)
- `chromium-browser` pour les captures d'écran (installé automatiquement)
- `nmap` pour scanner les ports (installé automatiquement)
- `nikto` pour scanner les vulnérabilités (optionnel, installé manuellement)

## 🚀 Installation

```bash
git clone https://github.com/bannik62/honeypot.git
cd honeypot
sudo ./install.sh
cp config/config.example config/config
nano config/config
```

## 📊 Utilisation

### Commandes de Monitoring

```bash
# Stats rapides
./scripts/stats.sh

# Dashboard temps réel (écoute live)
./scripts/dashboard.sh

# Monitoring background (optionnel)
./scripts/monitor.sh start
./scripts/monitor.sh stop
./scripts/monitor.sh status
```

### Scan et Capture des Interfaces Web

```bash
# Scanne les IPs avec nmap et crée un CSV avec les interfaces web
scan-web

# Capture les interfaces web + scan nikto (lance scan-web si nécessaire)
capture-web
```

### Alias Disponibles

```bash
honeypot-stats      # Affiche les statistiques
honeypot-dashboard  # Lance le dashboard temps réel
honeypot-monitor    # Gère le monitoring (start/stop/status)
scan-web           # Scan nmap des interfaces web
capture-web        # Capture d'écran + scan nikto
```

## 📂 Structure du Projet

```
honeypot-monitor/
├── data/
│   ├── logs/
│   │   ├── connections.csv      # Toutes les connexions Endlessh
│   │   └── web_interfaces.csv   # Interfaces web trouvées (créé par nmap)
│   ├── screenshots/             # Captures d'écran des interfaces web
│   │   ├── 192.168.1.100_80_20251222_120430.png
│   │   ├── 192.168.1.100_80_20251222_120430.txt
│   │   └── 192.168.1.100_80_20251222_120430_nikto.txt
│   └── cache/
│       └── geoip-cache.json     # Cache géolocalisation
├── scripts/
│   ├── monitor.sh         # Monitoring background (optionnel)
│   ├── stats.sh           # Statistiques rapides
│   ├── dashboard.sh       # Dashboard temps réel
│   ├── parser.sh          # Parser de logs Endlessh
│   ├── nmap-to-csv.sh     # Scan nmap → CSV interfaces web
│   └── nikto-capture.sh   # Capture d'écran + scan nikto
├── config/
│   └── config             # Configuration
├── install.sh             # Script d'installation
└── README.md
```

## 🔄 Workflow Complet

### 1. Endlessh capture les bots

Les bots se connectent au port 22. Endlessh les piège et génère des logs `ACCEPT host=IP port=PORT`.

### 2. Monitoring et logs

- `dashboard.sh` écoute `journalctl -f` en temps réel
- Les connexions sont enregistrées dans `connections.csv`
- Chaque IP est géolocalisée (avec cache pour optimisation)

### 3. Scan des interfaces web (optionnel)

- `scan-web` : nmap scanne les IPs capturées
- Détecte les ports HTTP ouverts (80, 443, 8080, 8443, 8000, 8888)
- Crée `web_interfaces.csv` avec les IPs qui ont des interfaces web

### 4. Capture d'écran et analyse (optionnel)

- `capture-web` : lit `web_interfaces.csv`
- Prend des captures PNG avec `chromium-browser --headless`
- Scanne les vulnérabilités avec nikto (si installé)
- Sauvegarde dans `data/screenshots/`

## 🌍 Géolocalisation

Utilise la base de données GeoIP locale (gratuite) :
- Pas de limite de requêtes
- Lookup < 1ms
- Cache intelligent : les IPs déjà géolocalisées sont mises en cache dans `data/cache/geoip-cache.json` pour éviter les requêtes répétées

## 📈 Format des Logs

### connections.csv (Endlessh)

```csv
timestamp,ip,port,country
2025-12-22 10:30:45,192.168.1.100,56954,FR
2025-12-22 10:31:12,10.0.0.50,52341,US
```

### web_interfaces.csv (nmap)

```csv
timestamp,ip,port,protocol,url
2025-12-22 12:00:00,192.168.1.100,80,http,http://192.168.1.100:80
2025-12-22 12:00:01,192.168.1.100,443,https,https://192.168.1.100:443
```

## 🔧 Configuration

Fichier `config/config` :

# Répertoire des données (logs, cache)
DATA_DIR="/home/ubuntu/honeypot-monitor/data"

# Nom du service systemd à monitorer
SERVICE_NAME="endlessh"

# Intervalle de rafraîchissement du dashboard (secondes)
REFRESH_INTERVAL=5

# Activer les notifications (true/false)
ENABLE_NOTIFICATIONS=false### Explication des Paramètres

**DATA_DIR** : Chemin vers le répertoire qui contient les logs, cache et captures d'écran.
- **Par défaut** : `/home/ubuntu/honeypot-monitor/data`
- **Modifier si** : Vous voulez stocker les données ailleurs (ex: `/var/log/honeypot`)

**SERVICE_NAME** : Nom du service systemd à monitorer.
- **Par défaut** : `endlessh`
- **Modifier si** : Vous utilisez un autre nom de service pour Endlessh

**REFRESH_INTERVAL** : Délai (en secondes) entre chaque rafraîchissement du dashboard.
- **Par défaut** : `5` secondes
- **Modifier si** : Vous voulez un rafraîchissement plus rapide (1-2s) ou plus lent (10s+)

**ENABLE_NOTIFICATIONS** : Active les notifications (fonctionnalité future).
- **Par défaut** : `false`
- **Modifier si** : Cette fonctionnalité est implémentée plus tard

## 📊 Exemple de Sortie

### Stats Rapides (`stats.sh`)

```
🍯 HONEYPOT STATISTICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 Total Connections: 127
🌍 Unique IPs: 89

🌎 TOP 5 COUNTRIES:
  FR: 45 (35%)
  US: 23 (18%)
  RU: 15 (12%)
  DE: 8 (6%)
  CN: 7 (6%)

🔥 LATEST 5 CONNECTIONS:
  10:45:23 - 192.168.1.100 (US) - port 52341
  10:44:12 - 10.0.0.50 (CN) - port 38080
  10:43:05 - 172.16.0.25 (FR) - port 56954
```

### Dashboard Temps Réel (`dashboard.sh`)

Le dashboard affiche les stats en continu et montre immédiatement chaque nouvelle connexion avec le message "✨ NOUVELLE CONNEXION".

## 📸 Captures d'Écran

Les captures sont sauvegardées dans `data/screenshots/` :
- **Fichiers PNG** : captures d'écran des interfaces web (format : `{IP}_{PORT}_{TIMESTAMP}.png`)
- **Fichiers .txt** : métadonnées (IP, port, URL, timestamp)
- **Fichiers _nikto.txt** : rapports de vulnérabilités (si nikto est installé)

## 💾 Cache Intelligent

Le système utilise un cache pour optimiser les lookups GeoIP :
- Première connexion d'une IP → lookup GeoIP + sauvegarde dans le cache
- Connexions suivantes de la même IP → lecture instantanée depuis le cache
- Fichier : `data/cache/geoip-cache.json`

## 📝 Licence

MIT - Libre d'utilisation

## 🤝 Contribution

Pull requests bienvenues !

## 📬 Contact

GitHub: [@bannik62](https://github.com/bannik62)
