# 🍯 Honeypot Monitor

Système de monitoring temps réel pour **Endlessh** (honeypot SSH) avec capture d'écran des interfaces web des attaquants, scan de vulnérabilités et analyse DNS/WHOIS.

> ⚠️ **Prérequis obligatoire** : Ce système nécessite **Endlessh** comme honeypot SSH. Assurez-vous qu'Endlessh est installé et configuré avant d'utiliser ce système.

## 🎯 Fonctionnalités

- ⚡ **Monitoring temps réel** des connexions au honeypot (parsing historique + suivi live)
- 🌍 **Géolocalisation** des attaquants (base GeoIP locale)
- 📊 **Dashboard ASCII** avec statistiques live
- 📈 **Logs structurés** en CSV pour analyse
- 🔍 **Scan des interfaces web** avec nmap
- 📸 **Capture d'écran automatique** des interfaces web
- 🛡️ **Scan de vulnérabilités** avec nmap et nikto
- 🔎 **Recherche dans les rapports** de vulnérabilités (SQLite)
- 🌐 **Analyse DNS/WHOIS** des IPs collectées
- ⏰ **Scans automatiques** via cron (configurable)
- 🧹 **Nettoyage automatique** du cache et des anciennes données
- 💾 **Cache intelligent** pour limiter les lookups (limité à 10MB)
- 🚀 **Léger** : <1% CPU, ~10MB RAM

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
- `sqlite3` pour la base de données des vulnérabilités (installé automatiquement)
- `nikto` pour scanner les vulnérabilités (optionnel, installé manuellement)

## 🚀 Installation

```bash
git clone https://github.com/bannik62/honeypot.git
cd honeypot
sudo ./install.sh
cp config/config.example config/config
nano config/config
```

L'installation :
- ✅ Installe toutes les dépendances
- ✅ Crée la structure de répertoires
- ✅ Rend tous les scripts exécutables
- ✅ Ajoute les alias dans `.bashrc`
- ✅ Propose de configurer les scans automatiques (cron)

**Important** : Après l'installation, rechargez votre `.bashrc` :
```bash
source ~/.bashrc
```

## 📊 Utilisation

### Monitoring en Arrière-plan (Recommandé)

Le monitoring en arrière-plan parse l'historique complet au démarrage puis suit les nouvelles connexions en temps réel :

```bash
# Démarrer le monitoring
honeypot-monitor start

# Arrêter le monitoring
honeypot-monitor stop

# Vérifier le statut
honeypot-monitor status

# Redémarrer
honeypot-monitor restart
```

**Fonctionnement** :
- Au démarrage, parse tout l'historique des logs Endlessh
- Affiche une barre de progression pendant le parsing
- Après le parsing, suit les nouvelles connexions en temps réel
- Écrit toutes les connexions dans `connections.csv`

### Commandes de Monitoring

```bash
# Stats rapides
honeypot-stats

# Dashboard temps réel (écoute live)
honeypot-dashboard

# Compter les IPs (journal vs connections.csv)
count-ips

# Suivre les connexions en temps réel (journalctl)
piegeAbot

# Suivre les logs des scans
honeypot-logs
```

### Scan et Capture des Interfaces Web

```bash
# Scanne les IPs avec nmap et crée un CSV avec les interfaces web
scan-web

# Capture les interfaces web + scan nikto (lance scan-web si nécessaire)
capture-web

# Scan de vulnérabilités avec nmap
vuln-scan

# Analyse DNS/WHOIS des IPs
honeypot-dig

# Recherche dans les rapports de vulnérabilités
honeypot-search-nikto
```

### Scans Automatiques

Configurer les scans automatiques (exécution périodique via cron) :

```bash
# Configurer les scans automatiques
setup-auto-scan
```

Le script :
- Lit la configuration (`AUTO_SCAN_ENABLED` et `AUTO_SCAN_HOUR`)
- Configure le cron pour exécuter `run-all-scans.sh` périodiquement
- Les scans incluent : scan-web, capture-web, dig-ip, vuln-scan
- Le nettoyage automatique est exécuté après chaque série de scans

