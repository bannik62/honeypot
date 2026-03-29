# Rôle des scripts (`scripts/`)

Ce dossier contient la chaîne **bash** (et le mini serveur **Python** du visualiseur).  
La plupart des scripts `.sh` chargent `../lib/common.sh` et la configuration via `load_config` ; les exceptions sont indiquées ci‑dessous.

---

## Collecte Endlessh → CSV

| Script | Rôle |
|--------|------|
| **`parser.sh`** | Lit sur **stdin** des lignes de log Endlessh (`ACCEPT host=…`), géolocalise les IP (GeoIP + cache JSON), dédoublonne par rapport au CSV existant, écrit dans `data/logs/connections.csv`. Appelé typiquement par `monitor.sh` ou `stats.sh`, pas seul en général. |
| **`monitor.sh`** | **Surveillance temps réel** : suit `journalctl` sur le service Endlessh (`SERVICE_NAME` dans la config), envoie chaque ligne pertinente à `parser.sh`. Gère PID/lock dans `data/cache`, commandes **start / stop / status** (usage type : `honeypot-monitor` si alias installé). Ne charge pas `common.sh` : config lue directement depuis `config/config`. |
| **`stats.sh`** | Rejoue **tout l’historique** `journalctl` pour Endlessh, alimente le CSV via `parser.sh`, puis affiche des **statistiques agrégées** dans le terminal (totaux, pays, etc.). |
| **`dashboard.sh`** | **Tableau de bord ASCII** en boucle : lit uniquement `connections.csv`, rafraîchit l’écran (stats + dernières connexions). |

---

## Enrichissement (scans, fichiers par IP)

| Script | Rôle |
|--------|------|
| **`nmap-to-csv.sh`** | À partir de `connections.csv`, détecte les **services web** (ports HTTP/HTTPS, etc.) avec **nmap**, produit `data/logs/web_interfaces.csv`. Rotation optionnelle des gros CSV. |
| **`web-capture.sh`** | Lit `web_interfaces.csv` : **captures d’écran** headless (Chrome/Chromium) des pages, lance **nikto** quand disponible, écrit sous `data/screenshotAndLog/<IP>/`. Peut déclencher un scan nmap préalable si le CSV est absent. |
| **`dig-ip.sh`** | Pour les IP concernées, produit des rapports **DNS** (`dig`) dans `screenshotAndLog/<IP>/`, en s’appuyant sur `web_interfaces.csv` pour cibler les hôtes. |
| **`vuln-scan.sh`** | Pour les IP du CSV, lance **nmap** (`-F -sV --script vuln`) et enregistre `<IP>/<IP>_nmap.txt`. **Sans** `--traceroute** (souvent réservé au root) ; parallélisation configurable (`NMAP_PARALLEL`). |
| **`traceroute-ip.sh`** | **Usage manuel** (souvent `sudo`) : traceroute / enrichissement des routes pour des IP dérivées de `connections.csv`. **Hors cron** ; ne charge pas `common.sh`, logique `DATA_DIR` alignée sur `generate-data.sh`. |

---

## Données visualiseur & base vulnérabilités

| Script | Rôle |
|--------|------|
| **`generate-data.sh`** | Parcourt `data/screenshotAndLog/`, consolide métadonnées (geo, rapports, chemins fichiers…) et écrit **`data/visualizer-dashboard/data.json`** pour le dashboard web. Verrou **flock** pour éviter les écritures concurrentes (cron + lancement manuel). |
| **`parse-nikto.sh`** | Parse les rapports (nmap / chemins sous `screenshotAndLog`) et alimente la base **SQLite** `data/logs/nikto.db` (table des vulnérabilités). |
| **`search-vuln.sh`** | **Interface interactive** (menu) ou usages en ligne de commande pour interroger `nikto.db` (par IP, sévérité, mots-clés, stats). |

---

## Orchestration & automatisation

| Script | Rôle |
|--------|------|
| **`run-all-scans.sh`** | **Séquence cron** : enchaîne `nmap-to-csv.sh` → `web-capture.sh` → `dig-ip.sh` → `vuln-scan.sh`, puis `cleanup-old-data.sh`, puis `generate-data.sh`. Journalise dans `data/logs/run-all-scans.log` (rotation du log intégrée). **N’inclut pas** `traceroute-ip.sh`. |
| **`setup-auto-scan.sh`** | Lit `config/config` (`AUTO_SCAN_ENABLED`, `AUTO_SCAN_HOUR`) et installe ou retire une ligne **crontab** qui exécute `run-all-scans.sh`. |
| **`dashboard-regenerate.sh`** | Raccourci « tout regénérer » : enchaîne **`traceroute-ip.sh` (sudo)** puis **`generate-data.sh`** (pour rafraîchir routes + `data.json`). |

---

## Maintenance & diagnostic

| Script | Rôle |
|--------|------|
| **`cleanup-old-data.sh`** | Supprime ou rogne l’ancien : captures **PNG** (> 30 j), rapports **nmap** (> 60 j), **backups** `.bak.gz` (> 90 j), et limite le **cache GeoIP** à ~10 Mo via `jq`. |
| **`honeypot-check.sh`** | **Diagnostic** installation : service Endlessh, daemon monitoring, chemins, dépendances, etc. Utilise la config directement, pas `common.sh`. |

---

## Dossier `python-visualiser/`

| Fichier | Rôle |
|---------|------|
| **`server.sh`** | Wrapper **start | stop | status** du serveur HTTP local (**127.0.0.1:8765**), lance `server.py` en arrière-plan, gère un fichier PID sous `/tmp`. |
| **`server.py`** | Point d’entrée : `ThreadingHTTPServer` sur le port défini dans `config.py`, délègue aux routes via `handler.py`. |
| **`handler.py`** | Routage des requêtes vers les modules `routes/*`. |
| **`config.py`** | Port, chemins vers `visualizer/` et `data/visualizer-dashboard/`. |
| **`routes/`** | **API** du dashboard : données agrégées, IP détail, audit, sonde/SSE, statiques, **LAB** (`routes/lab.py` — HTTP/TCP d’étude avec garde-fous), etc. (voir les docstrings dans chaque fichier). |
| **`cache.py`** | Cache léger côté serveur si utilisé par les routes. |

---

## Dépendance commune

- **`../lib/common.sh`** : fonctions partagées (`load_config`, `get_data_dir`, logs, rotation de fichiers, `check_command`, etc.). Si le fichier est absent, les scripts concernés affichent une erreur explicite et quittent avec le code 1.

Pour l’ordre d’exécution « métier » et les flux, voir aussi `../docs/FLUXES_MERMAID.md` et `../docs/FLOWCHART.md`.
