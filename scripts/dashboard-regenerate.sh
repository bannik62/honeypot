#!/bin/bash
# Bouton « Régénérer » : 1) sudo traceroute-ip  2) generate-data
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "========== 1/2 — traceroute-ip.sh (sudo) =========="
sudo bash "$SCRIPT_DIR/traceroute-ip.sh"
echo ""
echo "========== 2/2 — generate-data.sh =========="
exec bash "$SCRIPT_DIR/generate-data.sh"
