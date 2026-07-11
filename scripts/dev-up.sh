#!/usr/bin/env bash
set -euo pipefail

skip_install=false
wait_timeout_sec=120

usage() {
  cat <<'EOF'
Usage: ./scripts/dev-up.sh [--skip-install] [--wait-timeout-sec N]
EOF
}

log_step() {
  printf '[dev-up] %s\n' "$1"
}

die() {
  printf '[dev-up] %s\n' "$1" >&2
  exit 1
}

is_integer() {
  case "${1:-}" in
    ''|*[!0-9]*)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "Required command not found: $1"
  fi
}

get_listener_pid() {
  local port="$1"
  local pid
  pid="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 | tr -d '[:space:]' || true)"
  if [ -n "$pid" ]; then
    printf '%s\n' "$pid"
  fi
}

wait_port_open() {
  local port="$1"
  local timeout_sec="$2"
  local timeout_ms=$((timeout_sec * 1000))
  local waited_ms=0
  local interval_ms=300
  local pid

  while [ "$waited_ms" -lt "$timeout_ms" ]; do
    pid="$(get_listener_pid "$port")"
    if [ -n "$pid" ]; then
      printf '%s\n' "$pid"
      return 0
    fi
    sleep 0.3
    waited_ms=$((waited_ms + interval_ms))
  done

  return 1
}

wait_http_ready() {
  local url="$1"
  local timeout_sec="$2"
  local timeout_ms=$((timeout_sec * 1000))
  local waited_ms=0
  local interval_ms=300

  while [ "$waited_ms" -lt "$timeout_ms" ]; do
    if curl -fs --max-time 2 -o /dev/null "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.3
    waited_ms=$((waited_ms + interval_ms))
  done

  return 1
}

wait_service_ready() {
  local port="$1"
  local url="$2"
  local timeout_sec="$3"
  local pid

  if ! pid="$(wait_port_open "$port" "$timeout_sec")"; then
    return 1
  fi

  if ! wait_http_ready "$url" "$timeout_sec"; then
    return 1
  fi

  sleep 1
  pid="$(get_listener_pid "$port")"
  if [ -z "$pid" ]; then
    return 1
  fi

  printf '%s\n' "$pid"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-install)
      skip_install=true
      shift
      ;;
    --wait-timeout-sec)
      if [ "$#" -lt 2 ]; then
        usage
        die "Missing value for --wait-timeout-sec"
      fi
      if ! is_integer "$2"; then
        usage
        die "Invalid wait timeout: $2"
      fi
      wait_timeout_sec="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      die "Unknown argument: $1"
      ;;
  esac
done

require_cmd lsof
require_cmd go
require_cmd bun
require_cmd node
require_cmd curl

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
# shellcheck source=lib/load-env.sh
source "$script_dir/lib/load-env.sh"

# Load local env files under scripts/ (shell-exported vars win).
# Optional: scripts/.env.local overrides scripts/.env.
env_file="$script_dir/.env"
env_local_file="$script_dir/.env.local"
if [ -f "$env_file" ]; then
  log_step "Loading $env_file"
  load_dotenv "$env_file"
else
  log_step "No scripts/.env found (optional). Copy scripts/.env.example → scripts/.env for local secrets."
fi
if [ -f "$env_local_file" ]; then
  log_step "Loading $env_local_file"
  load_dotenv "$env_local_file"
fi

frontend_dir="$repo_root/frontend"
tmp_dir="$repo_root/tmp"
backend_port=9307
frontend_port=3300
backend_url="http://127.0.0.1:$backend_port/"
frontend_url="http://127.0.0.1:$frontend_port/"
default_cors_allowed_origins="http://localhost:$frontend_port,http://127.0.0.1:$frontend_port"
backend_cors_allowed_origins="${CORS_ALLOWED_ORIGINS:-$default_cors_allowed_origins}"
export CORS_ALLOWED_ORIGINS="$backend_cors_allowed_origins"

if [ ! -d "$frontend_dir" ]; then
  die "frontend directory not found: $frontend_dir"
fi

