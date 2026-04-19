#!/bin/bash
set -e

# RealBench Fly.io Deployment Script
# Usage: ./scripts/fly-deploy.sh [api|worker|web|all|setup]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

APP_NAME="${1:-all}"
RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
NC="\033[0m" # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_fly_cli() {
    if ! command -v fly &> /dev/null; then
        log_error "flyctl nicht installiert. Installiere mit:"
        echo "  brew install flyctl"
        echo "  oder: curl -L https://fly.io/install.sh | sh"
        exit 1
    fi

    if ! fly auth whoami &> /dev/null; then
        log_error "Nicht bei Fly.io eingeloggt. Führe aus:"
        echo "  fly auth login"
        exit 1
    fi
}

copy_env_to_secrets() {
    local app=$1
    local env_file="${PROJECT_ROOT}/apps/api/.env"

    if [[ ! -f "$env_file" ]]; then
        log_warn ".env Datei nicht gefunden: $env_file"
        return
    fi

    log_info "Kopiere Secrets aus .env für $app..."

    # Wichtige Secrets für API und Worker
    local secrets=""
    while IFS='=' read -r key value; do
        # Überspringe Kommentare und leere Zeilen
        [[ "$key" =~ ^#.*$ ]] && continue
        [[ -z "$key" ]] && continue

        # Entferne umschließende Anführungszeichen vom Wert
        value="${value%\'}"
        value="${value#\'}"
        value="${value%\"}"
        value="${value#\"}"

        case "$key" in
            DATABASE_URL|CLERK_SECRET_KEY|CLERK_PUBLISHABLE_KEY|\
            R2_ACCOUNT_ID|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_BUCKET_NAME|\
            ANTHROPIC_API_KEY)
                secrets="${secrets}${key}=${value} "
                ;;
        esac
    done < "$env_file"

    if [[ -n "$secrets" ]]; then
        log_info "Setze Secrets für $app..."
        # Shell-safe secret setting
        fly secrets set -a "$app" $(echo "$secrets" | tr '\n' ' ') < /dev/null || true
    fi
}

setup_infrastructure() {
    log_info "=== Setup Fly.io Infrastruktur ==="

    # Postgres prüfen/erstellen
    if ! fly postgres list 2>/dev/null | grep -q "realbench-db"; then
        log_info "Erstelle Postgres 'realbench-db'..."
        fly postgres create \
            --name realbench-db \
            --region fra \
            --initial-cluster-size 1 \
            --vm-size shared-cpu-1x \
            --volume-size 10 \
            || log_warn "Postgres konnte nicht erstellt werden (existiert möglicherweise bereits)"
    else
        log_info "Postgres 'realbench-db' existiert bereits"
    fi

    # Apps erstellen
    for app in realbench-api realbench-worker realbench-web; do
        if ! fly apps list 2>/dev/null | grep -q "$app"; then
            log_info "Erstelle App '$app'..."
            fly apps create "$app" || log_warn "App $app existiert möglicherweise bereits"
        else
            log_info "App '$app' existiert bereits"
        fi
    done

    log_info "=== Infrastruktur Setup abgeschlossen ==="

    # Secrets aus .env automatisch setzen
    copy_env_to_secrets "realbench-api"
    copy_env_to_secrets "realbench-worker"

    echo ""
    log_warn "DATABASE_URL muss nach dem Erstellen der Datenbank gesetzt werden:"
    log_info "Verbindungs-String findest du mit:"
    echo "  fly postgres connect -a realbench-db --print-url"
}

run_migrations() {
    log_info "=== Running Drizzle Migrations ==="
    cd "${PROJECT_ROOT}"

    local env_file="${PROJECT_ROOT}/apps/api/.env"
    if [[ ! -f "$env_file" ]]; then
        log_warn ".env nicht gefunden – Migrations werden übersprungen"
        return
    fi

    # DATABASE_URL aus .env laden (Anführungszeichen entfernen)
    local db_url
    db_url=$(grep '^DATABASE_URL=' "$env_file" | cut -d'=' -f2- | tr -d '"\047')
    if [[ -z "$db_url" ]]; then
        log_warn "DATABASE_URL nicht in .env gefunden – Migrations werden übersprungen"
        return
    fi

    DATABASE_URL="$db_url" pnpm --filter api db:migrate || {
        log_error "Drizzle Migrations fehlgeschlagen"
        return 1
    }

    log_info "Migrations erfolgreich ausgeführt"
}

deploy_api() {
    log_info "=== Deploying RealBench API ==="
    cd "${PROJECT_ROOT}"

    run_migrations

    fly deploy -c fly.api.toml -a realbench-api || {
        log_error "API Deployment fehlgeschlagen"
        return 1
    }

    log_info "API deployed: https://realbench-api.fly.dev"
}

deploy_worker() {
    log_info "=== Deploying RealBench Worker ==="
    cd "${PROJECT_ROOT}"

    fly deploy -c fly.worker.toml -a realbench-worker || {
        log_error "Worker Deployment fehlgeschlagen"
        return 1
    }

    log_info "Worker deployed"
}

deploy_web() {
    log_info "=== Deploying RealBench Web ==="
    cd "${PROJECT_ROOT}"

    local env_file="${PROJECT_ROOT}/apps/web/.env"
    local build_args=""

    if [[ -f "$env_file" ]]; then
        while IFS='=' read -r key value; do
            [[ "$key" =~ ^#.*$ ]] && continue
            [[ -z "$key" ]] && continue
            case "$key" in
                VITE_CLERK_PUBLISHABLE_KEY|VITE_API_URL)
                    build_args="${build_args} --build-arg ${key}=${value}"
                    ;;
            esac
        done < "$env_file"
    else
        log_warn "apps/web/.env nicht gefunden, VITE_* Build-Args fehlen"
    fi

    fly deploy -c fly.web.toml -a realbench-web ${build_args} || {
        log_error "Web Deployment fehlgeschlagen"
        return 1
    }

    log_info "Web deployed: https://realbench-web.fly.dev"
}

show_status() {
    log_info "=== Deployment Status ==="
    echo ""
    echo "Apps:"
    fly apps list 2>/dev/null | grep realbench || echo "  Keine Apps gefunden"
    echo ""
    echo "Postgres:"
    fly postgres list 2>/dev/null | grep realbench || echo "  Keine Postgres gefunden"
    echo ""
    echo "Queue: pg-boss (PostgreSQL-native, kein Redis)"
}

show_help() {
    cat << EOF
RealBench Fly.io Deployment Script

Usage: $0 [COMMAND]

Commands:
  setup       - Erstellt Postgres und Apps
  api         - Deployt nur die API
  worker      - Deployt nur den Worker
  web         - Deployt nur das Web Frontend
  all         - Deployt alle Komponenten (default)
  status      - Zeigt den aktuellen Status
  help        - Zeigt diese Hilfe

Beispiele:
  $0 setup              # Erstmalige Infrastruktur-Setup
  $0 api               # Nur API deployen
  $0 all               # Alles deployen

Voraussetzungen:
  - flyctl installiert: brew install flyctl
  - Bei Fly.io eingeloggt: fly auth login
  - .env Datei in apps/api/ mit Secrets
EOF
}

# Hauptlogik
case "${APP_NAME}" in
    setup)
        check_fly_cli
        setup_infrastructure
        ;;
    api)
        check_fly_cli
        deploy_api
        ;;
    worker)
        check_fly_cli
        deploy_worker
        ;;
    web)
        check_fly_cli
        deploy_web
        ;;
    all)
        check_fly_cli
        deploy_api
        deploy_worker
        deploy_web
        ;;
    status)
        show_status
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "Unbekannter Befehl: $APP_NAME"
        show_help
        exit 1
        ;;
esac

log_info "Fertig!"
