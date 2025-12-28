#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

# Charger la configuration
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
    export NMAP_PARALLEL
else
    DATA_DIR="$SCRIPT_DIR/../data"
    # Ports par défaut si pas de config
    SCAN_PORTS="80,443,8080,8443,8000,8888"
fi

if [ -z "$NMAP_PARALLEL" ] || [ "$NMAP_PARALLEL" -lt 1 ]; then
    NMAP_PARALLEL=1
fi

LOG_FILE="$DATA_DIR/logs/connections.csv"
CSV_OUTPUT="$DATA_DIR/logs/web_interfaces.csv"

# Vérifier que connections.csv existe
if [ ! -f "$LOG_FILE" ]; then
    echo "❌ Fichier $LOG_FILE introuvable"
    echo "💡 Lancez d'abord honeypot-monitor pour générer les connexions"
    exit 1
fi

# Créer le CSV de sortie avec en-têtes si nécessaire
if [ ! -f "$CSV_OUTPUT" ]; then
    echo "timestamp,ip,port,protocol,url,scanned" > "$CSV_OUTPUT"
fi

# Convertir SCAN_PORTS en format nmap
SCAN_PORTS_NMAP=$(echo "$SCAN_PORTS" | tr ',' ' ' | xargs | tr ' ' ',')

echo "🔍 Scan des ports web sur les IPs du honeypot..."
echo "📋 Ports à scanner: $SCAN_PORTS"
echo "⚙️  Processus parallèles: $NMAP_PARALLEL"
echo ""

# Extraire les IPs déjà scannées (ignorer en-tête)
scanned_ips=$(tail -n +2 "$CSV_OUTPUT" 2>/dev/null | awk -F',' '$6=="1" {print $2}' | sort -u)

# Trouver les nouvelles IPs à scanner
all_ips=$(tail -n +2 "$LOG_FILE" | cut -d',' -f2 | sort -u)

# Pas encore de scans, tout scanner
if [ -z "$scanned_ips" ]; then
    ips_to_scan="$all_ips"
    echo "🆕 Premier scan : toutes les IPs seront scannées"
else
    # Comparer et trouver les nouvelles IPs
    ips_to_scan=$(comm -23 <(echo "$all_ips") <(echo "$scanned_ips"))

    total_all=$(echo "$all_ips" | wc -l)
    total_scanned=$(echo "$scanned_ips" | wc -l)
    total_new=$(echo "$ips_to_scan" | grep -v '^$' | wc -l)

    echo "📊 IPs dans connections.csv: $total_all"
    echo "✅ Déjà scannées: $total_scanned"
    echo "🆕 Nouvelles IPs à scanner: $total_new"
    echo ""
fi

# Si aucune nouvelle IP, on a terminé
if [ -z "$ips_to_scan" ] || [ -z "$(echo "$ips_to_scan" | grep -v '^$')" ]; then
    echo "✅ Toutes les IPs ont déjà été scannées !"
    echo "💡 Utilisez 'capture-web' pour prendre des screenshots"
    exit 0
fi

total=$(echo "$ips_to_scan" | grep -v '^$' | wc -l)

# Fonction pour scanner une IP
scan_one_ip() {
    local ip="$1"
    
    # Scan nmap des ports configurés
    result=$(nmap -p "$SCAN_PORTS_NMAP" -T4 --open "$ip" 2>/dev/null | grep -E "^[0-9]+/(tcp|udp)" | grep "open")
    
    if [ -n "$result" ]; then
        echo "$result" | while read -r line; do
            # Extraire port et protocole
            port=$(echo "$line" | awk '{print $1}' | cut -d'/' -f1)
            protocol=$(echo "$line" | awk '{print $1}' | cut -d'/' -f2)
            
            # Déterminer le protocole URL
            if [ "$port" = "443" ] || [ "$port" = "8443" ]; then
                url_protocol="https"
            else
                url_protocol="http"
            fi
            
            url="${url_protocol}://${ip}:${port}"
            
            # Vérifier que le port répond vraiment en HTTP/HTTPS avec curl
            http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 --connect-timeout 3 --insecure "$url" 2>/dev/null)
            
            # Si curl échoue, vérifier avec wget ou juste vérifier qu'il y a une réponse
            if [ -z "$http_code" ] || [ "$http_code" = "000" ]; then
                # Essayer avec wget comme fallback (plus permissif)
                wget_response=$(wget --spider --timeout=3 --tries=1 -S "$url" 2>&1 | head -1 | grep -i "http" || echo "")
                if [ -z "$wget_response" ]; then
                    # Le port est ouvert mais ne répond pas en HTTP, on le skip
                    continue
                fi
            fi
            
            timestamp=$(date '+%Y-%m-%d %H:%M:%S')
            
            echo "  ✅ $url ($protocol)"
            echo "$timestamp,$ip,$port,$url_protocol,$url,1" >> "$CSV_OUTPUT"
        done
    else
        # Aucun port ouvert, marquer comme scanné quand même
        timestamp=$(date '+%Y-%m-%d %H:%M:%S')
        echo "$timestamp,$ip,none,none,none,1" >> "$CSV_OUTPUT"
    fi
}

export -f scan_one_ip
export CSV_OUTPUT SCAN_PORTS_NMAP

# Scanner (séquentiel ou parallèle)
if [ "$NMAP_PARALLEL" -eq 1 ]; then
    # Mode séquentiel
    count=0
    echo "$ips_to_scan" | grep -v '^$' | while IFS= read -r ip; do
        count=$((count + 1))
        echo "[$count/$total] Scanning $ip..."
        scan_one_ip "$ip"
    done
else
    # Mode parallèle avec xargs
    echo "$ips_to_scan" | grep -v '^$' | xargs -P "$NMAP_PARALLEL" -I {} bash -c '
        ip="$1"
        echo "🔍 Scanning: $ip"
        scan_one_ip "$ip"
    ' _ {}
fi

echo ""
echo "✅ Scan terminé ! Résultats dans: $CSV_OUTPUT"
echo "💡 Utilisez 'capture-web' pour prendre des screenshots"
