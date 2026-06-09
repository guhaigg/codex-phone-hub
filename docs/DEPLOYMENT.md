# Deployment

Codex Phone Hub is deployed on a host that already has a working Codex CLI and
provider configuration. Official OpenAI login is not required when the host
Codex CLI is configured for a third-party API provider. The browser is only the
UI; code execution, file access, and provider credentials stay on the host.

## Requirements

- Node.js `>=24`
- npm
- A working Codex CLI/provider configuration on the host
- A working checkout of this repository
- Optional: reverse proxy, tunnel, or LAN-only access, managed outside this repo

## Install dependencies

```bash
npm install
```

## Configure login password

Set the web login password on the host. Do not commit the password or generated
state files.

```bash
npm run codex-web -- auth set-password
```

The auth store is written outside the repository under the configured state
directory, by default `~/.codex-web/`.

## Run locally

```bash
npm run serve --workspace packages/codex-web
```

Default bind behavior is controlled by the package configuration and environment
variables. Keep public exposure behind your own tunnel or reverse proxy.

## Linux systemd service

For a root/system deployment that matches the production layout, use the
installer script:

```bash
sudo scripts/install/install-codex-web-linux-systemd.sh \
  --app-dir /opt/codex-web \
  --state-dir /root/.codex-web \
  --default-cwd /opt/workday \
  --host 127.0.0.1 \
  --port 43210
```

The script writes `/root/.config/codex-web/service.env`, installs
`codex-web.service`, runs `npm install`, builds the workspaces, and starts the
service. It never reboots the host.

If you prefer a user service, create one that runs the web package from the
repository checkout. Adjust paths and environment values for your host:

```ini
[Unit]
Description=Codex Phone Hub mobile console
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/codex-phone-hub
Environment=CODEX_WEB_HOST=127.0.0.1
Environment=CODEX_WEB_PORT=8787
ExecStart=/usr/bin/env npm run serve --workspace packages/codex-web
Restart=on-failure

[Install]
WantedBy=default.target
```

Then enable it:

```bash
systemctl --user daemon-reload
systemctl --user enable --now codex-web.service
systemctl --user status codex-web.service
```

## Health and diagnostics

From the host, run:

```bash
scripts/service/status-codex-web-linux.sh
```

It reports Node/npm/Codex versions, `systemctl` status, local HTTP status,
whether `/var/run/reboot-required` exists, the packages requesting reboot, the
`apt list --upgradable` count, and `nginx -t` when nginx is installed.

Authenticated browsers can also read:

```text
GET /api/diagnostics/summary
```

The response is intentionally non-fatal for third-party API setups: official
usage being unavailable is reported as diagnostics, not as a Codex runtime
failure.

## Security audit and devices

Audit records are append-only JSONL under the configured state directory:

```text
~/.codex-web/audit-log.jsonl
```

Authenticated clients can list and revoke web login devices:

```text
GET /api/auth/sessions
DELETE /api/auth/sessions/:id
```

Admins can read recent audit entries:

```text
GET /api/admin/audit?cursor=&limit=&actor=&project=&action=
```

The settings page shows this as the personal "我的设备" and "操作记录" sections.
Audit metadata intentionally excludes passwords, bearer tokens, prompt text,
configuration values, uploaded file contents, terminal input text, and terminal
output.

## Backups and upgrades

Create a pre-upgrade backup:

```bash
scripts/service/backup-codex-web-state.sh \
  --app-dir /opt/codex-web \
  --state-dir /root/.codex-web \
  --env-path /root/.config/codex-web/service.env
```

Recommended upgrade sequence:

```bash
cd /opt/codex-web
scripts/service/backup-codex-web-state.sh
git pull --ff-only origin main
npm install
npm run build --workspaces --if-present
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
systemctl restart codex-web.service
scripts/service/status-codex-web-linux.sh
```

Restore state from a backup when auth/session/report state or `service.env`
needs recovery:

```bash
systemctl stop codex-web.service
scripts/service/restore-codex-web-state.sh \
  --backup /opt/codex-web/backups/YYYYMMDD-HHMMSS \
  --state-dir /root/.codex-web \
  --env-path /root/.config/codex-web/service.env
systemctl start codex-web.service
scripts/service/status-codex-web-linux.sh
```

For an emergency source rollback to a previous backup archive:

```bash
scripts/service/rollback-codex-web-release.sh \
  --backup /opt/codex-web/backups/YYYYMMDD-HHMMSS \
  --app-dir /opt/codex-web
scripts/service/status-codex-web-linux.sh
```

`restore-codex-web-state.sh --dry-run` previews file changes. Without
`--force`, restore refuses to overwrite state while `codex-web.service` is
active.

## Production hygiene

- Keep `~/.codex`, `~/.codex-web`, `.env`, logs, backups, and upload folders out
  of Git.
- Rotate the web password when handing off a deployed instance.
- Put TLS, hostnames, and access controls in the reverse proxy/tunnel layer.
- Run `npm run typecheck --workspaces --if-present` before deployment.
