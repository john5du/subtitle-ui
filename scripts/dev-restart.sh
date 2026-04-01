#!/usr/bin/env bash
set -euo pipefail

skip_install=false
wait_timeout_sec=30

usage() {
  cat <<'EOF'
Usage: ./scripts/dev-restart.sh [--skip-install] [--wait-timeout-sec N]
EOF
}

log_step() {
  printf '[dev-restart] %s\n' "$1"
}

die() {
  printf '[dev-restart] %s\n' "$1" >&2
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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
down_script="$script_dir/dev-down.sh"
up_script="$script_dir/dev-up.sh"

if [ ! -f "$down_script" ]; then
  die "Missing script: $down_script"
fi

if [ ! -f "$up_script" ]; then
  die "Missing script: $up_script"
fi

log_step "Stopping existing services ..."
"$down_script" --kill-by-port --wait-timeout-sec "$wait_timeout_sec"

log_step "Starting services ..."
up_args=(--wait-timeout-sec "$wait_timeout_sec")
if [ "$skip_install" = "true" ]; then
  up_args=(--skip-install "${up_args[@]}")
fi
"$up_script" "${up_args[@]}"
