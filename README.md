# 🍯 Honeypot Monitor

Système de monitoring temps réel pour **Endlessh** (honeypot SSH) avec géolocalisation, scan de vulnérabilités, analyse DNS/WHOIS, captures d'écran, et **dashboard web interactif** avec carte monde D3.js.

> ⚠️ **Prérequis obligatoire** : Ce système nécessite **Endlessh** comme honeypot SSH. Assurez-vous qu'Endlessh est installé et configuré avant d'utiliser ce système.

---

## 🎯 Fonctionnalités

### Collecte & monitoring
- ⚡ **Monitoring temps réel** des connexions (parsing historique + suivi live via `journalctl -f`)
- 🌍 **Géolocalisation** des attaquants (base GeoIP locale, cache 10 MB)
- 📊 **Dashboard ASCII** avec statistiques live (terminal)
- 📈 **Logs structurés** en CSV pour analyse

### Scan & enrichissement
- 🔍 **Scan des interfaces web** avec nmap (ports 80, 443, 8080…)
- 📸 **Captures d'écran automatiques** des interfaces web (Google Chrome headless)
- 🛡️ **Scan de vulnérabilités** avec nmap (`--script vuln`) + nikto (optionnel)
- 🌐 **Analyse DNS/WHOIS** des IPs collectées
- 🗺️ **Traceroute** par IP (`nmap --traceroute`, script manuel)
- 🔎 **Recherche** dans les rapports de vulnérabilités (SQLite)

### Dashboard web interactif *(nouveau)*
- 🗺️ **Carte monde D3.js** avec points animés par pays et IPs individuelles au zoom
- 📡 **Ondulations radar** sur les pays les plus actifs
- 🔗 **Graphe réseau D3** (onglet Réseau) — traceroute des hops
- 📋 **Tableau IPs** avec modales de détail (rapports nmap, DNS, screenshots)
- 📊 **Onglet Statistiques** — top pays, top ports, timeline
- 🖥️ **Serveur local** Python (`127.0.0.1:8765`), accès exclusivement via tunnel SSH
- 🔌 **Filtre carte** par catégorie : tous, avec ports, avec vulns HIGH, avec rapports

### Automatisation & maintenance
- ⏰ **Scans automatiques** via cron (configurable)
- 🧹 **Nettoyage automatique** du cache et des anciennes données
- 💾 **Cache intelligent** GeoIP (limité à 10 MB)
- 🚀 **Léger** : <1% CPU, ~10 MB RAM

---

## 📋 Prérequis

### 1. Endlessh installé et configuré

- ✅ `sudo apt install endlessh`
- ✅ Écoute sur le port 22
- ✅ Service systemd actif : `sudo systemctl status endlessh`
- ✅ Génère des logs `ACCEPT host=IP port=PORT`

**Configuration recommandée** (`/etc/endlessh/config`) :
```
Port 22
Delay 10000
MaxLineLength 32
MaxClients 4096
LogLevel 1
```

Le service systemd doit avoir `AmbientCapabilities=CAP_NET_BIND_SERVICE` et `PrivateUsers=true` commenté.

### 2. Système et dépendances

- Ubuntu/Debian récents (22.04/24.04, Debian 11/12 recommandés), `sudo` pour accéder aux logs systemd
- `geoip-bin`, `geoip-database` — géolocalisation (installés automatiquement)
- `jq` — manipulation JSON (installé automatiquement)
- `google-chrome-stable` — captures d'écran headless (installé automatiquement via repo APT)
- `nmap` — scan ports + vulnérabilités (installé automatiquement)
- `sqlite3` — base de données vulnérabilités (installé automatiquement)
- `python3` — serveur visualiseur (présent sur Ubuntu)
- `nikto` — scan vulnérabilités web (optionnel, installation manuelle)

---

## 🚀 Installation

```bash
git clone https://github.com/bannik62/honeypot.git
cd honeypot
sudo ./install.sh
```

L'installation :
- ✅ Installe toutes les dépendances (dont Google Chrome via repo APT officiel)
- ✅ Crée la structure de répertoires
- ✅ Copie `config/config.example` → `config/config`
- ✅ Rend tous les scripts exécutables
- ✅ Ajoute les alias dans `.bashrc`
- ✅ Propose de configurer les scans automatiques (cron)
- ✅ Propose de démarrer le monitoring immédiatement

