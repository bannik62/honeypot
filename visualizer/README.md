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
- Réponse : **`text/plain; charset=utf-8`** en flux — tout ce que `generate-data.sh` écrit sur stdout/stderr, puis une ligne finale `__HONEYPOT_EXIT__ <code>` (code retour du script, `124` = timeout serveur, **50 min** — gros volumes d’IPs).
- Le frontend lit le flux avec `fetch` + `ReadableStream`, affiche le texte dans le scroll, puis parse le code de sortie.

### `POST /api/dashboard/regenerate` (JSON, sans flux)

- Exécute le même script ; réponse JSON unique (utile pour scripts / clients sans stream).
- Timeout : **50 minutes** (`REGENERATE_TIMEOUT_SEC` dans `routes/dashboard.py`).

```json
{ "ok": true, "returncode": 0, "stdout_tail": "...", "stderr_tail": "" }
```

### Traceroute

Les traceroutes manquants se font **sur le VPS** (souvent `sudo bash scripts/traceroute-ip.sh`), pas via cette API — raw sockets / durée. Après backfill traceroute, utilisez **Régénérer data.json** pour mettre à jour le graphe et les stats.
