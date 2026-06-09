#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/codex-web"
STATE_DIR="${HOME}/.codex-web"
DEFAULT_CWD="/opt/workday"
ENV_PATH="${HOME}/.config/codex-web/service.env"
SERVICE_NAME="codex-web.service"
# Default service.env values: CODEX_WEB_HOST=127.0.0.1, CODEX_WEB_PORT=43210.
HOST="127.0.0.1"
PORT="43210"
PASSWORD="${CODEX_WEB_PASSWORD:-}"
ENABLE_SERVICE=1

usage() {
  cat <<'USAGE'
Usage: install-codex-web-linux-systemd.sh [options]

Options:
  --app-dir PATH       Application checkout, default /opt/codex-web
  --state-dir PATH     State directory, default ~/.codex-web
  --default-cwd PATH   Default Codex cwd, default /opt/workday
  --env-path PATH      Service env file, default ~/.config/codex-web/service.env
  --host HOST          Local bind host, default 127.0.0.1
  --port PORT          Local bind port, default 43210
  --password VALUE     Set Web login password non-interactively
  --no-enable          Install unit but do not enable/start it
  -h, --help           Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --state-dir) STATE_DIR="$2"; shift 2 ;;
    --default-cwd) DEFAULT_CWD="$2"; shift 2 ;;
    --env-path) ENV_PATH="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --no-enable) ENABLE_SERVICE=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer is for Linux systemd hosts." >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root so the systemd unit can be installed." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required." >&2
  exit 1
fi

mkdir -p "${APP_DIR}" "${STATE_DIR}" "${DEFAULT_CWD}" "$(dirname "${ENV_PATH}")"

if [[ ! -f "${APP_DIR}/package.json" ]]; then
  echo "No package.json found in ${APP_DIR}; clone or copy codex-phone-hub there first." >&2
  exit 1
fi

cat > "${ENV_PATH}" <<ENV
NODE_ENV=production
CODEX_WEB_HOST=${HOST}
CODEX_WEB_PORT=${PORT}
CODEX_WEB_STATE_DIR=${STATE_DIR}
CODEX_WEB_DEFAULT_CWD=${DEFAULT_CWD}
ENV
chmod 600 "${ENV_PATH}"

cat > "/etc/systemd/system/${SERVICE_NAME}" <<UNIT
[Unit]
Description=Codex Phone Hub remote workbench
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_PATH}
ExecStart=/usr/bin/env npm run serve --workspace packages/codex-web
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

cd "${APP_DIR}"
npm install
npm run build --workspaces --if-present

if [[ -n "${PASSWORD}" ]]; then
  CODEX_WEB_PASSWORD="${PASSWORD}" npm run codex-web -- auth set-password
fi

systemctl daemon-reload
if [[ "${ENABLE_SERVICE}" -eq 1 ]]; then
  systemctl enable --now "${SERVICE_NAME}"
fi

echo "installed ${SERVICE_NAME}"
echo "local upstream: http://${HOST}:${PORT}"
echo "state dir: ${STATE_DIR}"
