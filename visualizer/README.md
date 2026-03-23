# Dashboard web (visualizer)

Fichiers statiques servis par `scripts/python-visualiser/server.py` (`http://127.0.0.1:8765`).

## Chargement & maintenance (overlay)

Le module `js/loading-overlay.js` expose `loadingOverlay` :

| Méthode | Rôle |
|--------|------|
| `show({ message, indeterminate, progress })` | Overlay plein écran ; barre indéterminée par défaut, ou `indeterminate: false` + `progress` (0–100). |
| `showTerminal({ message, title })` | Masque la barre, affiche la zone scroll **type terminal** (`#loading-overlay-log`). |
| `appendLogChunk(text)` | Ajoute du texte au scroll (flux en direct). |
| `setProgress(n)` / `setMessage(text)` | Mise à jour pendant une opération longue. |
| `hide()` | Ferme l’overlay et réinitialise la barre / le log. |
| `showError(message)` | Affiche une erreur lisible + bouton **Fermer** (ex. sortie serveur). |

**Flux utilisés :**

1. **Chargement initial** — `loadInitialData()` : barre indéterminée + message pendant le `fetch` de `data.json`.
2. **Régénération** — `runRegenerateAndReload()` : `POST /api/dashboard/regenerate-stream` → sortie du script **en direct** dans le scroll (comme un terminal), puis rechargement du JSON.

## API serveur — régénérer `data.json`

### `POST /api/dashboard/regenerate-stream` (utilisé par le dashboard)

- Corps : ignoré (peut être `{}`).
- Réponse : **`text/plain; charset=utf-8`** — sortie de **`dashboard-regenerate.sh`** (traceroute puis generate), puis `__HONEYPOT_EXIT__ <code>` (`124` = timeout, **90 min**).
- Le frontend lit le flux avec `fetch` + `ReadableStream`, affiche le texte dans le scroll, puis parse le code de sortie.

### `POST /api/dashboard/regenerate` (JSON, sans flux)

- Exécute le même script ; réponse JSON unique (utile pour scripts / clients sans stream).
- Timeout : **90 minutes** (`REGENERATE_TIMEOUT_SEC` dans `routes/dashboard.py`).

```json
{ "ok": true, "returncode": 0, "stdout_tail": "...", "stderr_tail": "" }
```

### Traceroute

Le bouton **Régénérer** appelle `dashboard-regenerate.sh`, qui lance **`sudo bash traceroute-ip.sh`** puis `generate-data.sh`.

## API — Sonde (tcpdump, SSE)

- **`GET /api/sonde/stream?port=&layer=&filter=&direction=`** — `direction` : `both` (défaut), `in` (dst port → lignes **In**), `out` (src port → **Out**). `text/event-stream` : JSON `{"t":"…"}` par ligne. Un seul tcpdump actif ; une nouvelle connexion tue le précédent.
- **`POST /api/sonde/stop`** — arrête le tcpdump actif. JSON `{ "ok": true, "stopped": true }`.

Couches : `L3` (tcp/udp/icmp + port), `L4` (fanions `syn` / `fin` / `rst` séparément ou `synfinrst`), `L7` (`-A` + `greater`). Filtres : whitelist dans `routes/sonde.py`.

Le serveur utilise **`ThreadingHTTPServer`** pour ne pas bloquer les autres requêtes pendant un flux SSE.
