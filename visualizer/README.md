# Dashboard web (visualizer)

Fichiers statiques servis par `scripts/python-visualiser/server.py` (`http://127.0.0.1:8765`).

## Chargement & maintenance (overlay)

Le module `js/loading-overlay.js` expose `loadingOverlay` :

| Méthode | Rôle |
|--------|------|
| `show({ message, indeterminate, progress })` | Overlay plein écran ; barre indéterminée par défaut, ou `indeterminate: false` + `progress` (0–100). |
| `setProgress(n)` / `setMessage(text)` | Mise à jour pendant une opération longue. |
| `hide()` | Ferme l’overlay et réinitialise la barre. |
| `showError(message)` | Affiche une erreur lisible + bouton **Fermer** (ex. sortie serveur). |

**Flux utilisés :**

1. **Chargement initial** — `data-loader.js` → `loadInitialData()` pendant le `fetch` de `data.json`.
2. **Régénération** — bouton **↻ Régénérer data.json** → `runRegenerateAndReload()` : overlay pendant l’appel serveur puis rechargement du JSON.

## API serveur — régénérer `data.json`

`POST /api/dashboard/regenerate`

- Exécute `scripts/generate-data.sh` depuis la racine du projet honeypot (équivalent `honeypot-make-visualizer-data` / agrégation vers `data/visualizer-dashboard/data.json`).
- Timeout côté serveur : **10 minutes**.
- Réponse JSON typique :

```json
{ "ok": true, "returncode": 0, "stdout_tail": "...", "stderr_tail": "" }
```

En cas d’échec du script :

```json
{ "ok": false, "returncode": 1, "error": "...", "stderr_tail": "..." }
```

Le frontend affiche `error` et/ou `stderr_tail` dans l’overlay d’erreur.

### Traceroute

Les traceroutes manquants se font **sur le VPS** (souvent `sudo bash scripts/traceroute-ip.sh`), pas via cette API — raw sockets / durée. Après backfill traceroute, utilisez **Régénérer data.json** pour mettre à jour le graphe et les stats.