**Configuration dans `config/config`** :
```bash
AUTO_SCAN_ENABLED=true   # Activer/désactiver les scans automatiques
AUTO_SCAN_HOUR=1         # Intervalle entre chaque exécution (1-23 heures)
```

### Alias Disponibles

```bash
# Monitoring
honeypot-stats           # Affiche les statistiques
honeypot-dashboard       # Lance le dashboard temps réel
honeypot-monitor         # Gère le monitoring (start/stop/status/restart)
honeypot-logs            # Suit les logs des scans (tail -f)
count-ips                # Compter les IPs (journal vs connections.csv)
piegeAbot                # Suivre les connexions en temps réel (journalctl)

# Scans
scan-web                 # Scan nmap des interfaces web
capture-web              # Capture d'écran + scan nikto
vuln-scan                # Scan de vulnérabilités avec nmap
honeypot-dig             # Requêtes DNS/WHOIS sur les IPs
honeypot-search-nikto    # Recherche dans les rapports Nikto

# Configuration
setup-auto-scan          # Configurer les scans automatiques (cron)
```

## 📂 Structure du Projet

```
honeypot/
├── data/
│   ├── logs/
│   │   ├── connections.csv      # Toutes les connexions Endlessh
│   │   ├── web_interfaces.csv  # Interfaces web trouvées (créé par nmap)
│   │   ├── run-all-scans.log   # Logs des scans automatiques
│   │   ├── parser.log          # Logs du parser
│   │   └── *.bak.gz            # Backups compressés (rotation automatique)
│   ├── screenshots/             # Captures d'écran des interfaces web
│   │   ├── 192.168.1.100_80_20251222_120430.png
│   │   ├── 192.168.1.100_80_20251222_120430.txt
│   │   └── 192.168.1.100_80_20251222_120430_nikto.txt
│   ├── cache/
│   │   ├── geoip-cache.json    # Cache géolocalisation (limité à 10MB)
│   │   ├── honeypot-monitor.pid # PID du monitoring
│   │   └── honeypot-monitor.lock # Lock file du monitoring
│   └── nikto.db                # Base SQLite des vulnérabilités
├── scripts/
│   ├── monitor.sh              # Monitoring background (parse historique + temps réel)
│   ├── parser.sh               # Parser de logs Endlessh
│   ├── stats.sh                # Statistiques rapides
│   ├── dashboard.sh            # Dashboard temps réel
│   ├── nmap-to-csv.sh          # Scan nmap → CSV interfaces web
│   ├── nikto-capture.sh        # Capture d'écran + scan nikto
│   ├── vuln-scan.sh            # Scan de vulnérabilités avec nmap
│   ├── dig-ip.sh               # Analyse DNS/WHOIS
│   ├── parse-nikto.sh          # Parse les rapports nmap → SQLite
│   ├── search-nikto.sh         # Recherche dans la base SQLite
│   ├── run-all-scans.sh        # Orchestre tous les scans
│   ├── setup-auto-scan.sh      # Configure les scans automatiques
│   └── cleanup-old-data.sh     # Nettoyage automatique
├── lib/
│   └── common.sh               # Bibliothèque commune : fonctions partagées (logging, config, validation, SQL escaping, nettoyage fichiers temporaires)
├── config/
│   ├── config.example          # Exemple de configuration
│   └── config                  # Configuration personnalisée
├── install.sh                  # Script d'installation
├── uninstall.sh                # Script de désinstallation
└── README.md
```

## 🔄 Workflow Complet

### 1. Endlessh capture les bots

Les bots se connectent au port 22. Endlessh les piège et génère des logs `ACCEPT host=IP port=PORT`.

### 2. Monitoring et logs