**Après l'installation, rechargez votre `.bashrc` :**
```bash
source ~/.bashrc
```

---

## 📊 Utilisation

### Monitoring en arrière-plan

```bash
honeypot-monitor start     # Démarre (parse l'historique + écoute en temps réel)
honeypot-monitor stop      # Arrête
honeypot-monitor status    # Vérifie le statut
honeypot-monitor restart   # Redémarre
```

Au démarrage, le monitoring parse tout l'historique Endlessh (avec barre de progression), puis suit les nouvelles connexions via `journalctl -f`.

### Dashboard ASCII (terminal)

```bash
honeypot-stats             # Stats rapides (top pays, dernières connexions)
honeypot-dashboard         # Dashboard temps réel (rafraîchissement automatique)
count-ips                  # Compte les IPs : journal vs connections.csv
piegeAbot                  # Suit les connexions en temps réel (journalctl)
honeypot-logs              # Logs des scans automatiques (tail -f)
```

### Dashboard web interactif *(nouveau)*

```bash
# 1. Générer les données (après les scans)
honeypot-make-visualizer-data

# 2. Démarrer le serveur local
honeypot-start-server start

# 3. Depuis votre PC : tunnel SSH (garder la fenêtre ouverte)
ssh -L 8765:127.0.0.1:8765 ubuntu@IP_DU_VPS

# 4. Ouvrir dans le navigateur
http://localhost:8765

# 5. Éteindre le serveur
honeypot-start-server stop
honeypot-start-server status
```

Le serveur écoute sur `127.0.0.1` uniquement — jamais exposé sur internet.

Le dashboard contient 4 onglets :
- **Carte** — carte monde D3.js avec points animés, zoom, tooltips, ondulations radar sur les tops attaquants
- **Réseau** — graphe de force D3 des traceroutes (hops entre routeurs)
- **Statistiques** — top pays, top ports, timeline des connexions
- **IPs** — tableau complet avec filtres et modales de détail (nmap, DNS, screenshots)

Depuis l’interface, le bouton **↻ Régénérer data.json** relance `generate-data.sh` sur le VPS via `POST /api/dashboard/regenerate` (barre de progression + message d’erreur si échec). Voir `visualizer/README.md` pour l’API et le module d’overlay.

En vue **pays**, le tooltip agrège automatiquement le nombre total de vulnérabilités HIGH, la liste des ports observés et les rapports disponibles (nmap, DNS, traceroute, screenshots, nikto) pour le pays survolé. En vue **IP individuelle**, le tooltip affiche les données précises de cette IP (pays, vulnérabilités, ports, rapports).

### Scans & enrichissement

```bash
scan-web                   # Scan nmap → détecte les interfaces web (web_interfaces.csv)
capture-web                # Screenshots des interfaces web + scan nikto
vuln-scan                  # Scan vulnérabilités nmap (--script vuln)
honeypot-dig               # DNS/WHOIS sur toutes les IPs
honeypot-search-vuln       # Recherche interactive dans la base SQLite (vuln / Nikto)
honeypot-make-visualizer-data  # Agrège tout → data.json pour le dashboard
```

### Traceroute (manuel, ponctuel)

Le traceroute **n'est pas** exécuté par `run-all-scans.sh` / le cron — c’est un **choix volontaire** :

- **`nmap --traceroute`** utilise des raw sockets : sur la plupart des systèmes il faut **root** ; le cron tourne en **utilisateur normal** (pas de mot de passe, pas de `sudo` interactif).
- Éviter d’**encombrer le VPS** avec des centaines de traceroutes à chaque passage du cron (charge réseau / durée du cycle).
- Pas besoin de configurer **`sudo NOPASSWD`** ou un **cron root** pour un usage perso — on garde le pipeline auto simple.

**Conséquence :** les **nouvelles IPs** auront bien le scan vuln (`vuln-scan`) via le cron, mais **pas** de `<IP>_traceroute.txt` tant que vous n’avez pas relancé le script ci‑dessous (backfill ponctuel).

