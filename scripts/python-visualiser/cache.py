#!/usr/bin/env python3
"""
cache.py
Rôle: stocker l'état en mémoire pour Vulners (feed d'événements + cache TTL).
"""

import time
from collections import deque


# Buffer d'événements Vulners (sans la clé, ni les tokens)
VULNERS_EVENTS = deque(maxlen=200)
VULNERS_EVENT_ID = 0
VULNERS_SERVER_VERSION = "v2"

# Cache mémoire TTL (24h) pour éviter de re-frapper Vulners.
# Stocke par ID: desc string (peut être '' si aucun document renvoyé).
VULNERS_CACHE_TTL_SECONDS = 24 * 60 * 60
VULNERS_CACHE = {}  # { id: { ts: float, desc: str } }


def push_vulners_event(event_type, configured, ids_count, **extra):
    """Ajoute un événement dans le feed Vulners et renvoie son id."""
    global VULNERS_EVENT_ID
    VULNERS_EVENT_ID += 1
    event = {
        "id": VULNERS_EVENT_ID,
        "ts": time.time(),
        "type": event_type,
        "configured": configured,
        "ids_count": ids_count,
        "server_version": VULNERS_SERVER_VERSION,
    }
    event.update(extra or {})
    VULNERS_EVENTS.append(event)
    return VULNERS_EVENT_ID
