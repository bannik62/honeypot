#!/bin/bash
# Script de recherche dans les rapports Nikto (menu interactif + CLI)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Vérifier les dépendances
if ! command -v sqlite3 &> /dev/null; then
    echo "❌ Erreur: sqlite3 n'est pas installé" >&2
    echo "💡 Installez-le avec: sudo apt install sqlite3" >&2
    exit 1
fi

CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
fi

DB_FILE="$DATA_DIR/logs/nikto.db"

# Fonction pour échapper les chaînes SQL (prévention injection SQL)
escape_sql() {
    local input="$1"
    # Échapper les guillemets simples en les doublant
    echo "$input" | sed "s/'/''/g"
}

# Fonction pour valider une IP ou partie d'IP
validate_ip_input() {
    local input="$1"
    # Autoriser seulement des caractères alphanumériques, points, deux-points et tirets
    if [[ "$input" =~ ^[0-9a-fA-F.:-]+$ ]]; then
        return 0
    else
        return 1
    fi
}

# Fonction pour valider un mot-clé (pas de caractères SQL dangereux)
validate_keyword() {
    local input="$1"
    # Autoriser seulement des caractères alphanumériques, espaces, tirets, underscores, points
    if [[ "$input" =~ ^[0-9a-zA-Z\s._-]+$ ]]; then
        return 0
    else
        return 1
    fi
}

# Fonction pour afficher le menu
show_menu() {
    clear
    echo "🔍 Recherche Nikto - Menu Principal"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "1. 📍 Rechercher par IP (ou partie d'IP)"
    echo "   → Exemple: \"172\" retourne toutes les IPs contenant 172"
    echo ""
    echo "2. 📊 Statistiques générales"
    echo "   → Top 10 vulnérabilités"
    echo "   → Types de serveurs détectés"
    echo ""
    echo "3. 📋 Liste toutes les IPs avec vulnérabilités"
    echo "   → Liste avec statistiques HIGH/MEDIUM/LOW"
    echo ""
    echo "4. 🔎 Recherche par mot-clé"
    echo "   → Cherche dans toutes les vulnérabilités/fichiers"
    echo "   → Exemple: \"backup\", \"admin\", \"Apache 2.4\""
    echo ""
    echo "5. 🔥 Recherche vulnérabilités HIGH uniquement"
    echo "   → Toutes les vulnérabilités critiques"
    echo ""
    echo "6. 💣 Recherche exploits disponibles"
    echo "   → EXPLOIT, PACKETSTORM, EDB (exploits publics)"
    echo ""
    echo "7. 🆕 Recherche CVEs récents (2024-2025)"
    echo "   → Vulnérabilités découvertes récemment"
    echo ""
    echo "8. 📈 Top IPs avec vulnérabilités HIGH"
    echo "   → IPs les plus critiques à analyser"
    echo ""
    echo "9. 📤 Exporter les résultats"
    echo "   → CSV, JSON, ou affichage formaté"
    echo ""
    echo "10. 🗑️  Purger la base de données"
    echo "    → Supprimer toutes les données (vulns + parsed_files)"
    echo ""
    echo "11. ❌ Quitter"
    echo ""
}

