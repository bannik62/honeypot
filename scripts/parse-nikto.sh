#!/bin/bash
# Script pour parser les rapports nmap et les stocker dans SQLite

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

echo "🔍 Parsing des rapports nmap..."
echo "📂 Base de données: $DB_FILE"
echo ""

total=$(find "$SCREENSHOTS_DIR" -name "*_nmap.txt" -type f | wc -l)
if [ "$total" -eq 0 ]; then
    echo "⚠️  Aucun rapport nmap trouvé"
    exit 0
fi

count=0
skipped=0
parsed=0

temp_file_list=$(mktemp)
find "$SCREENSHOTS_DIR" -name "*_nmap.txt" -type f > "$temp_file_list"

while IFS= read -r report_file; do
    count=$((count + 1))

    file_mtime=$(stat -c %Y "$report_file" 2>/dev/null || echo "0")
    file_mtime_readable=$(date -r "$report_file" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date '+%Y-%m-%d %H:%M:%S')
    report_file_escaped=$(echo "$report_file" | sed "s/'/''/g")

    existing_mtime=$(sqlite3 "$DB_FILE" "SELECT file_mtime FROM parsed_files WHERE report_file = '$report_file_escaped';" 2>/dev/null)

    if [ -n "$existing_mtime" ] && [ "$existing_mtime" = "$file_mtime" ]; then
        skipped=$((skipped + 1))
        continue
    fi

    sqlite3 "$DB_FILE" "DELETE FROM vulns WHERE report_file = '$report_file_escaped';" 2>/dev/null

    filename=$(basename "$report_file")
    dir_path=$(dirname "$report_file")
    ip=$(basename "$dir_path")

    report_ip=$(grep "Nmap scan report for" "$report_file" | head -1 | sed -n 's/.*Nmap scan report for \([0-9.]*\).*/\1/p')
    if [ -n "$report_ip" ]; then
        ip="$report_ip"
    fi

    current_port=""
    current_service=""
    current_version=""
    in_vulners_section=0
    vuln_lines=()

    while IFS= read -r line; do
        if [[ $line =~ ^([0-9]+)/tcp[[:space:]]+open[[:space:]]+([^[:space:]]+)[[:space:]]*(.*)$ ]]; then
            current_port="${BASH_REMATCH[1]}"
            current_service="${BASH_REMATCH[2]}"
            current_version="${BASH_REMATCH[3]}"
            in_vulners_section=0
            vuln_lines=()
            continue
        fi

        if [[ $line =~ ^\|[[:space:]]+vulners: ]]; then
            in_vulners_section=1
            continue
        fi

        if [ "$in_vulners_section" -eq 1 ] && [ -n "$current_port" ]; then
            if [[ $line =~ ^\|[[:space:]]+cpe: ]] || [[ $line =~ ^[[:space:]]*$ ]]; then
                continue
            fi

            if [[ $line =~ ^[0-9]+/tcp ]] || [[ ! $line =~ ^\| ]]; then
                if [ ${#vuln_lines[@]} -gt 0 ]; then
                    for vuln_line in "${vuln_lines[@]}"; do
                        vuln_text=$(echo "$vuln_line" | sed 's/^|[[:space:]]*//' | awk '{print $1}')
                        severity_score=$(echo "$vuln_line" | sed 's/^|[[:space:]]*//' | awk '{print $2}')
                        vuln_url=$(echo "$vuln_line" | sed 's/^|[[:space:]]*//' | awk '{print $3}')

                        if [ -z "$vuln_text" ]; then
                            continue
                        fi

                        severity="LOW"
                        if [ -n "$severity_score" ]; then
                            score=$(echo "$severity_score" | cut -d'.' -f1 | grep -oE "^[0-9]+" | head -1)
                            if [ -n "$score" ] && [ "$score" -ge 9 ]; then
                                severity="HIGH"
                            elif [ -n "$score" ] && [ "$score" -ge 7 ]; then
                                severity="MEDIUM"
                            fi
                        fi

                        cve=""
                        if [[ $vuln_text =~ CVE-[0-9]{4}-[0-9]+ ]]; then
                            cve="$vuln_text"
                        fi

                        vuln_text_escaped=$(echo "$vuln_text" | sed "s/'/''/g")
                        line_escaped=$(echo "$vuln_line" | sed "s/'/''/g")
                        ip_escaped=$(echo "$ip" | sed "s/'/''/g")
                        service_escaped=$(echo "$current_service" | sed "s/'/''/g")
                        version_escaped=$(echo "$current_version" | sed "s/'/''/g")

                        sqlite3 "$DB_FILE" << SQL
INSERT INTO vulns (ip, port, report_file, vulnerability, severity, file_path, server_version, cve, scan_date, full_text)
VALUES ('$ip_escaped', $current_port, '$report_file_escaped', '$vuln_text_escaped', '$severity', '', '$service_escaped $version_escaped', '$cve', '$file_mtime_readable', '$line_escaped');
SQL
                    done
                fi

                if [[ $line =~ ^([0-9]+)/tcp[[:space:]]+open ]]; then
                    current_port="${BASH_REMATCH[1]}"
                    current_service=$(echo "$line" | awk '{print $3}')
                    current_version=$(echo "$line" | awk '{for(i=4;i<=NF;i++) printf "%s ", $i; print ""}' | sed 's/[[:space:]]*$//')
                else
                    current_port=""
                    current_service=""
                    current_version=""
                fi
                in_vulners_section=0
                vuln_lines=()
                continue
            fi

            if [[ $line =~ ^\|[[:space:]]+ ]]; then
                vuln_lines+=("$line")
            fi
        fi
    done < "$report_file"

    if [ "$in_vulners_section" -eq 1 ] && [ -n "$current_port" ] && [ ${#vuln_lines[@]} -gt 0 ]; then
        for vuln_line in "${vuln_lines[@]}"; do
            vuln_text=$(echo "$vuln_line" | sed 's/^|[[:space:]]*//' | awk '{print $1}')
            severity_score=$(echo "$vuln_line" | sed 's/^|[[:space:]]*//' | awk '{print $2}')

            if [ -z "$vuln_text" ]; then
                continue
            fi

            severity="LOW"
            if [ -n "$severity_score" ]; then
                score=$(echo "$severity_score" | cut -d'.' -f1 | grep -oE "^[0-9]+" | head -1)
                if [ -n "$score" ] && [ "$score" -ge 9 ]; then
                    severity="HIGH"
                elif [ -n "$score" ] && [ "$score" -ge 7 ]; then
                    severity="MEDIUM"
                fi
            fi

            cve=""
            if [[ $vuln_text =~ CVE-[0-9]{4}-[0-9]+ ]]; then
                cve="$vuln_text"
            fi

            vuln_text_escaped=$(echo "$vuln_text" | sed "s/'/''/g")
            line_escaped=$(echo "$vuln_line" | sed "s/'/''/g")
            ip_escaped=$(echo "$ip" | sed "s/'/''/g")
            service_escaped=$(echo "$current_service" | sed "s/'/''/g")
            version_escaped=$(echo "$current_version" | sed "s/'/''/g")

            sqlite3 "$DB_FILE" << SQL
INSERT INTO vulns (ip, port, report_file, vulnerability, severity, file_path, server_version, cve, scan_date, full_text)
VALUES ('$ip_escaped', $current_port, '$report_file_escaped', '$vuln_text_escaped', '$severity', '', '$service_escaped $version_escaped', '$cve', '$file_mtime_readable', '$line_escaped');
SQL
        done
    fi

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
