#!/bin/bash
# Parse les rapports vuln nmap (*_nmap.txt, section vulners) → SQLite nikto.db
# Sévérités : CVSS entier ≥9 → HIGH, ≥7 → MEDIUM, sinon LOW (aligné avec generate-data.sh → vuln_high)
# Perf : une transaction SQLite par fichier (batch INSERT), moins d’appels sqlite3.

# Variable pour le nettoyage
temp_file_list=""
insert_batch_file=""

# Nettoyage des fichiers temporaires en cas d'interruption
cleanup_temp_files() {
    if [ -n "$temp_file_list" ] && [ -f "$temp_file_list" ]; then
        rm -f "$temp_file_list" 2>/dev/null
    fi
    if [ -n "$insert_batch_file" ] && [ -f "$insert_batch_file" ]; then
        rm -f "$insert_batch_file" 2>/dev/null
    fi
}

trap cleanup_temp_files EXIT INT TERM

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

# Même répertoire données que generate-data.sh quand appelé depuis le pipeline (évite DB ≠ fichiers scannés)
if [ -n "${HONEYPOT_DATA_DIR:-}" ]; then
    DATA_DIR="$HONEYPOT_DATA_DIR"
fi

mkdir -p "$DATA_DIR/logs"

DB_FILE="$DATA_DIR/logs/nikto.db"
SCREENSHOTS_DIR="$DATA_DIR/screenshotAndLog"

# Échappement SQL (doubler les ')
escape_sql() {
    printf '%s' "$1" | sed "s/'/''/g"
}

# À partir d'une ligne vulners (|  CVE…  9.8 …), écrit une instruction INSERT sur stdout
append_insert_for_vuln_line() {
    local vuln_line="$1"
    local current_port="$2"
    local ip="$3"
    local report_file_escaped="$4"
    local file_mtime_readable="$5"
    local current_service="$6"
    local current_version="$7"

    local vuln_line_trim
    vuln_line_trim=$(echo "$vuln_line" | sed 's/^|[[:space:]]*//')
    local vuln_text severity_score
    vuln_text=$(echo "$vuln_line_trim" | awk '{print $1}')
    severity_score=$(echo "$vuln_line_trim" | awk '{print $2}')

    if [ -z "$vuln_text" ]; then
        return 0
    fi

    local severity="LOW"
    if [ -n "$severity_score" ]; then
        local score
        score=$(echo "$severity_score" | cut -d'.' -f1 | grep -oE "^[0-9]+" | head -1)
        if [ -n "$score" ] && [ "$score" -ge 9 ]; then
            severity="HIGH"
        elif [ -n "$score" ] && [ "$score" -ge 7 ]; then
            severity="MEDIUM"
        fi
    fi

    local cve=""
    if [[ $vuln_text =~ CVE-[0-9]{4}-[0-9]+ ]]; then
        cve="$vuln_text"
    fi

    local ip_e vt_e line_e sv_e cve_e
    ip_e=$(escape_sql "$ip")
    vt_e=$(escape_sql "$vuln_text")
    line_e=$(escape_sql "$vuln_line")
    sv_e=$(escape_sql "$current_service $current_version")
    cve_e=$(escape_sql "$cve")

    printf "INSERT INTO vulns (ip, port, report_file, vulnerability, severity, file_path, server_version, cve, scan_date, full_text) VALUES ('%s', %s, '%s', '%s', '%s', '', '%s', '%s', '%s', '%s');\n" \
        "$ip_e" "$current_port" "$report_file_escaped" "$vt_e" "$severity" "$sv_e" "$cve_e" "$file_mtime_readable" "$line_e"
}

# Vide le tableau vuln_lines vers le fichier batch
flush_vuln_lines_to_batch() {
    local vuln_line
    for vuln_line in "${vuln_lines[@]}"; do
        append_insert_for_vuln_line "$vuln_line" "$current_port" "$ip" "$report_file_escaped" "$file_mtime_readable" "$current_service" "$current_version" >> "$insert_batch_file"
    done
}

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

    insert_batch_file=$(mktemp)
    : > "$insert_batch_file"

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
                    flush_vuln_lines_to_batch
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
        flush_vuln_lines_to_batch
    fi

    parsed_date=$(date '+%Y-%m-%d %H:%M:%S')
    parsed_date_escaped=$(escape_sql "$parsed_date")

    # Une transaction par fichier : DELETE + INSERTs + parsed_files
    {
        echo "BEGIN IMMEDIATE;"
        echo "DELETE FROM vulns WHERE report_file = '$report_file_escaped';"
        if [ -s "$insert_batch_file" ]; then
            cat "$insert_batch_file"
        fi
        echo "INSERT OR REPLACE INTO parsed_files (report_file, file_mtime, parsed_date) VALUES ('$report_file_escaped', '$file_mtime', '$parsed_date_escaped');"
        echo "COMMIT;"
    } | sqlite3 "$DB_FILE" || {
        echo "❌ Erreur SQLite pour: $report_file" >&2
        rm -f "$insert_batch_file"
        insert_batch_file=""
        continue
    }

    rm -f "$insert_batch_file"
    insert_batch_file=""

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