# Fonction pour afficher les détails d'une IP avec full_text
show_ip_details() {
    local detail_ip="$1"
    local filter_severity="$2"
    
    # Valider l'IP
    if ! validate_ip_input "$detail_ip"; then
        echo "❌ IP invalide: $detail_ip"
        return 1
    fi
    
    echo ""
    echo "📋 Détails des vulnérabilités pour: $detail_ip"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    local detail_ip_escaped=$(escape_sql "$detail_ip")
    local where_clause="WHERE ip = '$detail_ip_escaped'"
    if [ -n "$filter_severity" ]; then
        local severity_escaped=$(escape_sql "$filter_severity")
        where_clause="$where_clause AND severity = '$severity_escaped'"
    fi
    
    sqlite3 -header -column "$DB_FILE" << SQL
SELECT port, vulnerability, severity, file_path
FROM vulns
$where_clause
ORDER BY severity DESC, port;
SQL

    echo ""
    read -p "Voir les détails complets (score, URL) ? (o/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        echo ""
        echo "📄 Détails complets pour: $detail_ip"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        
        sqlite3 "$DB_FILE" << SQL | while IFS='|' read -r port vuln full_text; do
SELECT port || '|' || vulnerability || '|' || full_text
FROM vulns
$where_clause
ORDER BY severity DESC, port;
SQL
            if [ -n "$port" ] && [ -n "$vuln" ]; then
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                echo "Port: $port | Vulnérabilité: $vuln"
                echo ""
                echo "$full_text"
                echo ""
            fi
        done
    fi
    
    # Afficher les domaines DNS associés
    dns_file="$DATA_DIR/screenshots/$detail_ip/${detail_ip}_dns.txt"
    if [ -f "$dns_file" ]; then
        echo ""
        echo "🌐 Domaines associés:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        domains=$(grep -E "\.(com|net|org|fr|io|co|uk|de|jp|cn|ru|info|biz|me|tv|cc|ws|name|mobi|asia|tel|pro|travel|xxx|aero|jobs|museum|edu|gov|mil|int|[a-z]{2,})$" "$dns_file" 2>/dev/null | \
        grep -vE "^(#|;|$|\[|Query|Server|DNS|WHOIS|Reverse)" | \
        grep -oE "[a-zA-Z0-9][a-zA-Z0-9.-]{1,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}" | \
        sort -u | head -20)
        
        if [ -n "$domains" ]; then
            echo "$domains" | sed 's/^/   • /'
        else
            echo "   (Aucun domaine trouvé)"
        fi
    fi
}

# Fonction pour rechercher par IP
search_by_ip() {
    echo ""
    read -p "🔍 Entrez l'IP (ou partie d'IP): " search_ip
    if [ -z "$search_ip" ]; then
        echo "❌ IP vide"
        return
    fi
    
    # Valider l'input
    if ! validate_ip_input "$search_ip"; then
        echo "❌ IP invalide: caractères non autorisés détectés"
        return 1
    fi

    echo ""
    echo "📋 Résultats pour IP contenant: $search_ip"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    local search_ip_escaped=$(escape_sql "$search_ip")
    sqlite3 -header -column "$DB_FILE" << SQL
SELECT DISTINCT ip, port, COUNT(*) as vulns_count
FROM vulns
WHERE ip LIKE '%$search_ip_escaped%'
GROUP BY ip, port
ORDER BY vulns_count DESC
LIMIT 50;
SQL

    echo ""
    read -p "Voir les détails d'une IP ? (o/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        read -p "Entrez l'IP complète: " detail_ip
        if [ -n "$detail_ip" ]; then
            show_ip_details "$detail_ip"
        fi
    fi
}

# Fonction pour afficher les statistiques
show_stats() {
    echo ""
    echo "📊 Statistiques générales"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    total=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM vulns;")
    unique_ips=$(sqlite3 "$DB_FILE" "SELECT COUNT(DISTINCT ip) FROM vulns;")
    high_count=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM vulns WHERE severity='HIGH';")
    medium_count=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM vulns WHERE severity='MEDIUM';")
    low_count=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM vulns WHERE severity='LOW';")

    echo "📈 Totaux:"
    echo "   • Total vulnérabilités/trouvailles: $total"
    echo "   • IPs uniques: $unique_ips"
    echo "   • HIGH: $high_count"
    echo "   • MEDIUM: $medium_count"
    echo "   • LOW: $low_count"
    echo ""

    echo "🔝 Top 10 vulnérabilités/trouvailles:"
    sqlite3 -header -column "$DB_FILE" << SQL
SELECT vulnerability, COUNT(*) as count
FROM vulns
GROUP BY vulnerability
ORDER BY count DESC
LIMIT 10;
SQL

    echo ""
    echo "🔝 Top 10 fichiers/chemins trouvés:"
    sqlite3 -header -column "$DB_FILE" << SQL
SELECT file_path, COUNT(*) as count
FROM vulns
WHERE file_path != ''
GROUP BY file_path
ORDER BY count DESC
LIMIT 10;
SQL
}

