#!/bin/bash
# Script de recherche dans les rapports Nikto (menu interactif + CLI)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
fi

DB_FILE="$DATA_DIR/logs/nikto.db"

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
    echo "   → Liste simple ou détaillée"
    echo ""
    echo "4. 🔎 Recherche par mot-clé"
    echo "   → Cherche dans toutes les vulnérabilités/fichiers"
    echo "   → Exemple: \"backup\", \"admin\", \"Apache 2.4\""
    echo ""
    echo "5. 📤 Exporter les résultats"
    echo "   → CSV, JSON, ou affichage formaté"
    echo ""
    echo "6. 🗑️  Purger la base de données"
    echo "   → Supprimer toutes les données (vulns + parsed_files)"
    echo ""
    echo "7. ❌ Quitter"
    echo ""
}

# Fonction pour rechercher par IP
search_by_ip() {
    echo ""
    read -p "🔍 Entrez l'IP (ou partie d'IP): " search_ip
    if [ -z "$search_ip" ]; then
        echo "❌ IP vide"
        return
    fi
    
    echo ""
    echo "📋 Résultats pour IP contenant: $search_ip"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    sqlite3 -header -column "$DB_FILE" << SQL
SELECT DISTINCT ip, port, COUNT(*) as vulns_count 
FROM vulns 
WHERE ip LIKE '%$search_ip%' 
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
            echo ""
            echo "📋 Détails des vulnérabilités pour: $detail_ip"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            sqlite3 -header -column "$DB_FILE" << SQL
SELECT port, vulnerability, severity, file_path 
FROM vulns 
WHERE ip = '$detail_ip' 
ORDER BY port, severity DESC;
SQL
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
    
    echo "📈 Totaux:"
    echo "   • Total vulnérabilités/trouvailles: $total"
    echo "   • IPs uniques: $unique_ips"
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
ORDER BY total DESC, HIGH DESC;
SQL
}

# Fonction pour rechercher par mot-clé
search_keyword() {
    echo ""
    read -p "🔍 Entrez le mot-clé à rechercher: " keyword
    if [ -z "$keyword" ]; then
        echo "❌ Mot-clé vide"
        return
    fi
    
    echo ""
    echo "📋 Résultats pour: $keyword"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    sqlite3 -header -column "$DB_FILE" << SQL
SELECT ip, port, vulnerability, file_path 
FROM vulns 
WHERE vulnerability LIKE '%$keyword%' 
   OR file_path LIKE '%$keyword%' 
   OR server_version LIKE '%$keyword%'
ORDER BY ip, port 
LIMIT 100;
SQL
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
            sqlite3 -header -column "$DB_FILE" "SELECT DISTINCT ip, port, COUNT(*) as vulns_count FROM vulns WHERE ip LIKE '%$search_ip%' GROUP BY ip, port ORDER BY vulns_count DESC LIMIT 50;"
            ;;
        --keyword)
            keyword="$2"
            sqlite3 -header -column "$DB_FILE" "SELECT ip, port, vulnerability, file_path FROM vulns WHERE vulnerability LIKE '%$keyword%' OR file_path LIKE '%$keyword%' ORDER BY ip, port LIMIT 100;"
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
    read -p "Votre choix [1-7]: " choice
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
            export_results
            ;;
        6)
            purge_database
            ;;
        7)
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
