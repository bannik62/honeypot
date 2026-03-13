#!/bin/bash

# Lit le CSV des interfaces web et fait les captures + scan nikto
# Lance automatiquement le scan nmap si le CSV n'existe pas ou est vide

# Variable pour le nettoyage
temp_file=""

# Nettoyage des fichiers temporaires en cas d'interruption
cleanup_temp_files() {
    if [ -n "$temp_file" ] && [ -f "$temp_file" ]; then
        rm -f "$temp_file" 2>/dev/null
    fi
}

trap cleanup_temp_files EXIT INT TERM

# Nettoyage du cache temporaire de Chromium snap après chaque capture
cleanup_chromium_tmp() {
    find /tmp/snap-private-tmp/snap.chromium -mindepth 2 -maxdepth 3 \
        -type d -name "tmp" -exec rm -rf {}/* \; 2>/dev/null
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Vérifier les dépendances et détecter le bon binaire
if command -v chromium-browser &> /dev/null; then
    CHROMIUM_BIN="chromium-browser"
elif command -v chromium &> /dev/null; then
    CHROMIUM_BIN="chromium"
else
    echo "❌ Erreur: chromium-browser ou chromium n'est pas installé" >&2
    echo "💡 Installez-le avec: sudo apt install chromium-browser" >&2
    exit 1
fi

# Charger la config
CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
    export CAPTURE_PARALLEL
else
    DATA_DIR="$SCRIPT_DIR/../data"
fi

if [ -z "$CAPTURE_PARALLEL" ] || ! [[ "$CAPTURE_PARALLEL" =~ ^[0-9]+$ ]] || [ "$CAPTURE_PARALLEL" -lt 1 ]; then
    CAPTURE_PARALLEL=1
fi

CSV_INPUT="$DATA_DIR/logs/web_interfaces.csv"
OUTPUT_DIR="$DATA_DIR/screenshotAndLog"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')

# Créer le répertoire
mkdir -p "$OUTPUT_DIR"

# Vérifier si le CSV existe et contient des données
if [ ! -f "$CSV_INPUT" ] || [ $(tail -n +2 "$CSV_INPUT" 2>/dev/null | wc -l) -eq 0 ]; then
    echo "📡 CSV vide ou absent, lancement du scan nmap..."
    "$SCRIPT_DIR/nmap-to-csv.sh"
    echo ""
fi

if [ ! -f "$CSV_INPUT" ] || [ $(tail -n +2 "$CSV_INPUT" 2>/dev/null | wc -l) -eq 0 ]; then
    echo "❌ Aucune interface web trouvée"
    exit 1
fi

echo "📸 Capture des interfaces web depuis le CSV..."
echo "⚙️  Processus parallèles: $CAPTURE_PARALLEL"
echo ""

# Fonction pour capturer une URL
capture_one_url() {
    local timestamp_url="$1"
    local ip="$2"
    local port="$3"
    local protocol="$4"
    local url="$5"
    
    ip_dir="${OUTPUT_DIR}/${ip}"
    mkdir -p "$ip_dir"
    filename="${ip_dir}/${ip}_${port}_${TIMESTAMP}.png"
    
    echo "  📷 Capture: $url"
    
    # Vérifier si une capture existe déjà pour cette IP/port
    existing_capture=$(find "$ip_dir" -name "${ip}_${port}_*.png" 2>/dev/null | head -1)
    if [ -n "$existing_capture" ]; then
        echo "  ⏭️  Capture déjà existante, skip: $url"
        return 0
    fi
    
    # Capture avec chromium headless
    timeout 15 "$CHROMIUM_BIN" --headless --disable-gpu --no-sandbox --disable-web-security --ignore-certificate-errors --ignore-ssl-errors --window-size=1920,1080 --screenshot="$filename" "$url" 2>/dev/null
    cleanup_chromium_tmp
    
    # Si HTTPS échoue (port 443/8443), réessayer en HTTP
    if [ ! -f "$filename" ] || [ ! -s "$filename" ]; then
        if [ "$port" = "443" ] || [ "$port" = "8443" ]; then
            http_url="http://${ip}:${port}"
            echo "  ⚠️  HTTPS échoué, tentative en HTTP: $http_url"
            timeout 15 "$CHROMIUM_BIN" --headless --disable-gpu --no-sandbox --window-size=1920,1080 --screenshot="$filename" "$http_url" 2>/dev/null
            cleanup_chromium_tmp
        fi
    fi
    
    # Si échec, essayer avec wkhtmltoimage
    if [ ! -f "$filename" ] || [ ! -s "$filename" ]; then
        timeout 15 wkhtmltoimage --width 1920 "$url" "$filename" 2>/dev/null
    fi
    
    # Créer un fichier info
    if [ -f "$filename" ] && [ -s "$filename" ]; then
        echo "IP: $ip" > "${filename%.png}.txt"
        echo "Port: $port" >> "${filename%.png}.txt"
        echo "Protocol: $protocol" >> "${filename%.png}.txt"
        echo "URL: $url" >> "${filename%.png}.txt"
        echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')" >> "${filename%.png}.txt"
        echo "✅ Capture réussie: $filename"
    else
        echo "  ❌ Échec capture: $url"
        rm -f "$filename"
    fi
}

export -f capture_one_url cleanup_chromium_tmp
export OUTPUT_DIR TIMESTAMP CHROMIUM_BIN

# Créer une liste temporaire des URLs à capturer
temp_file=$(mktemp)
tail -n +2 "$CSV_INPUT" | while IFS=',' read -r timestamp ip port protocol url scanned; do
    # Ignorer les lignes sans port ou URL valide
    if [ "$port" != "none" ] && [ "$url" != "none" ] && [ -n "$url" ]; then
        echo "${timestamp}|${ip}|${port}|${protocol}|${url}"
    fi
done > "$temp_file"

total=$(wc -l < "$temp_file" 2>/dev/null || echo 0)

if [ "$total" -eq 0 ]; then
    echo "✅ Toutes les captures sont terminées"
    rm -f "$temp_file"
    exit 0
fi

# Capturer (séquentiel ou parallèle)
if [ "$CAPTURE_PARALLEL" -eq 1 ]; then
    # Mode séquentiel
    count=0
    while IFS='|' read -r timestamp ip port protocol url; do
        count=$((count + 1))
        echo "[$count/$total]"
        capture_one_url "$timestamp" "$ip" "$port" "$protocol" "$url"
    done < "$temp_file"
else
    # Mode parallèle avec xargs
    while IFS='|' read -r timestamp ip port protocol url; do
        printf '%s\0%s\0%s\0%s\0%s\0' "$timestamp" "$ip" "$port" "$protocol" "$url"
    done < "$temp_file" | xargs -0 -P "$CAPTURE_PARALLEL" -n 5 bash -c '
        capture_one_url "$1" "$2" "$3" "$4" "$5"
    ' _
fi

rm -f "$temp_file"

echo ""
echo "✅ Captures sauvegardées dans: $OUTPUT_DIR"
echo "   Total captures: $(find "$OUTPUT_DIR" -name "*.png" -type f 2>/dev/null | wc -l)"
