#!/usr/bin/env python3
"""
server.py
Rôle: point d'entrée du serveur visualiseur (zéro dépendance externe).
Le dispatch HTTP est implémenté dans handler.py et routes/*.
"""

import sys
from http.server import ThreadingHTTPServer

from config import PORT, VISUALIZER_DIR
from handler import VisualizerHandler


def main():
    if not VISUALIZER_DIR.is_dir():
        print("Erreur: visualizer/ introuvable", file=sys.stderr)
        sys.exit(1)
    # Threading : SSE (sonde, regenerate-stream) ne bloque pas les autres requêtes.
    server = ThreadingHTTPServer(("127.0.0.1", PORT), VisualizerHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
