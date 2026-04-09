## LAB (HTTP/TCP) — outil d’étude

Le module **LAB** permet d’exécuter depuis le **VPS** des requêtes **HTTP(S)** et des connexions **TCP** pour tester/étudier des services dans un cadre autorisé.

> Le serveur visualiseur écoute sur `127.0.0.1` et l’accès se fait via tunnel SSH. Le trafic LAB part du VPS.

---

## Accès

Dans le dashboard web, onglet **LAB**.

---

## HTTP (Web)

### Requête simple

- **Méthode**: GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS
- **URL**: `http://…` ou `https://…`
  - Sans schéma, le backend préfixe par `https://` (ex. `example.com` → `https://example.com`)
- **En-têtes (JSON)**: objet JSON (certains headers sont filtrés côté backend)
- **Host (optionnel)**: remplace l’en-tête `Host` (utile si tu te connectes en IP mais que tu veux cibler un vhost)
- **Corps**: chaîne (UTF-8) envoyée telle quelle (utile pour `application/x-www-form-urlencoded`, JSON, etc.)

### Suivre les redirections

Case **“Suivre les redirections (30x)”** :

- décoché: la première réponse 30x est renvoyée (mode analyse)
- coché: `urllib` suit les redirections jusqu’à la réponse finale
  - l’UI affiche aussi **l’URL finale** (`final_url`) et la **chaîne de redirections** (`redirect_chain`)

### Session (cookies)

Case **“Session (cookies)”** :

- le backend conserve une **CookieJar** par session (ID stocké côté navigateur)
- les `Set-Cookie` du GET sont renvoyés automatiquement aux requêtes suivantes (flow login → pages authentifiées)

### Extraction + préremplissage (CSRF/hidden)

Case **“Extraire + préremplir (CSRF/hidden)”** (après une réponse HTML) :

- extraction:
  - `form[action]` (URL POST)
  - `input[type=hidden][name][value]` (tous)
  - `input[name="authenticity_token"]` (Rails)
  - `meta[name="csrf-token"]` / `meta[name="csrf-param"]`
  - tokens CSRF courants (si présents) :
    - Django : `csrfmiddlewaretoken`
    - Laravel/Symfony : `_token`
    - Spring Security : meta `name="_csrf"` + `name="_csrf_header"` (et hidden `_csrf` si présent)
    - ASP.NET : `__RequestVerificationToken`
  - champs “visibles” (`input[type=text|email|password|…]`) → **leurs `name`** sont ajoutés au body prérempli avec valeur vide
- préremplissage automatique de l’appel suivant:
  - méthode `POST`
  - URL = `form[action]` (si trouvé)
  - headers suggérés:
    - `Content-Type: application/x-www-form-urlencoded`
    - `Origin` / `Referer`
    - `X-CSRF-Token` si `meta csrf-token` est présent
    - Spring Security : si meta `_csrf_header` est présent, le header correspondant est aussi prérempli
  - body urlencoded (hidden + token + clés des champs visibles)

#### Hint “Framework”

À côté de la case “Extraire + préremplir”, le menu **Framework** permet de guider l’extraction :

- **Auto** : essaie les patterns connus.
- Rails / Django / Laravel / Spring / ASP.NET : priorise le framework choisi (fallback sur auto).

L’extraction renvoie aussi `extracted.csrf.detected_as` (framework probable), à titre indicatif.
- **URL logique (mode GOD / DNS)** : l’extraction (`urljoin`) et le préremplissage (`post_url`, `Origin`, `Referer`) partent de l’**URL que tu as saisie** (hostname), pas de l’IPv4 résolue en interne, pour éviter de remplacer le champ URL par une IP (erreur TLS / certificat). La réponse JSON inclut `logical_url` (URL affichable) et `request_url` (URL réellement utilisée pour la socket, peut être IP).

---

## Presets (bibliothèque Web / TCP)

Les listes sont servies depuis `visualizer/lab/presets-web.json` et `presets-tcp.json` (`GET /api/lab/presets/web|tcp`).

### Application (mode global)

À côté du sélecteur **Preset Web**, le menu **Application** contrôle comment le preset est fusionné avec le formulaire :

| Mode | Comportement |
|------|----------------|
| **Remplacer tout** | Méthode, URL, Host optionnel, en-têtes JSON, corps : valeurs du preset. |
| **Fusion en-têtes** | Comme remplacer tout, sauf **en-têtes** : les clés déjà présentes et non vides sont conservées ; le preset ne remplit que les clés vides et ajoute les nouvelles. |
| **Uniquement champs vides** | URL, Host, corps : appliqués seulement si le champ est vide. **En-têtes** : même logique que « fusion ». La **méthode** n’est pas modifiée (le sélecteur a toujours une valeur). |

Le choix est mémorisé dans `localStorage` (`labPresetApplyMode`).

### Surcharge par preset (`merge` dans le JSON)

Chaque entrée peut définir un objet optionnel `merge` pour préciser le comportement **par champ** : `method`, `url`, `host_header`, `headers`, `body`.

Valeurs possibles :

- `override` — remplacer.
- `fill_empty` — (hors `headers`) n’appliquer que si le champ est vide ; pour `headers`, équivalent à la fusion « ne pas écraser les clés déjà remplies ».
- `merge` — **uniquement pour `headers`** : fusion comme ci-dessus.
- `json_shallow` — **uniquement pour `body`** : si le corps actuel et le corps du preset sont tous deux des objets JSON, fusion superficielle `{ …existant, …preset }` (les clés du preset écrasent les clés communes).

