#!/usr/bin/env bash
set -euo pipefail

kill_by_port=false
wait_timeout_sec=20

usage() {
  cat <<'EOF'
Usage: ./scripts/dev-down.sh [--kill-by-port] [--wait-timeout-sec N]
EOF
}

log_step() {
  printf '[dev-down] %s\n' "$1"
}

die() {
  printf '[dev-down] %s\n' "$1" >&2
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

wait_port_closed() {
  local port="$1"
  local timeout_sec="$2"
  local timeout_ms=$((timeout_sec * 1000))
  local waited_ms=0
  local interval_ms=250
  local pid

  while [ "$waited_ms" -lt "$timeout_ms" ]; do
    pid="$(get_listener_pid "$port")"
    if [ -z "$pid" ]; then
      return 0
    fi
    sleep 0.25
    waited_ms=$((waited_ms + interval_ms))
  done

  return 1
}

stop_pid() {
  local pid="$1"
  local label="$2"

  if ! is_integer "$pid"; then
    log_step "$label PID value is invalid: $pid"
    return 1
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    log_step "$label PID=$pid is not running."
    return 1
  fi

  log_step "Stopping $label PID=$pid ..."
  kill "$pid" 2>/dev/null || true
  return 0
}

stop_by_pid_file() {
  local label="$1"
  local pid_file="$2"
  local raw_pid

  if [ ! -f "$pid_file" ]; then
    log_step "$label pid file not found: $pid_file"
    return 0
  fi

  raw_pid="$(head -n 1 "$pid_file" 2>/dev/null | tr -d '[:space:]')"
  rm -f "$pid_file"

  if [ -z "$raw_pid" ]; then
    log_step "$label pid file was empty."
    return 0
  fi

  if ! is_integer "$raw_pid"; then
    log_step "$label pid file value is invalid: $raw_pid"
    return 0
  fi

  stop_pid "$raw_pid" "$label" || true
}

stop_port_listener() {
  local port="$1"
  local label="$2"
  local pid

  pid="$(get_listener_pid "$port")"
  if [ -z "$pid" ]; then
    log_step "No listener on :$port."
    return 0
  fi

  stop_pid "$pid" "$label(:$port)" || true
}

force_stop_port() {
  local port="$1"
  local label="$2"
  local pid

  pid="$(get_listener_pid "$port")"
  if [ -z "$pid" ]; then
    return 0
  fi

  log_step "$label(:$port) still listening with PID=$pid; sending SIGKILL ..."
  kill -9 "$pid" 2>/dev/null || true
}

ensure_port_closed() {
  local port="$1"
  local label="$2"

  if wait_port_closed "$port" "$wait_timeout_sec"; then
    return 0
  fi

  force_stop_port "$port" "$label"
  wait_port_closed "$port" "$wait_timeout_sec"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --kill-by-port)
      kill_by_port=true
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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
tmp_dir="$repo_root/tmp"
backend_port=9307
frontend_port=3300

backend_pid_file="$tmp_dir/backend.pid"
frontend_pid_file="$tmp_dir/frontend.pid"

log_step "Stopping services from pid files ..."
stop_by_pid_file "backend" "$backend_pid_file"
stop_by_pid_file "frontend" "$frontend_pid_file"

if [ "$kill_by_port" = "true" ]; then
  log_step "Kill-by-port fallback enabled."
  stop_port_listener "$frontend_port" "frontend"
  stop_port_listener "$backend_port" "backend"
fi

front_closed=true
back_closed=true

if ! ensure_port_closed "$frontend_port" "frontend"; then
  front_closed=false
fi

if ! ensure_port_closed "$backend_port" "backend"; then
  back_closed=false
fi

if [ "$front_closed" != "true" ] || [ "$back_closed" != "true" ]; then
  left_front="$(get_listener_pid "$frontend_port")"
  left_back="$(get_listener_pid "$backend_port")"
  die "Ports not fully released in time. :$frontend_port=${left_front:-none} :$backend_port=${left_back:-none}"
fi

printf '\n'
printf 'Stopped:\n'
printf '  Frontend :%s\n' "$frontend_port"
printf '  Backend  :%s\n' "$backend_port"
