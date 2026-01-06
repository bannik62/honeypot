#!/bin/bash
# Script pour faire des requêtes DNS sur les IPs du honeypot

# Variable pour le nettoyage
temp_file=""

# Nettoyage des fichiers temporaires en cas d'interruption
cleanup_temp_files() {
    if [ -n "$temp_file" ] && [ -f "$temp_file" ]; then
        rm -f "$temp_file" 2>/dev/null
    fi
}

trap cleanup_temp_files EXIT INT TERM

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Vérifier les dépendances
if ! command -v dig &> /dev/null; then
    echo "❌ Erreur: dig n'est pas installé" >&2
    echo "💡 Installez-le avec: sudo apt install dnsutils" >&2
    exit 1
fi

CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
    DIG_PARALLEL=1
fi

if [ -z "$DIG_PARALLEL" ] || [ "$DIG_PARALLEL" -lt 1 ]; then
    DIG_PARALLEL=1
fi

CSV_FILE="$DATA_DIR/logs/web_interfaces.csv"
OUTPUT_DIR="$DATA_DIR/screenshots"

# Fonction pour scanner une IP
scan_ip() {
    local IP="$1"
    local ip_dir="${OUTPUT_DIR}/${IP}"
    local report_file="${ip_dir}/${IP}_dns.txt"
    
    mkdir -p "$ip_dir"
    
    # Si le rapport existe déjà, skip
    if [ -f "$report_file" ]; then
        echo "⏭️  Rapport existant, skip: $IP"
        return 0
    fi
    
    echo "🔍 Scan DNS pour: $IP"
    
    # Créer le fichier de rapport
    {
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "Informations DNS pour: $IP"
        echo "Date: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        
        # Reverse DNS
        echo "📋 Reverse DNS (PTR):"
        dig +short -x "$IP" 2>/dev/null || echo "  ❌ Aucun résultat"
        echo ""
        
        # WHOIS (si disponible)
        if command -v whois &> /dev/null; then
            echo "📋 WHOIS:"
            whois "$IP" 2>/dev/null || echo "  ❌ Erreur whois"
        fi
    } > "$report_file"
    
    if [ -f "$report_file" ] && [ -s "$report_file" ]; then
        echo "  ✅ Rapport sauvegardé: $report_file"
    else
        echo "  ❌ Échec création rapport: $IP"
    fi
}

export -f scan_ip
export OUTPUT_DIR

# Si une IP est fournie en argument, scanner uniquement cette IP
if [ -n "$1" ]; then
    IP="$1"
    scan_ip "$IP"
else
    # Sinon, scanner toutes les IPs uniques du CSV
    if [ ! -f "$CSV_FILE" ] || [ $(tail -n +2 "$CSV_FILE" 2>/dev/null | wc -l) -eq 0 ]; then
        echo "❌ Aucune IP trouvée dans web_interfaces.csv. Lancez d'abord 'scan-web'"
        exit 1
    fi
    
    echo "🔍 Scan DNS pour toutes les IPs..."
    echo "⚙️  Processus parallèles: $DIG_PARALLEL"
    echo ""
    
    # Extraire les IPs uniques (ignorer l'en-tête)
    temp_file=$(mktemp)
    tail -n +2 "$CSV_FILE" | cut -d',' -f2 | sort -u > "$temp_file"
    total=$(wc -l < "$temp_file" 2>/dev/null || echo 0)
    
    if [ "$total" -eq 0 ]; then
        echo "✅ Aucune IP à scanner"
        rm -f "$temp_file"
        exit 0
    fi
    
    # Scanner (séquentiel ou parallèle)
    if [ "$DIG_PARALLEL" -eq 1 ]; then
        # Mode séquentiel
        count=0
        while IFS= read -r IP; do
            count=$((count + 1))
            echo "[$count/$total]"
            scan_ip "$IP"
            echo ""
        done < "$temp_file"
    else
        # Mode parallèle avec xargs
        cat "$temp_file" | xargs -P "$DIG_PARALLEL" -I {} bash -c '
            scan_ip "$1"
        ' _ {}
    fi
    
    rm -f "$temp_file"
    
    echo ""
    echo "✅ Tous les scans DNS terminés !"
fi
