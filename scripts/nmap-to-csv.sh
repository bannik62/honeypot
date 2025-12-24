#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

# Charger la configuration
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
    # Ports par défaut si pas de config
    SCAN_PORTS="80,443,8080,8443,8000,8888"
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
if [ -f "$CSV_OUTPUT" ]; then rm "$CSV_OUTPUT"; fi
if [ ! -f "$CSV_OUTPUT" ]; then
    echo "timestamp,ip,port,protocol,url" > "$CSV_OUTPUT"
fi

# Convertir SCAN_PORTS en format nmap (remplacer virgules par des virgules)
SCAN_PORTS_NMAP=$(echo "$SCAN_PORTS" | tr ',' ' ' | xargs | tr ' ' ',')

echo "🔍 Scan des ports web sur les IPs du honeypot..."
echo "📋 Ports à scanner: $SCAN_PORTS"
echo ""

# Extraire toutes les IPs uniques de connections.csv (ignorer en-tête)
all_ips=$(tail -n +2 "$LOG_FILE" | cut -d',' -f2 | sort -u)

# Extraire les IPs déjà scannées (ignorer en-tête)
scanned_ips=$(tail -n +2 "$CSV_OUTPUT" 2>/dev/null | cut -d',' -f2 | sort -u)

# Trouver les nouvelles IPs à scanner (différence entre all_ips et scanned_ips)
if [ -z "$scanned_ips" ]; then
    # Pas encore de scans, tout scanner
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
current=0

echo "$ips_to_scan" | while IFS= read -r ip; do
    if [ -z "$ip" ]; then
        continue
    fi
    
    current=$((current + 1))
    echo "[$current/$total] Scanning $ip..."
    
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
            timestamp=$(date '+%Y-%m-%d %H:%M:%S')
            
            echo "  ✅ $url ($protocol)"
            echo "$timestamp,$ip,$port,$url_protocol,$url" >> "$CSV_OUTPUT"
        done
    fi
done

echo ""
echo "✅ Scan terminé ! Résultats dans: $CSV_OUTPUT"
echo "💡 Utilisez 'capture-web' pour prendre des screenshots"
