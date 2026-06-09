#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/codex-web"
STATE_DIR="${HOME}/.codex-web"
ENV_PATH="${HOME}/.config/codex-web/service.env"
BACKUP_ROOT="/opt/codex-web/backups"
NGINX_SITE_PATH="${NGINX_SITE_PATH:-}"

usage() {
  cat <<'USAGE'
Usage: backup-codex-web-state.sh [options]

Backs up the Codex Web application checkout, ~/.codex-web state, service.env,
and an optional nginx site file into /opt/codex-web/backups.

Options:
  --app-dir PATH       Application checkout, default /opt/codex-web
  --state-dir PATH     State directory, default ~/.codex-web
  --env-path PATH      Service env file, default ~/.config/codex-web/service.env
  --backup-root PATH   Backup root, default /opt/codex-web/backups
  --nginx-site PATH    Optional nginx site file to copy
  -h, --help           Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --state-dir) STATE_DIR="$2"; shift 2 ;;
    --env-path) ENV_PATH="$2"; shift 2 ;;
    --backup-root) BACKUP_ROOT="$2"; shift 2 ;;
    --nginx-site) NGINX_SITE_PATH="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

timestamp="$(date -u +%Y%m%d-%H%M%S)"
backup_dir="${BACKUP_ROOT}/${timestamp}"
mkdir -p "${backup_dir}"

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

git_commit=""
if [[ -d "${APP_DIR}/.git" ]]; then
  git_commit="$(git -C "${APP_DIR}" rev-parse --short HEAD 2>/dev/null || true)"
  git -C "${APP_DIR}" status --short > "${backup_dir}/git-status.txt" || true
  git -C "${APP_DIR}" diff > "${backup_dir}/git-diff.patch" || true
fi

source_archive="${backup_dir}/source.tar.gz"
tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='backups' \
  -czf "${source_archive}" \
  -C "$(dirname "${APP_DIR}")" "$(basename "${APP_DIR}")"

state_archive=""
if [[ -d "${STATE_DIR}" ]]; then
  state_archive="${backup_dir}/codex-web-state.tar.gz"
  tar -czf "${state_archive}" -C "$(dirname "${STATE_DIR}")" "$(basename "${STATE_DIR}")"
fi

env_copy=""
if [[ -f "${ENV_PATH}" ]]; then
  env_copy="${backup_dir}/service.env"
  cp -a "${ENV_PATH}" "${env_copy}"
fi

nginx_copy=""
if [[ -n "${NGINX_SITE_PATH}" && -f "${NGINX_SITE_PATH}" ]]; then
  nginx_copy="${backup_dir}/nginx-site.conf"
  cp -a "${NGINX_SITE_PATH}" "${nginx_copy}"
fi

source_archive_name="$(basename "${source_archive}")"
source_archive_sha="$(checksum "${source_archive}")"
state_archive_name=""
state_archive_sha=""
if [[ -n "${state_archive}" ]]; then
  state_archive_name="$(basename "${state_archive}")"
  state_archive_sha="$(checksum "${state_archive}")"
fi
env_copy_name=""
env_copy_sha=""
if [[ -n "${env_copy}" ]]; then
  env_copy_name="$(basename "${env_copy}")"
  env_copy_sha="$(checksum "${env_copy}")"
fi
nginx_copy_name=""
nginx_copy_sha=""
if [[ -n "${nginx_copy}" ]]; then
  nginx_copy_name="$(basename "${nginx_copy}")"
  nginx_copy_sha="$(checksum "${nginx_copy}")"
fi

manifest="${backup_dir}/backup-manifest.json"
cat > "${manifest}" <<JSON
{
  "timestamp": "${timestamp}",
  "appDir": "${APP_DIR}",
  "stateDir": "${STATE_DIR}",
  "gitCommit": "${git_commit}",
  "sourceArchive": "${source_archive_name}",
  "sourceArchiveSha256": "${source_archive_sha}",
  "stateArchive": "${state_archive_name}",
  "stateArchiveSha256": "${state_archive_sha}",
  "serviceEnv": "${env_copy_name}",
  "serviceEnvSha256": "${env_copy_sha}",
  "nginxSite": "${nginx_copy_name}",
  "nginxSiteSha256": "${nginx_copy_sha}",
  "restoreCommand": "scripts/service/restore-codex-web-state.sh --backup ${backup_dir}",
  "rollbackCommand": "scripts/service/rollback-codex-web-release.sh --backup ${backup_dir}"
}
JSON

echo "backup created: ${backup_dir}"
