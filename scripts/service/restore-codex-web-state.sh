#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=""
STATE_DIR="${HOME}/.codex-web"
ENV_PATH="${HOME}/.config/codex-web/service.env"
NGINX_SITE_PATH=""
SERVICE_NAME="${CODEX_WEB_SERVICE_NAME:-codex-web.service}"
DRY_RUN=0
FORCE=0

usage() {
  cat <<'USAGE'
Usage: restore-codex-web-state.sh --backup PATH [options]

Restores Codex Web state and service env from a backup created by
backup-codex-web-state.sh. By default this refuses to write while the service
is active; stop the service first or pass --force during a controlled recovery.

Options:
  --backup PATH        Required backup directory
  --state-dir PATH     State directory, default ~/.codex-web
  --env-path PATH      Service env file, default ~/.config/codex-web/service.env
  --nginx-site PATH    Optional nginx site file restore target
  --service-name NAME  Service name, default codex-web.service
  --dry-run            Print actions without writing files
  --force              Allow restore while service is active
  -h, --help           Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup) BACKUP_DIR="$2"; shift 2 ;;
    --state-dir) STATE_DIR="$2"; shift 2 ;;
    --env-path) ENV_PATH="$2"; shift 2 ;;
    --nginx-site) NGINX_SITE_PATH="$2"; shift 2 ;;
    --service-name) SERVICE_NAME="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "${BACKUP_DIR}" ]]; then
  echo "--backup is required" >&2
  usage >&2
  exit 2
fi

if [[ ! -d "${BACKUP_DIR}" ]]; then
  echo "backup directory not found: ${BACKUP_DIR}" >&2
  exit 1
fi

manifest_value() {
  local key="$1"
  local manifest="${BACKUP_DIR}/backup-manifest.json"
  if [[ ! -f "${manifest}" ]]; then
    return 0
  fi
  sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "${manifest}" | head -n 1
}

service_status() {
  if [[ -n "${CODEX_WEB_RESTORE_SERVICE_STATUS:-}" ]]; then
    echo "${CODEX_WEB_RESTORE_SERVICE_STATUS}"
    return
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl is-active "${SERVICE_NAME}" 2>/dev/null || true
    return
  fi
  echo "unknown"
}

status="$(service_status | head -n 1 | tr -d '\r')"
if [[ "${FORCE}" -ne 1 && "${status}" == "active" ]]; then
  echo "service ${SERVICE_NAME} is active; stop it first or pass --force." >&2
  exit 1
fi

run() {
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    printf 'dry-run:'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

restore_archive_to_path() {
  local archive="$1"
  local target="$2"
  local label="$3"
  if [[ ! -f "${archive}" ]]; then
    echo "${label} archive not found, skipping: ${archive}"
    return
  fi
  local parent
  parent="$(dirname "${target}")"
  local timestamp
  timestamp="$(date -u +%Y%m%d-%H%M%S)"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    echo "dry-run: restore ${label} ${archive} -> ${target}"
    return
  fi
  mkdir -p "${parent}"
  local tmp_dir
  tmp_dir="$(mktemp -d "${parent}/.codex-web-restore.XXXXXX")"
  tar -xzf "${archive}" -C "${tmp_dir}"
  local archive_listing
  archive_listing="$(tar -tzf "${archive}")"
  local archive_first
  archive_first="${archive_listing%%$'\n'*}"
  local archive_root
  archive_root="${archive_first%%/*}"
  local extracted="${tmp_dir}/${archive_root}"
  if [[ ! -e "${extracted}" ]]; then
    rm -rf "${tmp_dir}"
    echo "archive did not contain a restorable root: ${archive}" >&2
    exit 1
  fi
  if [[ -e "${target}" ]]; then
    mv "${target}" "${target}.restore-prev-${timestamp}"
  fi
  mv "${extracted}" "${target}"
  rm -rf "${tmp_dir}"
}

state_archive_name="$(manifest_value stateArchive)"
if [[ -z "${state_archive_name}" ]]; then
  state_archive_name="codex-web-state.tar.gz"
fi
restore_archive_to_path "${BACKUP_DIR}/${state_archive_name}" "${STATE_DIR}" "state"

env_name="$(manifest_value serviceEnv)"
if [[ -z "${env_name}" ]]; then
  env_name="service.env"
fi
if [[ -f "${BACKUP_DIR}/${env_name}" ]]; then
  run mkdir -p "$(dirname "${ENV_PATH}")"
  run cp -a "${BACKUP_DIR}/${env_name}" "${ENV_PATH}"
else
  echo "service env not found, skipping: ${BACKUP_DIR}/${env_name}"
fi

nginx_name="$(manifest_value nginxSite)"
if [[ -n "${NGINX_SITE_PATH}" && -n "${nginx_name}" && -f "${BACKUP_DIR}/${nginx_name}" ]]; then
  run mkdir -p "$(dirname "${NGINX_SITE_PATH}")"
  run cp -a "${BACKUP_DIR}/${nginx_name}" "${NGINX_SITE_PATH}"
fi

echo "restore complete from ${BACKUP_DIR}"