# Fonction pour lister toutes les IPs
list_ips() {
    echo ""
    echo "📋 Toutes les IPs avec vulnérabilités"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    sqlite3 -header -column "$DB_FILE" << SQL
SELECT
    ip,
    COUNT(DISTINCT port) as ports,
    COUNT(*) as total,
    SUM(CASE WHEN severity = 'HIGH' THEN 1 ELSE 0 END) as HIGH,
    SUM(CASE WHEN severity = 'MEDIUM' THEN 1 ELSE 0 END) as MEDIUM,
    SUM(CASE WHEN severity = 'LOW' THEN 1 ELSE 0 END) as LOW
FROM vulns
GROUP BY ip
ORDER BY HIGH DESC, total DESC;
SQL

    echo ""
    read -p "Voir les détails d'une IP ? (o/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        read -p "Entrez l'IP complète: " detail_ip
        if [ -n "$detail_ip" ]; then
            show_ip_details "$detail_ip"
        fi
    fi
}

# Fonction pour rechercher par mot-clé
search_keyword() {
    echo ""
    read -p "🔍 Entrez le mot-clé à rechercher: " keyword
    if [ -z "$keyword" ]; then
        echo "❌ Mot-clé vide"
        return
    fi
    
    # Valider l'input
    if ! validate_keyword "$keyword"; then
        echo "❌ Mot-clé invalide: caractères non autorisés détectés"
        return 1
    fi

    echo ""
    echo "📋 Résultats pour: $keyword"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    local keyword_escaped=$(escape_sql "$keyword")
    sqlite3 -header -column "$DB_FILE" << SQL
SELECT ip, port, vulnerability, severity, file_path
FROM vulns
WHERE vulnerability LIKE '%$keyword_escaped%'
   OR file_path LIKE '%$keyword_escaped%'
   OR server_version LIKE '%$keyword_escaped%'
ORDER BY severity DESC, ip, port
LIMIT 100;
SQL

    echo ""
    read -p "Voir les détails d'une IP ? (o/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        read -p "Entrez l'IP complète: " detail_ip
        if [ -n "$detail_ip" ]; then
            show_ip_details "$detail_ip"
        fi
    fi
}

# Fonction pour rechercher vulnérabilités HIGH
search_high() {
    echo ""
    echo "🔥 Vulnérabilités HIGH (Critiques)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    total_high=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM vulns WHERE severity='HIGH';")
    echo "📊 Total vulnérabilités HIGH: $total_high"
    echo ""

    sqlite3 -header -column "$DB_FILE" << SQL
SELECT ip, port, vulnerability, file_path
FROM vulns
WHERE severity = 'HIGH'
ORDER BY ip, port
LIMIT 200;
SQL

    echo ""
    read -p "Voir les détails d'une IP ? (o/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        read -p "Entrez l'IP complète: " detail_ip
        if [ -n "$detail_ip" ]; then
            show_ip_details "$detail_ip" "HIGH"
        fi
    fi
}

# Fonction pour rechercher exploits
search_exploits() {
    echo ""
    echo "💣 Exploits disponibles (EXPLOIT, PACKETSTORM, EDB)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    total_exploits=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM vulns WHERE vulnerability LIKE 'EXPLOIT%' OR vulnerability LIKE 'PACKETSTORM:%' OR vulnerability LIKE 'EDB-%';")
    echo "📊 Total exploits trouvés: $total_exploits"
    echo ""

    sqlite3 -header -column "$DB_FILE" << SQL
SELECT DISTINCT ip, port, vulnerability, severity
FROM vulns
WHERE vulnerability LIKE 'EXPLOIT%'
   OR vulnerability LIKE 'PACKETSTORM:%'
   OR vulnerability LIKE 'EDB-%'
