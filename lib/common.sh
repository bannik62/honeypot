#!/bin/bash
# ╔═══════════════════════════════════════════════════════════════╗
# ║         Bibliothèque commune - Honeypot Monitor               ║
# ║         Fonctions partagées par tous les scripts              ║
# ╚═══════════════════════════════════════════════════════════════╝

# Déterminer le répertoire du script appelant
get_script_dir() {
    local script_path="${BASH_SOURCE[1]}"
    if [ -z "$script_path" ]; then
        script_path="${BASH_SOURCE[0]}"
    fi
    cd "$(dirname "$script_path")" && pwd
}

# Charger la configuration de manière standardisée
load_config() {
    local script_dir="${1:-$(get_script_dir)}"
    local config_file="${script_dir}/../config/config"
    
    # Valeurs par défaut
    export DATA_DIR="${script_dir}/../data"
    export SERVICE_NAME="endlessh"
    export REFRESH_INTERVAL=5
    export ENABLE_NOTIFICATIONS=false
    export SCAN_PORTS="80,443,8080,8443,8000,8888,3000,5000,9000"
    export NMAP_PARALLEL=10
    export CAPTURE_PARALLEL=5
    export DIG_PARALLEL=10
    export NIKTO_PARALLEL=10
    export NIKTO_TIMEOUT=600
    export NIKTO_TUNING="1,2,3,5,6,7,8"
    export AUTO_SCAN_ENABLED=false
    export AUTO_SCAN_HOUR=1
    export NMAP_MAX_RTT_TIMEOUT="500ms"
    export NMAP_HOST_TIMEOUT="600s"
    
    # Charger la config si elle existe
    if [ -f "$config_file" ]; then
        source "$config_file"
    fi
    
    # Valider les valeurs critiques
    validate_config_values
    
    return 0
}

# Valider les valeurs de configuration
validate_config_values() {
    # Valider les valeurs numériques
    if [ -n "${NMAP_PARALLEL:-}" ] && ! [[ "${NMAP_PARALLEL}" =~ ^[0-9]+$ ]] || [ "${NMAP_PARALLEL:-0}" -lt 1 ]; then
        log_warn "NMAP_PARALLEL invalide (${NMAP_PARALLEL:-}), utilisation de 10 par défaut"
        export NMAP_PARALLEL=10
    fi
    
    if [ -n "${CAPTURE_PARALLEL:-}" ] && ! [[ "${CAPTURE_PARALLEL}" =~ ^[0-9]+$ ]] || [ "${CAPTURE_PARALLEL:-0}" -lt 1 ]; then
        log_warn "CAPTURE_PARALLEL invalide (${CAPTURE_PARALLEL:-}), utilisation de 5 par défaut"
        export CAPTURE_PARALLEL=5
    fi
    
    if [ -n "${DIG_PARALLEL:-}" ] && ! [[ "${DIG_PARALLEL}" =~ ^[0-9]+$ ]] || [ "${DIG_PARALLEL:-0}" -lt 1 ]; then
        log_warn "DIG_PARALLEL invalide (${DIG_PARALLEL:-}), utilisation de 10 par défaut"
        export DIG_PARALLEL=10
    fi
    
    if [ -n "${REFRESH_INTERVAL:-}" ] && ! [[ "${REFRESH_INTERVAL}" =~ ^[0-9]+$ ]] || [ "${REFRESH_INTERVAL:-0}" -lt 1 ]; then
        log_warn "REFRESH_INTERVAL invalide (${REFRESH_INTERVAL:-}), utilisation de 5 par défaut"
        export REFRESH_INTERVAL=5
    fi
    
    # Valider DATA_DIR
    if [ -z "${DATA_DIR:-}" ]; then
        log_error "DATA_DIR non défini"
        return 1
    fi
    
    return 0
}

# Initialiser le système de logging
init_logging() {
    local script_name="${1:-$(basename "${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}")}"
    local log_dir="${DATA_DIR:-$(get_script_dir)/../data}/logs"
    
    mkdir -p "$log_dir"
    export LOG_FILE="${log_dir}/${script_name%.sh}.log"
    export LOG_LEVEL="${LOG_LEVEL:-INFO}"
    
    return 0
}

# Fonction de logging unifié
log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local log_entry="[${timestamp}] [${level}] ${message}"
    
    # Toujours afficher sur stdout/stderr selon le niveau
    case "$level" in
        ERROR)
            echo "$log_entry" >&2
            ;;
        WARN)
            echo "$log_entry" >&2
            ;;
        *)
            echo "$log_entry"
            ;;
    esac
    
    # Écrire dans le fichier de log si défini
    if [ -n "${LOG_FILE:-}" ]; then
        echo "$log_entry" >> "$LOG_FILE"
    fi
}

# Fonctions de logging par niveau
log_info() {
    log "INFO" "$@"
}

log_error() {
    log "ERROR" "$@"
}

log_warn() {
    log "WARN" "$@"
}

log_debug() {
    if [ "${LOG_LEVEL:-INFO}" = "DEBUG" ]; then
        log "DEBUG" "$@"
    fi
}

# Fonction pour quitter avec message d'erreur
die() {
    local exit_code="${2:-1}"
    log_error "$1"
    exit "$exit_code"
}

