#!/usr/bin/env python3
"""
config.py
Rôle: centraliser la configuration runtime du mini serveur visualiseur
(paths, constantes, lecture de config/config, regex IP).
"""

import os
import re
from pathlib import Path


# Racine honeypot : priorité au cwd (server.sh fait "cd $HONEYPOT_ROOT" avant de lancer)
# sinon déduit depuis __file__ (scripts/python-visualiser -> parent.parent = honeypot)
_cwd = Path(os.getcwd()).resolve()
_file_root = Path(__file__).resolve().parent.parent.parent  # script -> python-visualiser -> scripts -> honeypot
if (_cwd / "data" / "screenshotAndLog").is_dir():
    ROOT = _cwd
elif (_cwd / "data" / "visualizer-dashboard").is_dir():
    ROOT = _cwd
else:
    ROOT = _file_root

VISUALIZER_DIR = ROOT / "visualizer"
SCAN_DIR = ROOT / "data" / "screenshotAndLog"
DATA_JSON_PATH = ROOT / "data" / "visualizer-dashboard" / "data.json"
DATA_JSON_URL = "/data/visualizer-dashboard/data.json"
# Chemin réel des rapports/screenshots (aligné avec data/screenshotAndLog/<ip>/)
IP_PREFIX = "/data/screenshotAndLog/"

PORT = 8765
IP_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$")


def load_config():
    cfg = {}
    config_path = ROOT / "config" / "config"
    if config_path.is_file():
        try:
            with config_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    cfg[key.strip()] = val.strip().strip('"')
        except OSError:
            return {}
    return cfg


CONFIG = load_config()
