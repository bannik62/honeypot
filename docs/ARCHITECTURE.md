# 🏗️ Architecture — Honeypot Monitor

## Vue d'ensemble

```
Internet
    │
    ▼
┌─────────────┐
│  Endlessh   │  ← Honeypot SSH (port 22)
│  (systemd)  │    Piège les bots en boucle infinie
└──────┬──────┘
       │ logs journalctl
       ▼
┌─────────────────────────────────────────────────────┐
│                   PIPELINE DE DONNÉES                │
│                                                     │
│  monitor.sh ──► parser.sh ──► connections.csv       │
│  (daemon)       (parse +       (timestamp,ip,       │
│                  geolocate)     port,country)        │
│                     │                               │
│              geoip-cache.json                       │
│              (cache 10MB max)                       │
└─────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────┐
│               PIPELINE DE SCANS (cron)               │
│                                                     │
│  1. nmap-to-csv.sh    → web_interfaces.csv          │
│     (scan ports web)                                │
│                                                     │
│  2. web-capture.sh    → screenshotAndLog/<IP>/*.png │
│     (chromium headless)                             │
│                                                     │
│  3. dig-ip.sh         → screenshotAndLog/<IP>/*_dns.txt │
│     (DNS + WHOIS)                                   │
│                                                     │
│  4. vuln-scan.sh      → screenshotAndLog/<IP>/*_nmap.txt │
│     (nmap --script vuln)                            │
│                                                     │
│  5. cleanup-old-data.sh  (rotation + nettoyage)     │
│                                                     │
│  6. generate-data.sh  → data/visualizer-dashboard/  │
│     (agrège tout)       data.json                   │
└─────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────┐
│                  VISUALISEUR WEB                     │
│                                                     │
│  server.py (127.0.0.1:8765)                         │
│  ├── GET /                     → honeypot-dashboard.html │
│  ├── GET /data/.../data.json   → données agrégées   │
│  └── GET /data/screenshotAndLog/<ip>/<rapport>      │
│                                                     │
│  honeypot-dashboard.html                            │
│  ├── js/main.js          (orchestration)            │
│  ├── js/map-tab.js       (carte monde D3)           │
│  ├── js/network-tab.js   (graphe force D3)          │
│  ├── js/stats-tab.js     (statistiques)             │
│  ├── js/ips-tab.js       (tableau IPs + modales)    │
│  ├── js/tooltip.js       (tooltips)                 │
│  ├── js/state.js         (état global)              │
│  ├── js/constants.js     (CC, ISO2_TO_N3, VPS...)   │
│  └── js/data-loader.js   (fetch data.json / CSV)    │
└─────────────────────────────────────────────────────┘
```

---

## Accès au visualiseur

Le serveur écoute sur `127.0.0.1` uniquement — jamais exposé sur internet.

```bash
# Sur le VPS
honeypot-start-server start

# Tunnel SSH depuis votre PC
ssh -L 8765:127.0.0.1:8765 ubuntu@IP_DU_VPS

# Navigateur
http://localhost:8765
```

---

## Structure des données

### `data/logs/connections.csv`
Toutes les connexions capturées par Endlessh.
```
timestamp,ip,port,country
2025-03-01 02:11:00,218.92.0.115,52341,CN
```

### `data/logs/web_interfaces.csv`
IPs ayant un port web ouvert (produit par `nmap-to-csv.sh`).
```
timestamp,ip,port,protocol,url,scanned
2025-03-01 12:00:00,218.92.0.115,80,http,http://218.92.0.115:80,1
```

### `data/screenshotAndLog/<IP>/`
Un dossier par IP attaquante :
```
<IP>/
├── <IP>_nmap.txt       ← rapport vulnérabilités (vuln-scan.sh)
├── <IP>_traceroute.txt ← chemin des routeurs, extrait de nmap --traceroute (vuln-scan.sh)
├── <IP>_dns.txt        ← reverse DNS + WHOIS (dig-ip.sh)
├── <IP>_<port>_<date>_<time>.png  ← screenshot (web-capture.sh)
└── <IP>_nikto.txt      ← rapport nikto (optionnel)
```

### `data/visualizer-dashboard/data.json`
Agrégat JSON généré par `generate-data.sh`, lu par le visualiseur.
```json
[
  {
    "ip": "218.92.0.115",
    "country": "CN",
    "lat": null, "lon": null,
    "nmap": true,
    "dns": true,
    "screenshot": false,
    "nikto": false,
    "traceroute": true,
    "hops": ["10.0.0.1", "192.168.1.1", "218.92.0.115"],
    "vuln_high": 2,
    "ports": "80,443"
  }
]
```

### `data/logs/nikto.db`
Base SQLite alimentée par `parse-nikto.sh`.
- Table `vulns` : ip, port, vulnerability, severity (HIGH/MEDIUM/LOW), cve, full_text
- Table `parsed_files` : suivi des fichiers déjà parsés (évite les doublons)

---

## Flux temps réel vs batch

| Mode | Script | Déclencheur | Fréquence |
|------|--------|-------------|-----------|
| Temps réel | `monitor.sh` | `journalctl -f` | Continu |
| Scans | `run-all-scans.sh` | cron | Configurable (1-23h) |
| Visualiseur | `generate-data.sh` | Fin de `run-all-scans.sh` | Après chaque cycle |

---

## Sécurité

- Le serveur visualiseur bind sur `127.0.0.1` uniquement
- Accès via tunnel SSH exclusivement
- Validation SQL dans `search-nikto.sh` (escape + whitelist)
- Validation des IPs avec regex avant tout traitement
- Aucun port supplémentaire ouvert sur le VPS

---

## Dépendances

| Outil | Usage |
|-------|-------|
| `endlessh` | Honeypot SSH |
| `geoip-bin` | Géolocalisation IP |
| `nmap` | Scan ports + vulnérabilités |
| `google-chrome` | Screenshots headless |
| `sqlite3` | Base vulnérabilités |
| `jq` | Manipulation JSON (cache GeoIP) |
| `python3` | Serveur visualiseur |
| `D3.js v7` | Carte + graphe réseau |
| `TopoJSON` | Contours pays (world-atlas 110m) |