```bash
sudo bash scripts/traceroute-ip.sh
```

Ce script remplit les `_traceroute.txt` **manquants** dans `data/screenshotAndLog/<IP>/`. La commande nmap inclut **`-Pn`** : sans cela, beaucoup d’IPs sont vues comme « host down » (ping ICMP filtré) et **aucun** traceroute n’est enregistré. Relancez ensuite `honeypot-make-visualizer-data` (ou `generate-data.sh`) pour mettre à jour le graphe réseau.

> Voir aussi `vuln-scan.sh` (commentaire dans le script) : `--traceroute` n’y est pas ajouté, pour les mêmes raisons (root + cron user).

### Scans automatiques

```bash
setup-auto-scan            # Configure le cron (lit AUTO_SCAN_ENABLED et AUTO_SCAN_HOUR)
```

La séquence automatique (`run-all-scans.sh`) exécute dans l'ordre :
1. `scan-web` (nmap → web_interfaces.csv)
2. `capture-web` (screenshots + nikto)
3. `dig-ip` (DNS/WHOIS)
4. `vuln-scan` (nmap --script vuln) — **sans** `--traceroute` (voir section Traceroute ci‑dessus)
5. `cleanup-old-data` (nettoyage)
6. `generate-data` (→ data.json pour le dashboard)

---

## 📂 Structure du projet

```
honeypot/
├── data/
│   ├── logs/
│   │   ├── connections.csv          # Toutes les connexions Endlessh
│   │   ├── web_interfaces.csv       # Interfaces web trouvées (nmap)
│   │   ├── nikto.db                 # Base SQLite des vulnérabilités
│   │   ├── run-all-scans.log        # Logs des scans automatiques
│   │   └── *.bak.gz                 # Backups compressés (rotation auto)
│   ├── screenshotAndLog/
│   │   └── <IP>/
│   │       ├── <IP>_nmap.txt        # Rapport vulnérabilités (vuln-scan.sh)
│   │       ├── <IP>_traceroute.txt  # Hops traceroute (traceroute-ip.sh)
│   │       ├── <IP>_dns.txt         # Reverse DNS + WHOIS (dig-ip.sh)
│   │       ├── <IP>_<port>_<date>_<time>.png  # Screenshot (web-capture.sh)
│   │       └── <IP>_nikto.txt       # Rapport nikto (optionnel)
│   ├── cache/
│   │   ├── geoip-cache.json         # Cache géolocalisation (max 10 MB)
│   │   ├── honeypot-monitor.pid
│   │   └── honeypot-monitor.lock
│   └── visualizer-dashboard/
│       └── data.json                # Données agrégées pour le dashboard web
├── scripts/
│   ├── monitor.sh                   # Daemon monitoring (historique + temps réel)
│   ├── parser.sh                    # Parser logs Endlessh → connections.csv
│   ├── stats.sh                     # Statistiques rapides (terminal)
│   ├── dashboard.sh                 # Dashboard ASCII temps réel
│   ├── nmap-to-csv.sh               # Scan nmap → web_interfaces.csv
│   ├── web-capture.sh               # Screenshots + scan nikto
│   ├── vuln-scan.sh                 # Scan vulnérabilités nmap
│   ├── dig-ip.sh                    # DNS/WHOIS par IP
│   ├── parse-nikto.sh               # Parse rapports nmap → SQLite
│   ├── search-vuln.sh               # Recherche interactive SQLite (vuln / Nikto)
│   ├── generate-data.sh             # Agrège tout → data.json (visualiseur)
│   ├── traceroute-ip.sh             # Traceroute manuel (sudo, ponctuel)
│   ├── run-all-scans.sh             # Orchestre tous les scans (cron)
│   ├── setup-auto-scan.sh           # Configure le cron
│   ├── cleanup-old-data.sh          # Nettoyage automatique
│   └── python-visualiser/
│       ├── server.py                # Serveur HTTP Python (127.0.0.1:8765)
│       └── server.sh                # start|stop|status du serveur
├── visualizer/
│   ├── honeypot-dashboard.html      # Dashboard web (D3.js)
│   └── js/
│       ├── main.js                  # Orchestration
│       ├── map-tab.js               # Carte monde D3 + zoom + animations
│       ├── network-tab.js           # Graphe réseau D3 (traceroutes)
│       ├── stats-tab.js             # Statistiques
│       ├── ips-tab.js               # Tableau IPs + modales
│       ├── tooltip.js               # Tooltips enrichis (pays + IPs)
│       ├── state.js                 # État global
│       ├── constants.js             # CC, ISO2_TO_N3, VPS...
│       └── data-loader.js           # Fetch data.json / CSV
├── lib/
│   └── common.sh                    # Fonctions communes (logging, config, rotation, SQL)
├── config/
│   ├── config.example               # Exemple de configuration
│   └── config                       # Configuration personnalisée
├── docs/
│   ├── ARCHITECTURE.md              # Architecture détaillée + flux de données
│   └── FLOWCHART.md                 # Schéma Mermaid du pipeline
├── install.sh
├── uninstall.sh
└── README.md
```

