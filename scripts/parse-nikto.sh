#!/bin/bash
# Script pour parser les rapports Nikto et les stocker dans SQLite

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/config"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    DATA_DIR="$SCRIPT_DIR/../data"
fi

DB_FILE="$DATA_DIR/logs/nikto.db"
SCREENSHOTS_DIR="$DATA_DIR/screenshots"

# Créer la base de données et la table si nécessaire
sqlite3 "$DB_FILE" << 'SQL'
CREATE TABLE IF NOT EXISTS vulns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    port INTEGER NOT NULL,
    report_file TEXT NOT NULL,
    vulnerability TEXT NOT NULL,
    severity TEXT,
    file_path TEXT,
    server_version TEXT,
    cve TEXT,
    scan_date TEXT,
    full_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parsed_files (
    report_file TEXT PRIMARY KEY,
    file_mtime TEXT NOT NULL,
    parsed_date TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ip ON vulns(ip);
CREATE INDEX IF NOT EXISTS idx_port ON vulns(port);
CREATE INDEX IF NOT EXISTS idx_vulnerability ON vulns(vulnerability);
CREATE INDEX IF NOT EXISTS idx_file_path ON vulns(file_path);
SQL

echo "🔍 Parsing des rapports Nikto..."
echo "📂 Base de données: $DB_FILE"
echo ""

total=$(find "$SCREENSHOTS_DIR" -name "*_nikto.txt" -type f | wc -l)
if [ "$total" -eq 0 ]; then
    echo "⚠️  Aucun rapport Nikto trouvé"
    exit 0
fi

count=0
skipped=0
parsed=0

# Créer un fichier temporaire avec la liste des fichiers
temp_file_list=$(mktemp)
find "$SCREENSHOTS_DIR" -name "*_nikto.txt" -type f > "$temp_file_list"

# Lire depuis le fichier au lieu d'un pipe pour éviter la sous-shell
while IFS= read -r report_file; do
    count=$((count + 1))
    
    # Obtenir la date de modification du fichier
    file_mtime=$(stat -c %Y "$report_file" 2>/dev/null || echo "0")
    file_mtime_readable=$(date -r "$report_file" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date '+%Y-%m-%d %H:%M:%S')
    
    # Échapper le chemin pour SQL
    report_file_escaped=$(echo "$report_file" | sed "s/'/''/g")
    
    # Vérifier si le fichier a déjà été parsé avec la même date de modification
    existing_mtime=$(sqlite3 "$DB_FILE" "SELECT file_mtime FROM parsed_files WHERE report_file = '$report_file_escaped';" 2>/dev/null)
    
    if [ -n "$existing_mtime" ] && [ "$existing_mtime" = "$file_mtime" ]; then
        # Fichier déjà parsé et pas modifié, skip
        skipped=$((skipped + 1))
        continue
    fi
    
    # Supprimer les anciennes entrées pour ce fichier si elles existent
    sqlite3 "$DB_FILE" "DELETE FROM vulns WHERE report_file = '$report_file_escaped';" 2>/dev/null
    
    # Extraire IP et port depuis le chemin du fichier
    filename=$(basename "$report_file")
    dir_path=$(dirname "$report_file")
    ip=$(basename "$dir_path")
    
    # Extraire port depuis le nom de fichier (ex: 101.200.75.167_443_nikto.txt)
    port=$(echo "$filename" | sed -n 's/.*_\([0-9]*\)_nikto\.txt/\1/p')
    
    # Lire le fichier et extraire les vulnérabilités
    while IFS= read -r line; do
        # Extraire Target Host et Target Port pour mettre à jour ip/port si nécessaire
        if [[ $line =~ Target\ Host:\ (.+) ]]; then
            ip="${BASH_REMATCH[1]}"
        fi
        if [[ $line =~ Target\ Port:\ (.+) ]]; then
            port="${BASH_REMATCH[1]}"
        fi
        
        # Ignorer les lignes Target Host/Port (ce sont des métadonnées, pas des vulnérabilités)
        if [[ $line =~ Target\ Host: ]] || [[ $line =~ Target\ Port: ]]; then
            continue
        fi
        
        # Parser uniquement les lignes de vulnérabilité (commencent par "+")
        if [[ $line =~ ^\+ ]]; then
            # Nettoyer la ligne (enlever le "+")
            vuln_text=$(echo "$line" | sed 's/^+ //')
            
            # Extraire le chemin de fichier si présent (ex: GET /robots.txt:)
            file_path=""
            if [[ $vuln_text =~ GET\ ([^:]+): ]]; then
                file_path="${BASH_REMATCH[1]}"
            fi
            
            # Détecter si c'est un CVE
            cve=""
            if [[ $vuln_text =~ (CVE-[0-9]{4}-[0-9]+) ]]; then
                cve="${BASH_REMATCH[1]}"
            fi
            
            # Détecter la sévérité basique
            severity="LOW"
            if echo "$vuln_text" | grep -qiE "critical|high|dangerous|exploit"; then
                severity="HIGH"
            elif echo "$vuln_text" | grep -qiE "warning|medium|vulnerable"; then
                severity="MEDIUM"
            fi
            
            # Extraire version serveur si présente
            server_version=""
            if [[ $vuln_text =~ (Apache|nginx|IIS|Server)[\ /]+([0-9\.]+) ]]; then
                server_version="${BASH_REMATCH[0]}"
            fi
            
            # Échapper les apostrophes pour SQL
            vuln_text_escaped=$(echo "$vuln_text" | sed "s/'/''/g")
            line_escaped=$(echo "$line" | sed "s/'/''/g")
            ip_escaped=$(echo "$ip" | sed "s/'/''/g")
            
            # Insérer dans SQLite
            sqlite3 "$DB_FILE" << SQL
INSERT INTO vulns (ip, port, report_file, vulnerability, severity, file_path, server_version, cve, scan_date, full_text)
VALUES ('$ip_escaped', $port, '$report_file_escaped', '$vuln_text_escaped', '$severity', '$file_path', '$server_version', '$cve', '$file_mtime_readable', '$line_escaped');
SQL
        fi
    done < "$report_file"
    
    # Marquer le fichier comme parsé
    parsed_date=$(date '+%Y-%m-%d %H:%M:%S')
    sqlite3 "$DB_FILE" << SQL
INSERT OR REPLACE INTO parsed_files (report_file, file_mtime, parsed_date)
VALUES ('$report_file_escaped', '$file_mtime', '$parsed_date');
SQL
    
    parsed=$((parsed + 1))
    
    if [ $((count % 50)) -eq 0 ]; then
        echo "  [$count/$total] Fichiers traités (parsés: $parsed, ignorés: $skipped)..."
    fi
done < "$temp_file_list"

rm -f "$temp_file_list"

total_vulns=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM vulns;" 2>/dev/null || echo "0")
echo ""
echo "✅ Parsing terminé !"
echo "📊 Total vulnérabilités/trouvailles: $total_vulns"
echo "📝 Fichiers parsés: $parsed"
echo "⏭️  Fichiers ignorés (déjà parsés): $skipped"
