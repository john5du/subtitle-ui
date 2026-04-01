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
require_cmd npm

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
frontend_dir="$repo_root/frontend"
tmp_dir="$repo_root/tmp"
backend_port=9307
frontend_port=3300

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
  log_step "Backend already listening on :$backend_port (PID=$backend_pid)."
else
  log_step "Starting backend on :$backend_port ..."
  rm -f "$backend_out" "$backend_err"

  pushd "$repo_root" >/dev/null
  nohup go run ./backend/cmd/server >"$backend_out" 2>"$backend_err" < /dev/null &
  backend_launcher_pid=$!
  disown "$backend_launcher_pid" 2>/dev/null || true
  popd >/dev/null

  if ! backend_pid="$(wait_port_open "$backend_port" "$wait_timeout_sec")"; then
    die "Backend failed to listen on :$backend_port within $wait_timeout_sec seconds. See $backend_err"
  fi
  log_step "Backend is up (PID=$backend_pid)."
fi

node_modules_dir="$frontend_dir/node_modules"
if [ "$skip_install" = "false" ] && [ ! -d "$node_modules_dir" ]; then
  log_step "frontend/node_modules not found. Installing dependencies ..."
  (
    cd "$frontend_dir" || exit 1
    npm install
  )
fi

frontend_pid="$(get_listener_pid "$frontend_port")"
if [ -n "$frontend_pid" ]; then
  log_step "Frontend already listening on :$frontend_port (PID=$frontend_pid)."
else
  log_step "Starting frontend dev server on :$frontend_port ..."
  rm -f "$frontend_out" "$frontend_err"

  pushd "$frontend_dir" >/dev/null
  nohup npm run dev >"$frontend_out" 2>"$frontend_err" < /dev/null &
  frontend_launcher_pid=$!
  disown "$frontend_launcher_pid" 2>/dev/null || true
  popd >/dev/null

  if ! frontend_pid="$(wait_port_open "$frontend_port" "$wait_timeout_sec")"; then
    die "Frontend failed to listen on :$frontend_port within $wait_timeout_sec seconds. See $frontend_err"
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