---

## 🔄 Workflow complet

### 1. Endlessh capture les bots

Les bots se connectent sur le port 22. Endlessh les piège et génère des logs `ACCEPT host=IP port=PORT`.

### 2. Monitoring et logs

`monitor.sh` (daemon) parse tout l'historique Endlessh au démarrage, puis suit les nouvelles connexions en temps réel. Chaque IP est géolocalisée (cache GeoIP) et écrite dans `connections.csv`.

### 3. Pipeline de scans (cron ou manuel)

`run-all-scans.sh` orchestre dans l'ordre :

- **scan-web** → détecte les ports HTTP ouverts (80, 443, 8080, 8443, 8000, 8888, 3000, 5000, 9000), évite les doublons
- **capture-web** → screenshot PNG via Chrome headless, scan nikto si installé
- **dig-ip** → reverse DNS + WHOIS par IP (liste = `web_interfaces.csv` **+** toutes les IPv4 trouvées dans `*_traceroute.txt`, pour remplir `name` / `hop_names` dans `data.json`)
- **vuln-scan** → `nmap -F -sV --script vuln`, stocke les rapports dans `screenshotAndLog/<IP>/` (pas de traceroute ici ; traceroute = script manuel `traceroute-ip.sh`)
- **cleanup-old-data** → nettoyage automatique
- **generate-data** → agrège tout dans `data.json`

### 4. Dashboard web

`generate-data.sh` scanne `data/screenshotAndLog/`, extrait pour chaque IP : pays, coordonnées, présence nmap/dns/screenshot/nikto/traceroute, hops, **`vuln_high`** (heuristique `grep` sur le nmap — rapide ; pour des stats alignées sur la base SQLite, lancez `parse-nikto.sh` puis `honeypot-search-vuln`), ports ouverts. Produit `data/visualizer-dashboard/data.json`.

`server.py` sert le dashboard HTML + `data.json` + rapports par IP sur `127.0.0.1:8765`. Accès via tunnel SSH uniquement.

---

## 🌍 Géolocalisation

Base GeoIP locale (gratuite, sans limite de requêtes, lookup < 1ms). Cache JSON limité à 10 MB (~100k entrées) avec nettoyage automatique au dépassement.

---

## 📈 Format des données

### `data/logs/connections.csv`
```csv
timestamp,ip,port,country
2025-03-01 02:11:00,218.92.0.115,52341,CN
```

### `data/logs/web_interfaces.csv`
```csv
timestamp,ip,port,protocol,url,scanned
2025-03-01 12:00:00,218.92.0.115,80,http,http://218.92.0.115:80,1
```

### `data/visualizer-dashboard/data.json`
```json
[
  {
    "ip": "218.92.0.115",
    "name": "scanner.example.net",
    "country": "CN",
    "lat": 39.9042,
    "lon": 116.4074,
    "nmap": true,
    "dns": true,
    "screenshot": false,
    "nikto": false,
    "traceroute": true,
    "hops": ["10.0.0.1", "192.168.1.1", "218.92.0.115"],
    "hop_names": { "10.0.0.1": "gw.isp.net" },
    "hop_countries": { "10.0.0.1": "US" },
    "vuln_high": 2,
    "ports": "80,443"
  }
]
```