ORDER BY severity DESC, ip, port
LIMIT 200;
SQL

    echo ""
    read -p "Voir les détails d'une IP ? (o/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        read -p "Entrez l'IP complète: " detail_ip
        if [ -n "$detail_ip" ]; then
            show_ip_details "$detail_ip"
        fi
    fi
}

# Fonction pour rechercher CVEs récents
search_recent_cves() {
    echo ""
    echo "🆕 CVEs récents (2024-2025)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    total_cves=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM vulns WHERE vulnerability LIKE 'CVE-2024-%' OR vulnerability LIKE 'CVE-2025-%';")
    echo "📊 Total CVEs récents: $total_cves"
    echo ""

    sqlite3 -header -column "$DB_FILE" << SQL
SELECT DISTINCT ip, port, vulnerability, severity
FROM vulns
WHERE vulnerability LIKE 'CVE-2024-%'
   OR vulnerability LIKE 'CVE-2025-%'
ORDER BY vulnerability DESC, severity DESC, ip
LIMIT 200;
SQL

    echo ""
    read -p "Voir les détails d'une IP ? (o/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        read -p "Entrez l'IP complète: " detail_ip
        if [ -n "$detail_ip" ]; then
            show_ip_details "$detail_ip"
        fi
    fi
}

# Fonction pour top IPs HIGH
top_ips_high() {
    echo ""
    echo "📈 Top IPs avec vulnérabilités HIGH"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    sqlite3 -header -column "$DB_FILE" << SQL
SELECT
    ip,
    COUNT(DISTINCT port) as ports,
    SUM(CASE WHEN severity = 'HIGH' THEN 1 ELSE 0 END) as HIGH,
    SUM(CASE WHEN severity = 'MEDIUM' THEN 1 ELSE 0 END) as MEDIUM,
    SUM(CASE WHEN severity = 'LOW' THEN 1 ELSE 0 END) as LOW,
    COUNT(*) as total
FROM vulns
GROUP BY ip
HAVING HIGH > 0
ORDER BY HIGH DESC, total DESC
LIMIT 50;
SQL

    echo ""
    read -p "Voir les détails d'une IP ? (o/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        read -p "Entrez l'IP complète: " detail_ip
        if [ -n "$detail_ip" ]; then
            show_ip_details "$detail_ip"
        fi
    fi
}

# Fonction pour exporter
export_results() {
    echo ""
    echo "📤 Export des résultats"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "1. Export CSV"
    echo "2. Export JSON"
    echo "3. Export formaté (affichage)"
    echo ""
    read -p "Choix [1-3]: " export_choice

    case $export_choice in
        1)
            output_file="$DATA_DIR/logs/nikto_export_$(date +%Y%m%d_%H%M%S).csv"
            sqlite3 -header -csv "$DB_FILE" "SELECT * FROM vulns;" > "$output_file"
            echo "✅ Export CSV sauvegardé: $output_file"
            ;;
        2)
            output_file="$DATA_DIR/logs/nikto_export_$(date +%Y%m%d_%H%M%S).json"
            sqlite3 -json "$DB_FILE" "SELECT * FROM vulns;" > "$output_file"
            echo "✅ Export JSON sauvegardé: $output_file"
            ;;
        3)
            sqlite3 -header -column "$DB_FILE" "SELECT * FROM vulns LIMIT 100;"
            ;;
        *)
            echo "❌ Choix invalide"
            ;;
    esac
}

# Fonction pour purger la base
purge_database() {
    echo ""
    echo "🗑️  Purge de la base de données"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    total_vulns=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM vulns;" 2>/dev/null || echo "0")
    total_files=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM parsed_files;" 2>/dev/null || echo "0")

    echo "⚠️  ATTENTION : Cette action est irréversible !"
    echo ""
    echo "Données à supprimer :"
    echo "   • Vulnérabilités/trouvailles: $total_vulns"
    echo "   • Fichiers parsés: $total_files"
    echo ""
    read -p "Confirmer la purge ? Tapez 'PURGER' en majuscules : " confirm

    if [ "$confirm" != "PURGER" ]; then
        echo "❌ Purge annulée"
        return
    fi

    echo ""
    echo "🗑️  Suppression des données..."

    sqlite3 "$DB_FILE" << SQL
DELETE FROM vulns;
DELETE FROM parsed_files;
VACUUM;
SQL

    if [ $? -eq 0 ]; then
        echo "✅ Base de données purgée avec succès !"
        echo "💡 Les tables sont vides, vous pouvez relancer parse-nikto.sh pour re-parser les rapports"
    else
        echo "❌ Erreur lors de la purge"
    fi
}

