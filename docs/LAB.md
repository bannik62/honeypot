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
  - champs “visibles” (`input[type=text|email|password|…]`) → **leurs `name`** sont ajoutés au body prérempli avec valeur vide
- préremplissage automatique de l’appel suivant:
  - méthode `POST`
  - URL = `form[action]` (si trouvé)
  - headers suggérés:
    - `Content-Type: application/x-www-form-urlencoded`
    - `Origin` / `Referer`
    - `X-CSRF-Token` si `meta csrf-token` est présent
  - body urlencoded (hidden + token + clés des champs visibles)
- **URL logique (mode GOD / DNS)** : l’extraction (`urljoin`) et le préremplissage (`post_url`, `Origin`, `Referer`) partent de l’**URL que tu as saisie** (hostname), pas de l’IPv4 résolue en interne, pour éviter de remplacer le champ URL par une IP (erreur TLS / certificat). La réponse JSON inclut `logical_url` (URL affichable) et `request_url` (URL réellement utilisée pour la socket, peut être IP).

---

## TCP brut

Permet une connexion TCP sortante vers `host:port`.

- **Host**: IPv4 littérale (whitelist) ou hostname (selon règles serveur / mode)
- **Payload**: texte UTF-8 ou hex
- **Read max / timeout**

---

## Mode GOD (DNS)

En mode normal, les URLs HTTP doivent utiliser une **IPv4 littérale** (pas de DNS).  
En **mode GOD**, les URLs peuvent utiliser un **hostname**:

- le serveur résout le hostname vers la **première IPv4** et exécute la requête vers cette IP
- l’en-tête `Host` est positionné sur le hostname (vhost)

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
- **Whitelist IPv4**: certaines opérations restent limitées aux IPs autorisées (`data/screenshotAndLog/<ip>/`, `LAB_ALLOW_IPS`, `127.0.0.1`)

---

## Configuration (backend)

Clés lues dans `CONFIG` (fichier `config/config` via `scripts/python-visualiser/config.py`) :

- **`LAB_RATE_PER_MINUTE`** (ou `LAB_RATE_PER_MIN`): limite par minute (défaut 60)
- **`LAB_MAX_CONCURRENCY`** (ou `LAB_CONCURRENCY`): requêtes LAB simultanées (défaut 10)
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
