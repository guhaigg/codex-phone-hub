#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${CODEX_WEB_SERVICE_NAME:-codex-web.service}"
HOST="${CODEX_WEB_HOST:-127.0.0.1}"
PORT="${CODEX_WEB_PORT:-43210}"
BASE_URL="http://${HOST}:${PORT}"

print_command() {
  local label="$1"
  shift
  printf '%s: ' "${label}"
  if "$@" >/tmp/codex-web-status.out 2>/tmp/codex-web-status.err; then
    head -n 1 /tmp/codex-web-status.out
  else
    local code=$?
    if [[ -s /tmp/codex-web-status.err ]]; then
      head -n 1 /tmp/codex-web-status.err
    else
      echo "unavailable (exit ${code})"
    fi
  fi
}

print_command "node" node --version
print_command "npm" npm --version
print_command "codex" codex --version

printf 'service active: '
systemctl is-active codex-web.service || true
printf 'service enabled: '
systemctl is-enabled "${SERVICE_NAME}" || true

root_status="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/" || true)"
health_status="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/api/health" || true)"
echo "local root status: ${root_status}"
echo "auth gate /api/health status: ${health_status} (401 is expected without a bearer token)"

if [[ -f /var/run/reboot-required ]]; then
  echo "reboot required: yes"
  if [[ -f /var/run/reboot-required.pkgs ]]; then
    sed 's/^/  - /' /var/run/reboot-required.pkgs
  fi
else
  echo "reboot required: no"
fi

if command -v apt >/dev/null 2>&1; then
  upgradable_count="$(apt list --upgradable 2>/dev/null | sed '1d' | sed '/^$/d' | wc -l | tr -d ' ')"
  echo "upgradable packages: ${upgradable_count}"
else
  echo "upgradable packages: unknown (apt unavailable)"
fi

if command -v nginx >/dev/null 2>&1; then
  echo "nginx config:"
  nginx -t
fi