# Vérifier qu'une commande existe
check_command() {
    local cmd="$1"
    local package="${2:-$cmd}"
    
    if ! command -v "$cmd" &> /dev/null; then
        log_error "$cmd n'est pas installé"
        log_info "Installez-le avec: sudo apt install $package"
        return 1
    fi
    return 0
}

# Vérifier plusieurs commandes
check_commands() {
    local failed=0
    while [ $# -gt 0 ]; do
        local cmd="$1"
        local package="${2:-$cmd}"
        shift 2
        
        if ! check_command "$cmd" "$package"; then
            failed=1
        fi
    done
    
    return $failed
}

# Créer un répertoire de manière sécurisée
safe_mkdir() {
    local dir="$1"
    local owner="${2:-}"
    
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir" || die "Impossible de créer le répertoire: $dir"
    fi
    
    if [ -n "$owner" ]; then
        chown "$owner:$owner" "$dir" 2>/dev/null || true
    fi
}

# Créer un fichier de manière sécurisée
safe_create_file() {
    local file="$1"
    local content="${2:-}"
    local owner="${3:-}"
    
    local dir=$(dirname "$file")
    safe_mkdir "$dir" "$owner"
    
    if [ -n "$content" ]; then
        echo "$content" > "$file" || die "Impossible de créer le fichier: $file"
    else
        touch "$file" || die "Impossible de créer le fichier: $file"
    fi
    
    if [ -n "$owner" ]; then
        chown "$owner:$owner" "$file" 2>/dev/null || true
    fi
}

# Calculer un pourcentage avec arrondi
calculate_percentage() {
    local count="$1"
    local total="$2"
    
    if [ "$total" -eq 0 ]; then
        echo "0%"
        return
    fi
    
    # Calcul en dixièmes de pourcent : (count * 1000) / total
    local percentage_tenths=$((count * 1000 / total))
    # Arrondir : si le reste >= 50% du total, ajouter 1
    local remainder=$((count * 1000 % total))
    if [ "$remainder" -ge $((total / 2)) ]; then
        percentage_tenths=$((percentage_tenths + 1))
    fi
    # Convertir en pourcentage entier
    local percentage=$((percentage_tenths / 10))
    # Si 0 mais qu'il y a des connexions, afficher <1%
    if [ "$percentage" -eq 0 ] && [ "$count" -gt 0 ]; then
        echo "<1%"
    else
        echo "${percentage}%"
    fi
}

# Nettoyer les fichiers temporaires de manière sécurisée
cleanup_temp_file() {
    local file="$1"
    if [ -n "$file" ] && [ -f "$file" ]; then
        rm -f "$file" 2>/dev/null || true
    fi
}

# Échapper une chaîne pour SQL (prévention injection SQL)
escape_sql() {
    local input="$1"
    # Échapper les guillemets simples en les doublant
    echo "$input" | sed "s/'/''/g"
}

# Valider une IP ou partie d'IP
validate_ip_input() {
    local input="$1"
    # Autoriser seulement des caractères alphanumériques, points, deux-points et tirets
    if [[ "$input" =~ ^[0-9a-fA-F.:-]+$ ]]; then
        return 0
    else
        return 1
    fi
}

# Valider un mot-clé (pas de caractères SQL dangereux)
validate_keyword() {
    local input="$1"
    # Autoriser seulement des caractères alphanumériques, espaces, tirets, underscores, points
    if [[ "$input" =~ ^[0-9a-zA-Z\s._-]+$ ]]; then
        return 0
    else
        return 1
    fi
}

# Obtenir le chemin absolu d'un fichier
get_absolute_path() {
    local path="$1"
    if [ -d "$path" ]; then
        cd "$path" && pwd
    else
        local dir=$(dirname "$path")
        local file=$(basename "$path")
        cd "$dir" && echo "$(pwd)/$file"
    fi
}

# Rotation de fichier si trop gros (en MB)
rotate_file_if_needed() {
    local file="$1"
    local max_size_mb="${2:-100}"  # 100MB par défaut
    local max_size_bytes=$((max_size_mb * 1024 * 1024))
    
    if [ ! -f "$file" ]; then
        return 0
    fi
    
    local file_size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo 0)
    
    if [ "$file_size" -gt "$max_size_bytes" ]; then
        local backup_file="${file}.$(date +%Y%m%d_%H%M%S).bak"
        log_info "Rotation du fichier $file (${file_size} bytes > ${max_size_bytes} bytes)"
        mv "$file" "$backup_file" || return 1
        
        # Compresser l'ancien fichier en arrière-plan
        (gzip "$backup_file" 2>/dev/null && log_debug "Fichier compressé: ${backup_file}.gz") &
        
        return 0
    fi
    
    return 0
}

# Nettoyer les anciens fichiers de backup (garder les N derniers)
cleanup_old_backups() {
    local pattern="$1"
    local keep="${2:-5}"  # Garder les 5 derniers par défaut
    
    find "$(dirname "$pattern")" -name "$(basename "$pattern")*.bak*" -type f -printf '%T@ %p\n' 2>/dev/null | \
        sort -rn | tail -n +$((keep + 1)) | cut -d' ' -f2- | while read -r file; do
            log_debug "Suppression de l'ancien backup: $file"
            rm -f "$file" 2>/dev/null
        done
}