**Monitoring en arrière-plan** (`monitor.sh`) :
- Parse tout l'historique des logs Endlessh au démarrage
- Affiche une barre de progression pendant le parsing
- Suit les nouvelles connexions en temps réel avec `journalctl -f`
- Écrit toutes les connexions dans `connections.csv`
- Chaque IP est géolocalisée (avec cache pour optimisation)

**Dashboard temps réel** (`dashboard.sh`) :
- Écoute `journalctl -f` en temps réel
- Affiche les statistiques et les nouvelles connexions
- Rafraîchit automatiquement selon `REFRESH_INTERVAL`

### 3. Scan des interfaces web (optionnel)

- `scan-web` : nmap scanne les IPs capturées
- Détecte les ports HTTP ouverts (80, 443, 8080, 8443, 8000, 8888, 3000, 5000, 9000)
- Crée `web_interfaces.csv` avec les IPs qui ont des interfaces web
- Évite les doublons (vérifie si l'IP:port a déjà été scanné)

### 4. Capture d'écran et analyse (optionnel)

- `capture-web` : lit `web_interfaces.csv`
- Prend des captures PNG avec `chromium-browser --headless`
- Scanne les vulnérabilités avec nikto (si installé)
- Sauvegarde dans `data/screenshots/`

### 5. Scan de vulnérabilités (optionnel)

- `vuln-scan` : scanne les IPs avec `nmap --script vuln`
- Parse les rapports avec `parse-nikto.sh` → stocke dans SQLite (`nikto.db`)
- Recherche dans la base avec `honeypot-search-nikto`

### 6. Analyse DNS/WHOIS (optionnel)

- `honeypot-dig` : effectue des requêtes DNS et WHOIS sur les IPs
- Enrichit les données collectées

### 7. Scans automatiques (optionnel)

- Configuré via `setup-auto-scan`
- Exécute `run-all-scans.sh` périodiquement (cron)
- Inclut : scan-web, capture-web, dig-ip, vuln-scan
- Nettoie automatiquement après chaque série de scans

## 🌍 Géolocalisation

Utilise la base de données GeoIP locale (gratuite) :
- Pas de limite de requêtes
- Lookup < 1ms
- Cache intelligent : les IPs déjà géolocalisées sont mises en cache dans `data/cache/geoip-cache.json`
- **Limitation automatique** : le cache est limité à 10MB (~100k entrées)
- **Nettoyage automatique** : si le cache dépasse 10MB, garde seulement les 50000 dernières entrées

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

### nikto.db (SQLite)

Base de données SQLite contenant les résultats des scans de vulnérabilités :
- Table `vulnerabilities` : IP, port, service, vuln_id, severity, description, etc.
- Recherche via `honeypot-search-nikto`

## 🔧 Configuration

Fichier `config/config` :

```bash
# Répertoire des données (logs, cache)
DATA_DIR="/home/ubuntu/honeypot/data"

# Nom du service systemd à monitorer
SERVICE_NAME="endlessh"

# Intervalle de rafraîchissement du dashboard (secondes)
REFRESH_INTERVAL=5

# Activer les notifications (true/false)
ENABLE_NOTIFICATIONS=false

# Ports à scanner pour les interfaces web
SCAN_PORTS="80,443,8080,8443,8000,8888,3000,5000,9000"

# Nombre de processus parallèles pour nmap
NMAP_PARALLEL=15

# Nombre de processus parallèles pour les captures
CAPTURE_PARALLEL=5

# Nombre de processus parallèles pour dig
DIG_PARALLEL=10

# Timeout nmap
NMAP_MAX_RTT_TIMEOUT=500ms
NMAP_HOST_TIMEOUT=600s

# Scans automatiques
AUTO_SCAN_ENABLED=false
AUTO_SCAN_HOUR=1
```

### Explication des Paramètres

**DATA_DIR** : Chemin vers le répertoire qui contient les logs, cache et captures d'écran.
- **Par défaut** : `/home/ubuntu/honeypot/data`
- **Modifier si** : Vous voulez stocker les données ailleurs (ex: `/var/log/honeypot`)

**SERVICE_NAME** : Nom du service systemd à monitorer.
- **Par défaut** : `endlessh`
- **Modifier si** : Vous utilisez un autre nom de service pour Endlessh

**REFRESH_INTERVAL** : Délai (en secondes) entre chaque rafraîchissement du dashboard.
- **Par défaut** : `5` secondes
- **Modifier si** : Vous voulez un rafraîchissement plus rapide (1-2s) ou plus lent (10s+)

**SCAN_PORTS** : Ports à scanner pour détecter les interfaces web.
- **Par défaut** : `80,443,8080,8443,8000,8888,3000,5000,9000`
- **Modifier si** : Vous voulez scanner d'autres ports

**NMAP_PARALLEL** : Nombre de scans nmap en parallèle.
- **Par défaut** : `15`
- **Modifier si** : Vous voulez plus ou moins de parallélisme

**AUTO_SCAN_ENABLED** : Active les scans automatiques via cron.
- **Par défaut** : `false`
- **Modifier si** : Vous voulez activer les scans automatiques

**AUTO_SCAN_HOUR** : Intervalle entre chaque exécution automatique (heures, 1-23).
- **Par défaut** : `1` heure
- **Modifier si** : Vous voulez un intervalle différent

## 🧹 Nettoyage Automatique

Le système nettoie automatiquement :

1. **Cache GeoIP** : limité à 10MB, nettoyage automatique si dépassé
2. **Captures d'écran** : suppression des captures > 30 jours
3. **Rapports nmap** : suppression des rapports > 60 jours
4. **Backups compressés** : suppression des backups > 90 jours
5. **Fichiers CSV** : rotation automatique si > 50MB

Le nettoyage est exécuté :
- Automatiquement après chaque série de scans (`run-all-scans.sh`)
- Manuellement : `./scripts/cleanup-old-data.sh`

## 📊 Exemple de Sortie

### Stats Rapides (`honeypot-stats`)

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

### Dashboard Temps Réel (`honeypot-dashboard`)

Le dashboard affiche les stats en continu et montre immédiatement chaque nouvelle connexion avec le message "✨ NOUVELLE CONNEXION".

### Monitoring (`honeypot-monitor start`)

```
🚀 Démarrage du monitoring...
📜 Parsing de l'historique complet d'abord...
📊 15411 lignes à parser...
⏳ Parsing... 15411/15411 lignes (100%)
✅ 15411 lignes parsées
✅ Historique parsé, écoute des nouvelles connexions...
✅ Monitoring démarré (PID: 1234567)
```

## 📸 Captures d'Écran

Les captures sont sauvegardées dans `data/screenshots/` :
- **Fichiers PNG** : captures d'écran des interfaces web (format : `{IP}_{PORT}_{TIMESTAMP}.png`)
- **Fichiers .txt** : métadonnées (IP, port, URL, timestamp)
- **Fichiers _nikto.txt** : rapports de vulnérabilités (si nikto est installé)

## 💾 Gestion de la Mémoire

Le système est optimisé pour éviter les fuites mémoire :

- **Cache GeoIP** : limité à 10MB, nettoyage automatique
- **Fichiers CSV** : rotation automatique si > 50MB
- **Fichiers temporaires** : nettoyage automatique avec `trap`
- **Journalctl** : limite l'historique initial à 10000 lignes
- **Nettoyage périodique** : suppression des anciennes données (> 30-90 jours)

## 🗑️ Désinstallation

```bash
cd ~/honeypot
sudo ./uninstall.sh
```

Le script de désinstallation :
- Arrête le monitoring
- Supprime les alias du `.bashrc`
- Supprime le cron (si configuré)
- Nettoie les processus
- Optionnellement supprime les données et la configuration

## 📝 Licence

MIT - Libre d'utilisation

## 🤝 Contribution

Pull requests bienvenues !

## 📬 Contact

GitHub: [@bannik62](https://github.com/bannik62)
