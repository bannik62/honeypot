#!/bin/bash
# Lit le CSV des interfaces web et fait les captures + scan nikto
# Lance automatiquement le scan nmap si le CSV n'existe pas ou est vide

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV_INPUT="$SCRIPT_DIR/../data/logs/web_interfaces.csv"
OUTPUT_DIR="$SCRIPT_DIR/../data/screenshots"
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
# Lire le CSV et faire les captures
tail -n +2 "$CSV_INPUT" | while IFS=',' read -r timestamp ip port protocol url; do
    filename="${OUTPUT_DIR}/${ip}_${port}_${TIMESTAMP}.png"
    
    echo "  📷 Capture: $url"
    
    # Capture avec chromium headless
    timeout 15 chromium-browser --headless --disable-gpu --no-sandbox --window-size=1920,1080 --screenshot="$filename" "$url" 2>/dev/null
    
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
        
        # Scan nikto
        if command -v nikto &> /dev/null; then
            echo "  🔍 Scan nikto: $url"
            nikto -h "$url" -output "${filename%.png}_nikto.txt" -Format txt 2>/dev/null
        fi
    else
        echo "  ❌ Échec capture: $url"
        rm -f "$filename"
    fi
done

echo ""
echo "✅ Captures sauvegardées dans: $OUTPUT_DIR"
echo "   Total captures: $(ls -1 "$OUTPUT_DIR"/*.png 2>/dev/null | wc -l)"
