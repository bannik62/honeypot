#!/bin/bash
# Scanne les IPs avec nmap et crée un CSV avec celles qui ont des interfaces web

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV_INPUT="$SCRIPT_DIR/../data/logs/connections.csv"
CSV_OUTPUT="$SCRIPT_DIR/../data/logs/web_interfaces.csv"
IPS_FILE="/tmp/ips_to_scan.txt"
NMAP_LOG="/tmp/nmap_scan.txt"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Créer le CSV de sortie avec en-têtes si nécessaire
if [ ! -f "$CSV_OUTPUT" ]; then
    echo "timestamp,ip,port,protocol,url" > "$CSV_OUTPUT"
fi

# Extraire les IPs uniques
tail -n +2 "$CSV_INPUT" | cut -d',' -f2 | sort -u > "$IPS_FILE"

echo "🔍 Scan des ports HTTP avec nmap..."
# Scanner et sauvegarder le log
nmap -iL "$IPS_FILE" -p 80,443,8080,8443,8000,8888 -T4 --open -oN "$NMAP_LOG"

echo ""
echo "📝 Création du CSV des interfaces web..."
# Parser le log nmap et créer le CSV
current_ip=""
while IFS= read -r line; do
    # Détecter une nouvelle IP
    if [[ $line =~ Nmap\ scan\ report\ for\ (.+) ]]; then
        current_ip="${BASH_REMATCH[1]}"
        # Nettoyer l'IP (enlever le hostname si présent)
        current_ip=$(echo "$current_ip" | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' || echo "$current_ip")
    # Détecter un port HTTP ouvert
    elif [[ $line =~ ([0-9]+)/tcp.*open.*http ]]; then
        port="${BASH_REMATCH[1]}"
        protocol="http"
        if [ "$port" = "443" ] || [ "$port" = "8443" ]; then
            protocol="https"
        fi
        
        if [ -n "$current_ip" ]; then
            url="${protocol}://${current_ip}:${port}"
            echo "$TIMESTAMP,$current_ip,$port,$protocol,$url" >> "$CSV_OUTPUT"
            echo "  ✅ $url"
        fi
    fi
done < "$NMAP_LOG"

echo ""
echo "📊 CSV créé: $CSV_OUTPUT"
echo "   Total interfaces: $(tail -n +2 "$CSV_OUTPUT" | wc -l)"
