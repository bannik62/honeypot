#!/bin/bash
# start | stop | status pour le serveur visualiseur (127.0.0.1:8765)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HONEYPOT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PID_FILE="/tmp/honeypot-visualizer.pid"
PORT=8765

cmd="${1:-}"

is_running() {
    local pid
    [ -f "$PID_FILE" ] || return 1
    pid=$(cat "$PID_FILE" 2>/dev/null)
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

case "$cmd" in
    start)
        if is_running; then
            echo "⚠️  Serveur visualiseur déjà en cours (PID: $(cat "$PID_FILE"))"
            exit 1
        fi
        cd "$HONEYPOT_ROOT" || exit 1
        python3 "$SCRIPT_DIR/server.py" &
        echo $! > "$PID_FILE"
        sleep 0.5
        if is_running; then
            echo ""
            echo "✅ Serveur visualiseur démarré"
            echo ""
            echo "  À quoi ça sert ?"
            echo "  Le dashboard affiche la carte des IPs, les stats et la liste des attaques."
            echo "  Les données (data.json) se chargent toutes seules au démarrage de la page."
            echo ""
            echo "  Ouvrir la page :"
            echo "  • Si vous êtes sur le VPS (terminal SSH) : le serveur écoute en local uniquement."
            echo "  • Depuis votre PC : connectez-vous au VPS en SSH avec cette commande (gardez la fenêtre ouverte) :"
            echo "  ⚠️  Important : gardez la fenêtre SSH/tunnel ouverte pendant toute l'utilisation du dashboard."
            echo "    ssh -L $PORT:127.0.0.1:$PORT USER@IP_DE_VOTRE_VPS"
            echo "    Puis ouvrez dans votre navigateur : http://localhost:$PORT"
            echo ""
            echo "  Quand vous avez fini, pensez à éteindre le serveur :"
            echo "  → honeypot-start-server stop"
            echo ""
        else
            rm -f "$PID_FILE"
            echo "❌ Échec du démarrage du serveur"
            exit 1
        fi
        ;;
    stop)
        if ! is_running; then
            echo "ℹ️  Serveur visualiseur non démarré"
            rm -f "$PID_FILE"
            exit 0
        fi
        pid=$(cat "$PID_FILE")
        kill "$pid" 2>/dev/null
        for _ in 1 2 3 4 5; do
            kill -0 "$pid" 2>/dev/null || break
            sleep 0.5
        done
        kill -9 "$pid" 2>/dev/null
        rm -f "$PID_FILE"
        echo "✅ Serveur visualiseur arrêté"
        ;;
    status)
        if is_running; then
            echo "🟢 Serveur visualiseur en cours (PID: $(cat "$PID_FILE"), http://127.0.0.1:$PORT)"
        else
            rm -f "$PID_FILE"
            echo "⚪ Serveur visualiseur arrêté"
        fi
        ;;
    *)
        echo "Usage: $0 {start|stop|status}"
        exit 1
        ;;
esac
