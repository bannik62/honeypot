#!/bin/bash
# Script pour scanner les vulnérabilités avec nmap (100 ports communs)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"

# Valeurs par défaut pour les timeouts nmap
NMAP_MAX_RTT_TIMEOUT="${NMAP_MAX_RTT_TIMEOUT:-500ms}"
NMAP_HOST_TIMEOUT="${NMAP_HOST_TIMEOUT:-600s}"
else
    DATA_DIR="$SCRIPT_DIR/../data"
    NMAP_PARALLEL=1
fi

if [ -z "$NMAP_PARALLEL" ] || [ "$NMAP_PARALLEL" -lt 1 ]; then
    NMAP_PARALLEL=1
fi

CSV_INPUT="$DATA_DIR/logs/connections.csv"
OUTPUT_DIR="$DATA_DIR/screenshots"

if [ ! -f "$CSV_INPUT" ]; then
    echo "❌ Fichier connections.csv non trouvé"
    exit 1
fi

if ! command -v nmap &> /dev/null; then
    echo "❌ nmap n'est pas installé"
    exit 1
fi

echo "🔍 Scan de vulnérabilités avec nmap..."
echo "📋 Ports: 100 ports les plus communs (-F)"
echo "⚙️  Processus parallèles: $NMAP_PARALLEL"
echo ""

# Extraire les IPs uniques de connections.csv
all_ips=$(tail -n +2 "$CSV_INPUT" | cut -d',' -f2 | sort -u)

# Trouver les IPs déjà scannées (fichier <IP>_nmap.txt existe)
scanned_ips=""
for ip in $all_ips; do
    if [ -f "$OUTPUT_DIR/$ip/${ip}_nmap.txt" ]; then
        scanned_ips="$scanned_ips$ip"$'\n'
    fi
done

# Trouver les nouvelles IPs à scanner
if [ -n "$scanned_ips" ]; then
    ips_to_scan=$(comm -23 <(echo "$all_ips" | sort) <(echo "$scanned_ips" | sort -u))
else
    ips_to_scan="$all_ips"
fi

total=$(echo "$ips_to_scan" | grep -v '^$' | wc -l)

if [ "$total" -eq 0 ]; then
    echo "✅ Toutes les IPs ont déjà été scannées"
    exit 0
fi

echo "📊 IPs totales: $(echo "$all_ips" | wc -l)"
echo "✅ Déjà scannées: $(echo "$scanned_ips" | grep -v '^$' | wc -l)"
echo "🆕 Nouvelles IPs à scanner: $total"
echo ""

# Créer un fichier temporaire pour la liste des IPs
IPS_LIST=$(mktemp)
echo "$ips_to_scan" | grep -v '^$' > "$IPS_LIST"

# Fonction pour scanner une IP
scan_one_ip() {
    local ip="$1"
    local output_dir="$2"
    
    local ip_dir="${output_dir}/${ip}"
    mkdir -p "$ip_dir"
    local report_file="${ip_dir}/${ip}_nmap.txt"
    
    # Scan nmap avec vulnérabilités (100 ports communs)
    nmap -F -sV --script vuln --max-rtt-timeout "${NMAP_MAX_RTT_TIMEOUT:-500ms}" --host-timeout "${NMAP_HOST_TIMEOUT:-600s}" "$ip" > "$report_file" 2>&1
    
    if [ $? -eq 0 ]; then
        echo "  ✅ Terminé: $ip"
    else
        echo "  ⚠️  Échec: $ip"
        if [ ! -f "$report_file" ] || [ ! -s "$report_file" ]; then
            echo "Scan failed: error" > "$report_file"
        fi
    fi
}

export -f scan_one_ip
export OUTPUT_DIR

# Scanner (séquentiel ou parallèle)
if [ "$NMAP_PARALLEL" -eq 1 ]; then
    count=0
    while IFS= read -r ip; do
        count=$((count + 1))
        echo "[$count/$total] 🔍 Scanning: $ip"
        scan_one_ip "$ip" "$OUTPUT_DIR"
    done < "$IPS_LIST"
else
    # Mode parallèle avec xargs (écriture directe dans fichiers séparés, pas de conflit)
    cat "$IPS_LIST" | xargs -P "$NMAP_PARALLEL" -I {} bash -c 'scan_one_ip "$1" "$2"' _ {} "$OUTPUT_DIR"
fi

rm -f "$IPS_LIST"

echo ""
echo "✅ Scans terminés !"