mkdir -p "$tmp_dir"

backend_out="$tmp_dir/backend.out.log"
backend_err="$tmp_dir/backend.err.log"
frontend_out="$tmp_dir/frontend.out.log"
frontend_err="$tmp_dir/frontend.err.log"

backend_pid_file="$tmp_dir/backend.pid"
frontend_pid_file="$tmp_dir/frontend.pid"

backend_pid="$(get_listener_pid "$backend_port")"
if [ -n "$backend_pid" ]; then
  if ! wait_http_ready "$backend_url" "$wait_timeout_sec"; then
    die "Backend is listening on :$backend_port (PID=$backend_pid) but did not respond at $backend_url."
  fi
  log_step "Backend already listening on :$backend_port (PID=$backend_pid)."
  log_step "Existing backend environment is unchanged; run ./scripts/dev-restart.sh to reload .env / CORS."
else
  log_step "Starting backend on :$backend_port ..."
  log_step "Backend CORS allowed origins: $backend_cors_allowed_origins"
  if [ -n "${SONARR_URL:-}" ] && [ -n "${SONARR_API_KEY:-}" ]; then
    log_step "Sonarr: enabled (${SONARR_URL})"
  else
    log_step "Sonarr: not configured (set SONARR_URL + SONARR_API_KEY in scripts/.env)"
  fi
  rm -f "$backend_out" "$backend_err"

  pushd "$repo_root" >/dev/null
  # Inherit full environment (including vars from .env).
  nohup go run ./backend/cmd/server >"$backend_out" 2>"$backend_err" < /dev/null &
  backend_launcher_pid=$!
  disown "$backend_launcher_pid" 2>/dev/null || true
  popd >/dev/null

  if ! backend_pid="$(wait_service_ready "$backend_port" "$backend_url" "$wait_timeout_sec")"; then
    die "Backend failed to respond at $backend_url within $wait_timeout_sec seconds. See $backend_err"
  fi
  log_step "Backend is up (PID=$backend_pid)."
fi

node_modules_dir="$frontend_dir/node_modules"
if [ "$skip_install" = "false" ] && [ ! -d "$node_modules_dir" ]; then
  log_step "frontend/node_modules not found. Installing dependencies ..."
  (
    cd "$frontend_dir" || exit 1
    bun install --frozen-lockfile
  )
fi

frontend_pid="$(get_listener_pid "$frontend_port")"
if [ -n "$frontend_pid" ]; then
  if ! wait_http_ready "$frontend_url" "$wait_timeout_sec"; then
    die "Frontend is listening on :$frontend_port (PID=$frontend_pid) but did not respond at $frontend_url."
  fi
  log_step "Frontend already listening on :$frontend_port (PID=$frontend_pid)."
else
  log_step "Starting frontend dev server on :$frontend_port ..."
  rm -f "$frontend_out" "$frontend_err"

  pushd "$frontend_dir" >/dev/null
  nohup bun run dev >"$frontend_out" 2>"$frontend_err" < /dev/null &
  frontend_launcher_pid=$!
  disown "$frontend_launcher_pid" 2>/dev/null || true
  popd >/dev/null

  if ! frontend_pid="$(wait_service_ready "$frontend_port" "$frontend_url" "$wait_timeout_sec")"; then
    die "Frontend failed to respond at $frontend_url within $wait_timeout_sec seconds. See $frontend_err"
  fi
  log_step "Frontend is up (PID=$frontend_pid)."
fi

printf '%s\n' "$backend_pid" >"$backend_pid_file"
printf '%s\n' "$frontend_pid" >"$frontend_pid_file"

printf '\n'
printf 'Ready:\n'
printf '  Frontend: http://localhost:%s (PID=%s)\n' "$frontend_port" "$frontend_pid"
printf '  Backend : http://localhost:%s (PID=%s)\n' "$backend_port" "$backend_pid"
printf '\n'
printf 'Logs:\n'
printf '  %s\n' "$frontend_out"
printf '  %s\n' "$frontend_err"
printf '  %s\n' "$backend_out"
printf '  %s\n' "$backend_err"
