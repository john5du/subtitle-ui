#!/usr/bin/env bash
# Shared dotenv loader for dev scripts.
# Usage: source this file, then: load_dotenv "/path/to/.env"
#
# Rules:
# - KEY=VALUE lines only (optional export prefix)
# - # comments and blank lines ignored
# - single/double quotes stripped from values
# - does NOT override variables already set in the environment
# - does not execute shell code from the file

load_dotenv() {
  local file="$1"
  local line key value

  if [ -z "${file:-}" ] || [ ! -f "$file" ]; then
    return 0
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    # trim CR (Windows) and leading/trailing whitespace
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"

    if [ -z "$line" ] || [ "${line:0:1}" = "#" ]; then
      continue
    fi

    if [[ "$line" == export[[:space:]]* ]]; then
      line="${line#export}"
      line="${line#"${line%%[![:space:]]*}"}"
    fi

    if [[ ! "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      continue
    fi

    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"

    # strip matching surrounding quotes
    if [[ "$value" =~ ^\"(.*)\"$ ]]; then
      value="${BASH_REMATCH[1]}"
    elif [[ "$value" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi

    # skip if already set in the environment (including empty)
    if printenv "$key" >/dev/null 2>&1; then
      continue
    fi

    export "${key}=${value}"
  done <"$file"
}
