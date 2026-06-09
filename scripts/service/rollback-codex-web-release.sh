#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=""
APP_DIR="/opt/codex-web"
SERVICE_NAME="${CODEX_WEB_SERVICE_NAME:-codex-web.service}"
DRY_RUN=0
SKIP_SERVICE=0

usage() {
  cat <<'USAGE'
Usage: rollback-codex-web-release.sh --backup PATH [options]

Restores the application checkout from a source archive created by
backup-codex-web-state.sh and restarts codex-web.service unless --skip-service
is provided.

Options:
  --backup PATH        Required backup directory
  --app-dir PATH       Application checkout, default /opt/codex-web
  --service-name NAME  Service name, default codex-web.service
  --dry-run            Print actions without writing files or restarting
  --skip-service       Do not run systemctl restart/status
  -h, --help           Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup) BACKUP_DIR="$2"; shift 2 ;;
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --service-name) SERVICE_NAME="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-service) SKIP_SERVICE=1; shift ;;
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

source_archive_name="$(manifest_value sourceArchive)"
if [[ -z "${source_archive_name}" ]]; then
  if [[ -f "${BACKUP_DIR}/source.tar.gz" ]]; then
    source_archive_name="source.tar.gz"
  else
    source_archive_name="source-metadata.tar.gz"
  fi
fi
source_archive="${BACKUP_DIR}/${source_archive_name}"
if [[ ! -f "${source_archive}" ]]; then
  echo "source archive not found: ${source_archive}" >&2
  exit 1
fi

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "dry-run: restore source ${source_archive} -> ${APP_DIR}"
  if [[ "${SKIP_SERVICE}" -ne 1 ]]; then
    echo "dry-run: systemctl restart ${SERVICE_NAME}"
  fi
  exit 0
fi

parent="$(dirname "${APP_DIR}")"
timestamp="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "${parent}"
tmp_dir="$(mktemp -d "${parent}/.codex-web-rollback.XXXXXX")"
tar -xzf "${source_archive}" -C "${tmp_dir}"
archive_listing="$(tar -tzf "${source_archive}")"
archive_first="${archive_listing%%$'\n'*}"
archive_root="${archive_first%%/*}"
extracted="${tmp_dir}/${archive_root}"
if [[ ! -e "${extracted}" ]]; then
  rm -rf "${tmp_dir}"
  echo "archive did not contain a restorable source root: ${source_archive}" >&2
  exit 1
fi

if [[ -e "${APP_DIR}" ]]; then
  mv "${APP_DIR}" "${APP_DIR}.rollback-prev-${timestamp}"
fi
mv "${extracted}" "${APP_DIR}"
rm -rf "${tmp_dir}"

if [[ "${SKIP_SERVICE}" -ne 1 ]]; then
  systemctl restart "${SERVICE_NAME}"
  systemctl is-active "${SERVICE_NAME}"
fi

echo "rollback complete from ${BACKUP_DIR}"
