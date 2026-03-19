#!/usr/bin/env python3
"""
routes/vulners.py
Rôle: endpoints API Vulners (status, events, lookup) + logique cache/HTTP.
"""

import json
import urllib.error
import urllib.request
import time

from cache import (
    VULNERS_CACHE,
    VULNERS_CACHE_TTL_SECONDS,
    VULNERS_EVENTS,
    VULNERS_SERVER_VERSION,
    push_vulners_event,
)
from config import CONFIG


def _read_json_body(handler, max_bytes=1024 * 1024):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        length = 0
    if length <= 0 or length > max_bytes:
        return None
    try:
        raw = handler.rfile.read(length)
    except OSError:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def _send_json(handler, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def serve_vulners_status(handler):
    has_key = bool((CONFIG.get("VULNERS_API_KEY") or "").strip())
    _send_json(handler, {"configured": has_key, "server_version": VULNERS_SERVER_VERSION})


def serve_vulners_events(handler):
    _send_json(handler, {"events": list(VULNERS_EVENTS), "server_version": VULNERS_SERVER_VERSION})


def serve_vulners_lookup(handler):
    payload = _read_json_body(handler)
    if not payload or not isinstance(payload, dict):
        handler.send_error(400)
        return

    ids = payload.get("ids", [])
    if not isinstance(ids, list):
        handler.send_error(400)
        return

    # Normalisation : on strip et on déduplique (ordre préservé)
    ids = [str(x).strip() for x in ids if str(x).strip()]
    if len(ids) > 300:
        ids = ids[:300]
    ids = list(dict.fromkeys(ids))

    api_key = (CONFIG.get("VULNERS_API_KEY") or "").strip()
    configured = bool(api_key)

    # Pas de clé => on renvoie vide (le frontend affichera sans descriptions)
    if not api_key:
        push_vulners_event("lookup_skip_no_key", configured, len(ids))
        _send_json(handler, {"details": {}})
        return

    now = time.time()
    ids_to_fetch = []
    ids_cached_desc = {}  # {id: desc}
    for vuln_id in ids:
        ent = VULNERS_CACHE.get(vuln_id)
        if ent and isinstance(ent, dict):
            ts = ent.get("ts", 0) or 0
            desc = ent.get("desc", "")
            if ts and (now - ts) <= VULNERS_CACHE_TTL_SECONDS:
                ids_cached_desc[vuln_id] = desc
                continue
            # expired -> drop
            if vuln_id in VULNERS_CACHE:
                del VULNERS_CACHE[vuln_id]
        ids_to_fetch.append(vuln_id)

    details_cached_out = {vid: d for vid, d in ids_cached_desc.items() if d}
    if not ids_to_fetch:
        push_vulners_event(
            "lookup_cache_hit",
            configured,
            len(ids),
            docs_count=len(details_cached_out),
        )
        _send_json(handler, {"details": details_cached_out})
        return

    push_vulners_event("lookup_start", configured, len(ids_to_fetch))

    # Vulners API: authentification via header X-Api-Key (pas dans le body)
    req_body = json.dumps({"id": ids_to_fetch}).encode("utf-8")
    vulners_url_primary = "https://vulners.com/api/v3/search/id"
    vulners_url_alt = "https://vulners.com/api/v3/search/id/"
    vulners_headers = {
        "Content-Type": "application/json",
        "X-Api-Key": api_key,
        # Headers réalistes pour éviter un fingerprint "bot"
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
    }
    req = urllib.request.Request(
        vulners_url_primary,
        data=req_body,
        headers=vulners_headers,
        method="POST",
    )

    resp_body = None
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp_body = resp.read()
    except urllib.error.HTTPError as e:
        http_code = getattr(e, "code", None)
        # Certaines réponses 400 dépendent du slash final dans l'endpoint.
        if http_code == 400:
            try:
                req2 = urllib.request.Request(
                    vulners_url_alt,
                    data=req_body,
                    headers=vulners_headers,
                    method="POST",
                )
                with urllib.request.urlopen(req2, timeout=15) as resp:
                    resp_body = resp.read()
            except Exception:
                pass

        if resp_body is None:
            err = f"HTTP {getattr(e, 'code', '?')}: {getattr(e, 'reason', '')}".strip()
            push_vulners_event("lookup_error", configured, len(ids_to_fetch), error=err or "HTTP error")
            _send_json(handler, {"details": details_cached_out})
            return
    except urllib.error.URLError as e:
        err = str(getattr(e, "reason", "")) or str(e)
        push_vulners_event("lookup_error", configured, len(ids_to_fetch), error=(err[:140] if err else "URLError"))
        _send_json(handler, {"details": details_cached_out})
        return
    except TimeoutError:
        push_vulners_event("lookup_error", configured, len(ids_to_fetch), error="timeout")
        _send_json(handler, {"details": details_cached_out})
        return

    resp_text = resp_body.decode("utf-8", errors="ignore")
    low = resp_text.lower()
    # Détection Cloudflare : HTML "Just a moment..." / "Verify you are human"
    if ("just a moment" in low) or ("verify you are human" in low) or ("cf-browser-verification" in low):
        push_vulners_event("lookup_error", configured, len(ids_to_fetch), error="cloudflare_block_detected")
        _send_json(handler, {"details": details_cached_out})
        return

    details_fetched = {}
    parse_ok = False
    try:
        res = json.loads(resp_text)
        docs = (((res or {}).get("data") or {}).get("documents")) or {}
        if isinstance(docs, dict):
            # Vulners retourne des documents avec des clés qui peuvent inclure un préfixe
            # (ex: "CVELIST:CVE-2021-44228") alors que le front demande "CVE-2021-44228".
            # On re-mappe donc vers les IDs demandés en faisant correspondre le suffixe ":<id>".
            for req_id in ids_to_fetch:
                # Cherche la clé la plus probable pour req_id
                best_key = None
                if req_id in docs:
                    best_key = req_id
                else:
                    suffix = f":{req_id}"
                    for k in docs.keys():
                        if isinstance(k, str) and k.endswith(suffix):
                            best_key = k
                            break

                if not best_key:
                    continue

                v = docs.get(best_key)
                if not isinstance(v, dict):
                    continue

                # Champs possibles selon le type de document Vulners
                desc = (
                    v.get("title")
                    or v.get("description")
                    or v.get("short_description")
                    or ""
                )
                details_fetched[req_id] = str(desc) if desc is not None else ""
        parse_ok = True
    except Exception:
        parse_ok = False

    if not parse_ok:
        push_vulners_event("lookup_error", configured, len(ids_to_fetch), error="invalid_json_response")
        _send_json(handler, {"details": details_cached_out})
        return

    # Update cache (y compris négatif: '' pour les IDs sans doc)
    for vuln_id in ids_to_fetch:
        VULNERS_CACHE[vuln_id] = {"ts": now, "desc": details_fetched.get(vuln_id, "")}

    details_out = {}
    for vuln_id in ids:
        desc = ids_cached_desc.get(vuln_id) or details_fetched.get(vuln_id) or ""
        if desc:
            details_out[vuln_id] = desc

    push_vulners_event("lookup_ok", configured, len(ids_to_fetch), docs_count=len(details_out))
    _send_json(handler, {"details": details_out})