### `data/logs/nikto.db` (SQLite)
- Table `vulns` : ip, port, vulnerability, severity (HIGH/MEDIUM/LOW), cve, server_version, full_text
- Table `parsed_files` : suivi des fichiers déjà parsés (évite les doublons)

---

## 🔧 Configuration

Fichier `config/config` (copié depuis `config/config.example`) :

```bash
# Répertoire des données
DATA_DIR="/home/ubuntu/honeypot/data"

# Nom du service systemd
SERVICE_NAME="endlessh"

# Dashboard ASCII : intervalle de rafraîchissement (secondes)
REFRESH_INTERVAL=5

# Ports à scanner pour les interfaces web
SCAN_PORTS="80,443,8080,8443,8000,8888,3000,5000,9000"

# Parallélisme
NMAP_PARALLEL=10          # Scans nmap simultanés (scan-web)
CAPTURE_PARALLEL=5        # Captures simultanées (capture-web)
DIG_PARALLEL=10           # Requêtes DNS simultanées (honeypot-dig)
NIKTO_PARALLEL=10         # Scans nikto simultanés
NIKTO_TIMEOUT=600         # Timeout nikto par scan (secondes)
NIKTO_TUNING="1,2,3,5,6,7,8"  # Tests nikto activés

# Timeouts nmap (vuln-scan)
NMAP_MAX_RTT_TIMEOUT="500ms"
NMAP_HOST_TIMEOUT="600s"

# Scans automatiques
AUTO_SCAN_ENABLED=true
AUTO_SCAN_HOUR=1          # Intervalle entre chaque exécution (1-23 heures)
```

---

## 🧹 Nettoyage automatique

Exécuté après chaque cycle de scans (`run-all-scans.sh`) ou manuellement (`./scripts/cleanup-old-data.sh`) :

- **Cache GeoIP** : limité à 10 MB, nettoyage automatique si dépassé
- **Screenshots** : suppression des captures > 30 jours
- **Rapports nmap** : suppression des rapports > 60 jours
- **Backups compressés** : suppression des backups > 90 jours
- **Fichiers CSV** : rotation automatique si > 50 MB

---

## 💾 Gestion mémoire

- Cache GeoIP : limité à 10 MB, nettoyage automatique
- CSV : rotation automatique si > 50 MB
- Fichiers temporaires : nettoyage automatique via `trap`
- Historique journalctl initial : limité à 10 000 lignes
- Données anciennes : suppression périodique (30–90 jours)

---

## 📸 Alias disponibles

| Alias | Description |
|---|---|
| `honeypot-monitor` | start / stop / status / restart du monitoring |
| `honeypot-stats` | Statistiques rapides (terminal) |
| `honeypot-dashboard` | Dashboard ASCII temps réel |
| `honeypot-logs` | Logs des scans automatiques (tail -f) |
| `count-ips` | Compte les IPs : journal vs connections.csv |
| `piegeAbot` | Connexions en temps réel (journalctl -f) |
| `scan-web` | Scan nmap → interfaces web |
| `capture-web` | Screenshots + nikto |
| `vuln-scan` | Scan vulnérabilités nmap |
| `honeypot-dig` | DNS/WHOIS sur les IPs |
| `honeypot-search-vuln` | Recherche dans la base vulnérabilités (SQLite / Nikto) |
| `setup-auto-scan` | Configure les scans automatiques (cron) |
| `honeypot-make-visualizer-data` | Génère data.json pour le dashboard web |
| `honeypot-start-server` | start / stop / status du serveur visualiseur |

---

## 🗑️ Désinstallation

```bash
cd ~/honeypot
sudo ./uninstall.sh
```

Le script propose de : arrêter le monitoring, supprimer le cron, nettoyer les processus, supprimer les alias du `.bashrc`, et optionnellement supprimer les données et la configuration.

---

## 📝 Licence

MIT — libre d'utilisation

## 🤝 Contribution

Pull requests bienvenues !

## 📬 Contact

GitHub: [@bannik62](https://github.com/bannik62)