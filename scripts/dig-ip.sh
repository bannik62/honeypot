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
LIB_DIR="$SCRIPT_DIR/../lib"
if [ ! -f "$LIB_DIR/common.sh" ]; then
    echo "❌ lib/common.sh introuvable — installation incomplète." >&2
    exit 1
fi
# shellcheck source=../lib/common.sh
source "$LIB_DIR/common.sh"
load_config "$SCRIPT_DIR" || die "Erreur chargement configuration"

check_command dig dnsutils || exit 1

CSV_FILE="$DATA_DIR/logs/web_interfaces.csv"
OUTPUT_DIR="$DATA_DIR/screenshotAndLog"

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
        
        # Reverse DNS — dig peut renvoyer vide avec code 0 : sans ligne explicite, generate-data ne lit rien
        echo "📋 Reverse DNS (PTR):"
        ptr_line="$(dig +short -x "$IP" 2>/dev/null | head -n1)"
        if [ -z "$ptr_line" ]; then
            echo "  ❌ Aucun résultat"
        else
            echo "$ptr_line"
        fi
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
    # Sinon : union des IPs (web_interfaces + hops extraits des *_traceroute.txt)
    # pour que les routeurs intermédiaires aient un PTR dans hop_names (generate-data).
    temp_file=$(mktemp)
    : > "$temp_file"

    if [ -f "$CSV_FILE" ] && [ "$(tail -n +2 "$CSV_FILE" 2>/dev/null | wc -l)" -gt 0 ]; then
        tail -n +2 "$CSV_FILE" | cut -d',' -f2 >> "$temp_file"
    fi

    if [ -d "$OUTPUT_DIR" ]; then
        while IFS= read -r -d '' tf; do
            grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' "$tf" 2>/dev/null >> "$temp_file"
        done < <(find "$OUTPUT_DIR" -type f \( -name '*_traceroute.txt' -o -name '*traceroute*.txt' \) -print0 2>/dev/null)
    fi

    sort -u "$temp_file" -o "$temp_file"

    total=$(wc -l < "$temp_file" 2>/dev/null | tr -d ' ' || echo 0)
    if [ "${total:-0}" -eq 0 ]; then
        echo "❌ Aucune IP à résoudre : remplissez web_interfaces.csv (scan-web) et/ou générez des *_traceroute.txt (traceroute-ip.sh)."
        rm -f "$temp_file"
        exit 1
    fi

    echo "🔍 Scan DNS pour toutes les IPs (web + hops traceroute)..."
    echo "⚙️  Processus parallèles: $DIG_PARALLEL"
    echo ""

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