Exemple :

```json
"merge": {
  "headers": "merge",
  "body": "json_shallow"
}
```

### Variables `{{…}}` (HTTP et TCP)

Dans `method`, `url`, `host_header`, `headers`, `body` (HTTP) et `host`, `payload`, `bind_ipv4` (TCP), les motifs `{{NOM}}` sont remplacés avant application.

**HTTP** — contexte dérivé du champ **URL** et de **Host** optionnel :

| Variable | Exemple |
|----------|---------|
| `URL` | Texte brut du champ URL |
| `ORIGIN` | `https://exemple.com` (si l’URL est absolue valide) |
| `HOST` | `exemple.com:443` |
| `PATHNAME` | `/chemin` |
| `SEARCH` | `?x=1` |
| `PROTOCOL` | `https` |
| `HOST_HEADER` | Valeur du champ « En-tête Host » |

**TCP** — contexte depuis les champs **Hôte** et **Port** : `HOST`, `PORT`.

---

## TCP brut

Permet une connexion TCP sortante vers `host:port`.

- **Host**: **hors GOD** — IPv4 littérale soumise à la whitelist ; **en GOD** — IPv4 littérale ou hostname sans filtre liste sur la cible
- **IP source (bind, optionnel)** : `bind_ipv4` dans le corps JSON — avant `connect()`, la socket peut être liée à une **IPv4 locale**. **Hors mode GOD** : la même **whitelist** que pour les cibles (`LAB_ALLOW_IPS`, etc.). **En mode GOD** : pas de filtre sur cette liste pour le bind (comme pour une cible résolue via DNS) ; seule une IPv4 valide est exigée — si l’adresse n’est pas assignée au VPS, le `bind` échoue côté OS. Utile si la machine a plusieurs adresses : le pair distant voit cette IP (ex. MySQL / reverse DNS). Réponse JSON : `source_ipv4`, `bind_ipv4` si demandé.
- **Payload**: texte UTF-8 ou hex
- **Read max / timeout**

---

## Mode GOD

En mode normal, les URLs HTTP doivent utiliser une **IPv4 littérale** présente dans la **whitelist** (pas de DNS).  
En **mode GOD** (header `X-Lab-God`), la **cible** n’est plus filtrée par cette liste, que tu mettes une **IPv4 littérale** ou un **hostname** :

- **Hostname** : le serveur résout vers la **première IPv4** ; l’en-tête `Host` est le hostname (vhost)
- **IPv4 littérale** : connexion directe vers cette IP (sans devoir l’ajouter à `LAB_ALLOW_IPS`)

Le mode GOD est activé depuis l’onglet LAB via la séquence Konami (UI dédiée dans l’onglet).

---

## Raccourcis & UX

- **Boutons désactivés pendant une requête**: évite les doubles envois
- **Historique (10 dernières requêtes)**: recharge une requête précédente, suppression via “×”
- **Onglet IPs → LAB**: badge **LAB** sur chaque IP → ouvre l’onglet LAB et pré-remplit l’URL `http://<ip>`

---

## Limites & protections

- **Rate-limit**: par minute (retourne `429` avec “réessayez dans X s”)
- **Concurrence**: nombre maximum de requêtes LAB simultanées (retourne `429` si saturé)
- **Limites amovibles en mode GOD** (UI “Limites (GOD)”):
  - `Strict` : limites normales (par minute + concurrence)
  - `Boost` : limites “GOD” (config)
  - `Off` : désactive rate-limit + concurrence (à utiliser consciemment)
- **Whitelist IPv4 (cible)** : hors GOD, une **IPv4 littérale** en HTTP/TCP doit être autorisée (`data/screenshotAndLog/<ip>/`, `LAB_ALLOW_IPS`, `127.0.0.1`). En GOD, pas de filtre sur la cible ; le bind TCP optionnel reste soumis à la whitelist **hors GOD** (voir section TCP).

---

## Configuration (backend)

Clés lues dans `CONFIG` (fichier `config/config` via `scripts/python-visualiser/config.py`) :

- **`LAB_RATE_PER_MINUTE`** (ou `LAB_RATE_PER_MIN`): limite par minute (défaut 60)
- **`LAB_MAX_CONCURRENCY`** (ou `LAB_CONCURRENCY`): requêtes LAB simultanées (défaut 10)
- **`LAB_GOD_RATE_PER_MINUTE`** (ou `LAB_GOD_RATE_PER_MIN`): limite par minute en mode `Boost` (défaut = `LAB_RATE_PER_MINUTE`)
- **`LAB_GOD_MAX_CONCURRENCY`**: concurrence en mode `Boost` (défaut = `LAB_MAX_CONCURRENCY`)
- **`LAB_SESSION_TTL_SEC`**: durée de vie d’une session cookies (défaut 1800 s)
- **`LAB_ALLOW_IPS`**: IPs additionnelles autorisées (CSV)

---

## Reste à faire / améliorations

- **Extraction HTML plus large**:
  - Django (`csrfmiddlewaretoken`), Laravel/Symfony (`_token`), Spring (`_csrf`), ASP.NET (`__RequestVerificationToken`)
  - `textarea`, `select`, boutons submit (`commit`)
  - support `multipart/form-data` (upload) si besoin
- **Affichage “Extraits”**:
  - masquer partiellement certains tokens (option)
  - afficher la liste complète des cookies + domaine/chemin
- **Historique**:
  - option persistance (localStorage) + bouton “clear all”
- **follow_redirects**:
  - afficher l’URL finale + éventuellement la chaîne de redirections