# Vérifier que la base existe
if [ ! -f "$DB_FILE" ]; then
    echo "❌ Base de données non trouvée: $DB_FILE"
    echo "💡 Lancez d'abord: parse-nikto.sh"
    exit 1
fi

# Mode CLI si des arguments sont fournis
if [ $# -gt 0 ]; then
    case "$1" in
        --ip)
            search_ip="$2"
            if [ -z "$search_ip" ]; then
                echo "❌ IP vide"
                exit 1
            fi
            if ! validate_ip_input "$search_ip"; then
                echo "❌ IP invalide: caractères non autorisés détectés"
                exit 1
            fi
            search_ip_escaped=$(escape_sql "$search_ip")
            sqlite3 -header -column "$DB_FILE" "SELECT DISTINCT ip, port, COUNT(*) as vulns_count FROM vulns WHERE ip LIKE '%$search_ip_escaped%' GROUP BY ip, port ORDER BY vulns_count DESC LIMIT 50;"
            ;;
        --keyword)
            keyword="$2"
            if [ -z "$keyword" ]; then
                echo "❌ Mot-clé vide"
                exit 1
            fi
            if ! validate_keyword "$keyword"; then
                echo "❌ Mot-clé invalide: caractères non autorisés détectés"
                exit 1
            fi
            keyword_escaped=$(escape_sql "$keyword")
            sqlite3 -header -column "$DB_FILE" "SELECT ip, port, vulnerability, file_path FROM vulns WHERE vulnerability LIKE '%$keyword_escaped%' OR file_path LIKE '%$keyword_escaped%' ORDER BY ip, port LIMIT 100;"
            ;;
        --stats)
            show_stats
            ;;
        --export)
            format="${2:-csv}"
            output_file="$DATA_DIR/logs/nikto_export_$(date +%Y%m%d_%H%M%S).$format"
            if [ "$format" = "json" ]; then
                sqlite3 -json "$DB_FILE" "SELECT * FROM vulns;" > "$output_file"
            else
                sqlite3 -header -csv "$DB_FILE" "SELECT * FROM vulns;" > "$output_file"
            fi
            echo "✅ Export sauvegardé: $output_file"
            ;;
        --purge)
            purge_database
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --ip IP          Rechercher par IP (ou partie d'IP)"
            echo "  --keyword TERM   Rechercher par mot-clé"
            echo "  --stats          Afficher les statistiques"
            echo "  --export [csv|json]  Exporter les résultats (défaut: csv)"
            echo "  --purge          Purger la base de données"
            echo "  --help           Afficher cette aide"
            echo ""
            echo "Sans option: menu interactif"
            ;;
        *)
            echo "❌ Option inconnue: $1"
            echo "💡 Utilisez --help pour voir les options"
            exit 1
            ;;
    esac
    exit 0
fi

# Mode interactif (menu)
while true; do
    show_menu
    read -p "Votre choix [1-11]: " choice
    echo ""

    case $choice in
        1)
            search_by_ip
            ;;
        2)
            show_stats
            ;;
        3)
            list_ips
            ;;
        4)
            search_keyword
            ;;
        5)
            search_high
            ;;
        6)
            search_exploits
            ;;
        7)
            search_recent_cves
            ;;
        8)
            top_ips_high
            ;;
        9)
            export_results
            ;;
        10)
            purge_database
            ;;
        11)
            echo "👋 Au revoir !"
            exit 0
            ;;
        *)
            echo "❌ Choix invalide"
            ;;
    esac

    echo ""
    read -p "Appuyez sur Entrée pour continuer..."
done
