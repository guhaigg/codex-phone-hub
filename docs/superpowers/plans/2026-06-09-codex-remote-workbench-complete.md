# Codex Remote Workbench Complete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Codex Phone Hub into a complete remote workbench for operating and synchronizing a server-side Codex CLI/runtime from phone and web browsers.

**Architecture:** Keep Codex execution on the host and keep the browser as a remote control plane. Extend the existing `codex-native-api -> runtime.ts -> server.ts -> public/app.js` chain instead of introducing a second session system. Treat the Codex app-server thread/turn/item model as the source of truth and add durable Web state only for Web-specific auth, RBAC, project metadata, reports, and sync cursors.

**Tech Stack:** Node.js >=24, TypeScript, npm workspaces, vanilla HTML/CSS/JS frontend, Codex app-server JSON-RPC through `packages/codex-native-api`, HTTP JSON APIs, SSE, local filesystem state under `~/.codex-web`.

---

## Product Standard

This plan targets a production-ready v1.0 product, not an MVP. Development can
be split into engineering milestones, but the product is not launch-ready until
all launch gates pass.

### v1.0 Launch Scope

Codex Phone Hub v1.0 must provide all of these product surfaces:

1. **Remote session control**
   - Create, resume, archive, favorite, share, and audit Codex sessions.
   - Start, stop, recover, and steer turns from phone and desktop browsers.
   - Continue normal Codex threads created by CLI/app-server instead of creating
     a parallel Web-only session world.
2. **Real-time multi-device sync**
   - Multiple browsers viewing the same account/project/session see consistent
     session state, active turn state, approval state, and terminal status.
   - Refreshing or foregrounding a mobile PWA does not lose the running task.
3. **Remote operations cockpit**
   - Show model, cwd, sandbox, approval mode, personality, collaboration mode,
     goal, provider health, app-server health, and service status.
   - Provide mobile-first approval and task inbox views.
4. **Workspace visibility**
   - Show project status, git branch, dirty files, staged/unstaged/untracked
     counts, diffs, recent commits, and generated artifacts.
   - Provide read-only file/diff inspection with strict path boundaries.
5. **Interactive execution support**
   - Provide a scoped terminal/process monitor for validation commands and long
     running project tasks.
   - Let terminal output be copied or attached to a Codex prompt.
6. **Codex ecosystem management**
   - Expose skills, plugins, apps/connectors, MCP servers, OAuth start flows,
     runtime reload, and config diagnostics from the Web UI.
7. **Third-party provider compatibility**
   - Treat official-account usage as optional.
   - Show provider health/model availability without requiring OpenAI OAuth
     when the host Codex CLI is configured for a third-party API.
8. **Enterprise/internal sharing controls**
   - Keep single-user mode simple.
   - Keep multi-user RBAC complete for project read/create/write, observer mode,
     share links, terminal access, artifacts, and admin audit.
9. **Production operations**
   - Provide backup, restore, health check, upgrade, and systemd deployment
     scripts.
   - Provide logs and diagnostics that an operator can use without reading code.

### Launch Gates

Do not call the product launch-ready until every gate below is true:

- **Functional gate:** every v1.0 launch scope item has a working UI, API, tests,
  and documentation.
- **Mobile gate:** iPhone/Android PWA flows pass: login, create session, run
  turn, background/foreground recovery, approval, steering, diff inspection,
  terminal output, artifact opening, logout.
- **Desktop gate:** desktop browser flows pass for multi-pane session list,
  chat, workspace, terminal, ecosystem, admin, and reports.
- **Sync gate:** two browsers can concurrently observe and operate the same
  running turn without stale status or duplicate final messages.
- **Security gate:** unauthenticated routes expose only static app shell and
  public share routes; all project/session/terminal/artifact/ecosystem writes
  enforce RBAC.
- **Durability gate:** service restart does not corrupt auth, identity,
  settings, timeline, active-turn records, reports, artifacts, or project
  metadata.
- **Provider gate:** third-party API deployments do not show official usage
  failures as task failures.
- **Operations gate:** clean production upgrade from current `/opt/codex-web`
  deployment succeeds with backup, tests, restart, and rollback instructions.
- **Regression gate:** `npm run build --workspaces --if-present`,
  `npm run typecheck --workspaces --if-present`, full workspace tests, and the
  mobile E2E checklist pass.

## Current Implemented Surface

The repository already has a strong base. Do not rebuild these areas from scratch.

### Runtime and API

- `packages/codex-web/src/server.ts`
  - Auth: login, logout, current user, setup-required handling.
  - Single-user routes: settings, health, models, usage, reports, sessions, timeline append, attachments, turns, turn SSE, interrupt, approvals.
  - Multi-user routes: projects, per-user project favorites, user-scoped session list/create/read/write, archive/unarchive, share links, admin audit.
  - Admin routes: settings, projects, roles, users, admin session audit.
  - Upload safety: multipart size limits, project/state upload roots, symlink rejection, allowed-path validation.
  - Public share routes: read-only session and turn event stream.
- `packages/codex-web/src/runtime.ts`
  - Session list/create/read/archive/unarchive/favorite.
  - Settings persistence per session.
  - Turn start with `cwd`, model, reasoning effort, service tier, personality, sandbox, approval policy, collaboration mode, attachments, developer instructions.
  - Turn interrupt and approval resolution.
  - Event normalization for assistant deltas/finals, command/file/permission batches, approvals, failures.
  - Goal/help slash commands.
  - Runtime reload for MCP servers.
- `packages/codex-native-api/src/codex_app_client.ts`
  - Already includes additional app-server abilities not yet exposed in Web UI/API:
    - skills list and enable/disable
    - plugin list/read/install/uninstall
    - app list and enable/disable
    - MCP server status, enable/disable, OAuth login, reload
    - config value write
    - pending approvals

### Frontend

- `packages/codex-web/public/app.js`
  - Login, auth restore, session list, search, favorites, archived filter.
  - Mobile/desktop layout.
  - Chat timeline, streamed assistant output, command/file/approval work cards.
  - Composer, attachments, stop turn, approval actions.
  - Per-session tools: cwd, model, reasoning, sandbox, approval, collaboration mode, personality, `/help`, `/goal`, favorite/archive.
  - Settings, capabilities, reports, admin users/projects/roles/multi-user pages.
  - Basic visibility refresh protection for active form controls.

### Tests and Docs

- Existing test suites cover auth, config, event bus/model, hybrid auth, identity store, runtime, server auth, multi-user, reports, launchd scripts, install docs, and public UI string/harness checks.
- `docs/API_MAP.md`, `docs/MOBILE_E2E.md`, and `docs/HANDOVER.zh-CN.md` document the current runtime chain, mobile regression risks, deployment, and RBAC constraints.

## Gaps Against Complete Remote Workbench

These are the real gaps after reading the current code.

1. **Foreground/background stream recovery is incomplete in current `app.js`.**
   - Backend SSE already supports `after` and `Last-Event-ID`.
   - Frontend tracks `lastTurnEventSequence`, but the current `readSse()` does not send `after=...`.
   - `public_ui.test.ts` contains expectations for foreground recovery helpers that are not present in the current app file.
2. **Active turn state is mostly process-local.**
   - `runtime.activeTurns` and `turnToThread` are in memory.
   - A service restart loses live event history and active-turn ownership even if Codex continues or the transcript later records terminal state.
3. **No true multi-device live workspace sync.**
   - Session list and current session refresh are request-driven.
   - There is no workspace-level event channel for session created/updated/archived, approvals pending, or another device acting.
4. **No `turn/steer` / append-to-running-turn support.**
   - Composer blocks when `pendingTurn` is true.
   - Complete remote operation needs steering a running Codex turn from phone.
5. **CLI slash command parity is thin.**
   - Implemented: `/help`, `/goal`.
   - Missing high-value remote commands: `/status`, `/model`, `/permissions`, `/plan`, `/review`, `/diff`, `/mention`, `/compact`, `/resume`, `/fork`, `/mcp`, `/skills`, `/plugins`.
6. **Codex ecosystem management is not surfaced.**
   - Client methods exist for skills/plugins/apps/MCP/config, but Web has no routes or UI for them.
7. **No Git/workspace inspection layer.**
   - UI has no durable project status: branch, dirty files, diff, untracked files, staged files, last commit, remote status.
8. **No integrated terminal/process monitor.**
   - Desktop app has terminal affordances. Current Web only shows Codex-emitted command batches.
9. **Artifacts are report-specific, not general.**
   - Reports work, but generated images/files/PDFs/docs/spreadsheets are not represented as first-class artifacts.
10. **Third-party provider mode is not first-class.**
    - `/api/usage` assumes official account/rate-limit semantics and can fail for third-party API setups.
    - Model/provider health should be explicit and separate from official Codex account usage.

## Implementation Strategy

Implement this as production milestones. A milestone may be merged after it
passes its tests, but public/product launch waits for all milestones and launch
gates. Do not label an intermediate milestone as an MVP or final product.

### Task 1: Stabilize Stream Recovery and Session Sync Baseline

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/src/event_bus.ts`
- Test: `packages/codex-web/test/public_ui.test.ts`
- Test: `packages/codex-web/test/server_auth.test.ts`
- Test: `packages/codex-web/test/server_multi_user.test.ts`

- [ ] Restore frontend foreground recovery helpers expected by tests:
  - `onVisibilityChange()`
  - `onPageResume()`
  - `isTurnStreamHealthy()`
  - `recoverActiveTurnAfterForeground()`
  - `refreshCurrentSessionMetadata()`
  - `streamTurnEvents(turnId, { forceReconnect })`
- [ ] Change turn SSE fetch URL to include `after=${state.lastTurnEventSequence}` when available.
- [ ] Preserve `pendingTurn=true` and `turnId` when the stream drops but the tab remains visible.
- [ ] Show explicit `Stream paused` state instead of converting stream failures into turn failures.
- [ ] On foreground resume, refresh current session history first, then reconnect stream using `after`.
- [ ] Extend server tests to verify `GET /api/turns/:id/events?after=N` returns only events with sequence greater than `N`.
- [ ] Keep form-control protection intact:
  - `isFormControlInteractionActive()`
  - `renderAfterBackgroundRefresh()`
- [ ] Verification:
  - `npm run build --workspaces --if-present`
  - `npm run typecheck --workspaces --if-present`
  - `npm test --workspace packages/codex-web -- --test-name-pattern "SSE|foreground|active turn|public UI|multi-user"`

### Task 2: Add Workspace-Level Live Sync

**Files:**
- Create: `packages/codex-web/src/workspace_event_bus.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/src/runtime.ts`
- Modify: `packages/codex-web/public/app.js`
- Test: `packages/codex-web/test/workspace_event_bus.test.ts`
- Test: `packages/codex-web/test/server_auth.test.ts`
- Test: `packages/codex-web/test/server_multi_user.test.ts`

- [ ] Add a workspace event bus for cross-session events:
  - `session.created`
  - `session.updated`
  - `session.archived`
  - `session.unarchived`
  - `session.favorite.updated`
  - `turn.started`
  - `turn.completed`
  - `turn.failed`
  - `approval.requested`
  - `approval.resolved`
  - `report.updated`
- [ ] Add authenticated SSE endpoint:
  - `GET /api/workspace/events`
- [ ] In multi-user mode, filter workspace events by project grants and session ownership.
- [ ] Frontend opens one workspace SSE connection after auth restore.
- [ ] Session list updates without manual refresh when another device starts/completes a turn.
- [ ] Current session timeline refreshes when another device updates the same session.
- [ ] Add reconnect with last event sequence for workspace events.
- [ ] Verification:
  - Multi-device simulation in tests: two clients, one turn event, both update state.

### Task 3: Add Durable Runtime State for Remote Continuity

**Files:**
- Create: `packages/codex-web/src/active_turn_store.ts`
- Modify: `packages/codex-web/src/runtime.ts`
- Modify: `packages/codex-web/src/cli.ts`
- Modify: `packages/codex-web/src/server.ts`
- Test: `packages/codex-web/test/active_turn_store.test.ts`
- Test: `packages/codex-web/test/runtime.test.ts`

- [ ] Persist active turn records under `~/.codex-web/active-turns.json`.
- [ ] Store:
  - `turnId`
  - `threadId`
  - `startedAt`
  - `lastEventSequence`
  - `lastKnownStatus`
  - `pendingApprovalIds`
- [ ] On turn terminal event, mark record completed/failed/interrupted and remove from active set.
- [ ] On server startup, reconcile active records with Codex thread history:
  - if terminal in thread history, clear active record
  - if unknown, expose `streamRecoverable` state rather than claiming live execution
- [ ] Make `readSession()` expose:
  - `activeTurnId`
  - `activeTurnRecoverable`
  - `lastKnownTurnStatus`
- [ ] Make interrupt/approval APIs resolve owner thread from durable state if process map is empty.
- [ ] Verification:
  - Runtime tests simulate process restart by constructing a new runtime against the same active-turn store.

### Task 4: Support Running-Turn Steering

**Files:**
- Modify: `packages/codex-native-api/src/provider.ts`
- Modify: `packages/codex-native-api/src/codex_app_client.ts`
- Modify: `packages/codex-web/src/runtime.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/public/app.js`
- Test: `packages/codex-native-api/test/codex_app_client_work_events.test.ts`
- Test: `packages/codex-web/test/runtime.test.ts`
- Test: `packages/codex-web/test/server_auth.test.ts`
- Test: `packages/codex-web/test/public_ui.test.ts`

- [ ] Add provider method `steerTurn({ threadId, turnId, inputText, input })`.
- [ ] Map it to app-server `turn/steer` when supported.
- [ ] Add API:
  - `POST /api/turns/:turnId/steer`
- [ ] In multi-user mode, require write access to the owning session.
- [ ] Frontend composer stays enabled during running turns, but changes label to `追加指令`.
- [ ] Send normal prompt as steer when `pendingTurn && turnId`.
- [ ] Render steered user messages as `meta: steering`.
- [ ] If runtime does not support steer, return a clear `409 steer_not_supported`.
- [ ] Verification:
  - Existing non-overlap behavior remains for starting a second turn.
  - Steering appends to the active turn and keeps the stream open.

### Task 5: Implement Remote Command Parity

**Files:**
- Create: `packages/codex-web/src/remote_commands.ts`
- Modify: `packages/codex-web/src/runtime.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/public/app.js`
- Test: `packages/codex-web/test/remote_commands.test.ts`
- Test: `packages/codex-web/test/runtime.test.ts`
- Test: `packages/codex-web/test/public_ui.test.ts`

- [ ] Move `/help` and `/goal` parsing out of `runtime.ts` into `remote_commands.ts`.
- [ ] Add `/status`:
  - thread id
  - cwd
  - model
  - reasoning
  - sandbox
  - approval
  - collaboration mode
  - personality
  - active turn id
  - goal status
  - provider mode and usage availability
- [ ] Add `/model <id>` and `/model` display.
- [ ] Add `/permissions` display and setters for sandbox/approval presets.
- [ ] Add `/plan [text]` as a collaboration-mode switch plus optional prompt.
- [ ] Add `/resume <threadId>` to open an existing Codex thread into Web state.
- [ ] Add `/fork <threadId>` only after provider fork support exists; until then return `fork_not_supported`.
- [ ] Add `/mcp`, `/skills`, `/plugins` as read-only command summaries backed by Task 7 APIs.
- [ ] Keep unsupported commands explicit rather than silently sending them as normal prompts.
- [ ] Verification:
  - Command tests assert no native turn is started for handled commands.

### Task 6: Add Project Workspace Inspector

**Files:**
- Create: `packages/codex-web/src/workspace_inspector.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/public/styles.css`
- Test: `packages/codex-web/test/workspace_inspector.test.ts`
- Test: `packages/codex-web/test/server_auth.test.ts`
- Test: `packages/codex-web/test/server_multi_user.test.ts`

- [ ] Add API:
  - `GET /api/projects/:projectId/status`
  - `GET /api/sessions/:sessionId/workspace/status`
  - `GET /api/sessions/:sessionId/workspace/diff`
  - `GET /api/sessions/:sessionId/workspace/files?path=...`
- [ ] Status includes:
  - cwd
  - git branch
  - upstream
  - dirty file counts
  - staged/unstaged/untracked counts
  - last commit
  - disk writeability
- [ ] Diff endpoint returns file-level and hunk-level text diff.
- [ ] File endpoint is read-only and must reject paths outside the project cwd.
- [ ] UI adds a `工作区` panel beside/under chat:
  - branch/status header
  - changed files list
  - diff viewer
  - copy path/open report actions
- [ ] Do not implement browser-side editing in this task.
- [ ] Verification:
  - Tests cover non-git directories, git repos, path traversal, symlink escape, and RBAC.

### Task 7: Add Skills, Plugins, MCP, Apps, and Provider Settings UI

**Files:**
- Modify: `packages/codex-web/src/runtime.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/public/styles.css`
- Test: `packages/codex-web/test/server_auth.test.ts`
- Test: `packages/codex-web/test/server_multi_user.test.ts`
- Test: `packages/codex-web/test/public_ui.test.ts`

- [ ] Surface existing client methods through runtime:
  - `listSkills`
  - `setSkillEnabled`
  - `listPlugins`
  - `readPlugin`
  - `installPlugin`
  - `uninstallPlugin`
  - `listApps`
  - `setAppEnabled`
  - `listMcpServerStatuses`
  - `setMcpServerEnabled`
  - `startMcpServerOauthLogin`
  - `writeConfigValue`
- [ ] Add API:
  - `GET/PATCH /api/skills`
  - `GET /api/plugins`
  - `GET /api/plugins/:id`
  - `POST /api/plugins/:id/install`
  - `POST /api/plugins/:id/uninstall`
  - `GET/PATCH /api/apps`
  - `GET/PATCH /api/mcp`
  - `POST /api/mcp/:name/oauth/start`
  - `POST /api/config/value`
- [ ] Admin-only for install/uninstall/config writes by default.
- [ ] Non-admin users may list only effective skills/MCP status for readable projects.
- [ ] UI adds `生态` or expands `能力`:
  - Skills tab
  - Plugins tab
  - MCP tab
  - Apps/connectors tab
  - Config diagnostics tab
- [ ] OAuth start returns authorization URL and displays a mobile-friendly open/copy action.
- [ ] Third-party provider mode:
  - Separate official usage failures from provider health.
  - Show `用量不可用` instead of surfacing it as a runtime failure.
- [ ] Verification:
  - Mock client tests for every route.
  - UI tests for list, enable/disable, reload, OAuth URL display, permission restrictions.

### Task 8: Add Remote Terminal and Process Monitor

**Files:**
- Create: `packages/codex-web/src/terminal_manager.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/public/styles.css`
- Test: `packages/codex-web/test/terminal_manager.test.ts`
- Test: `packages/codex-web/test/server_auth.test.ts`
- Test: `packages/codex-web/test/server_multi_user.test.ts`

- [ ] Add terminal sessions scoped to project cwd, not arbitrary root.
- [ ] Add API:
  - `POST /api/sessions/:sessionId/terminal`
  - `GET /api/terminals/:id/events`
  - `POST /api/terminals/:id/input`
  - `POST /api/terminals/:id/resize`
  - `POST /api/terminals/:id/stop`
  - `GET /api/terminals`
- [ ] Start with shell command mode if PTY portability is too risky; add PTY after tests pass.
- [ ] Store recent terminal output in memory with bounded history.
- [ ] UI adds terminal drawer:
  - recent output
  - command input
  - stop/clear/copy
  - attach output to next Codex prompt
- [ ] Add `/ps` and `/stop` commands backed by terminal manager.
- [ ] Security:
  - require project write access for terminal creation
  - enforce cwd under project
  - log command start/stop metadata to session timeline
- [ ] Verification:
  - Tests cover output streaming, stop, RBAC, cwd escape, history truncation.

### Task 9: Add Artifacts and File Deliverables

**Files:**
- Create: `packages/codex-web/src/artifact_store.ts`
- Modify: `packages/codex-web/src/runtime.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/public/styles.css`
- Test: `packages/codex-web/test/artifact_store.test.ts`
- Test: `packages/codex-web/test/server_auth.test.ts`
- Test: `packages/codex-web/test/public_ui.test.ts`

- [ ] Promote provider artifacts from `ProviderTurnArtifactDeliveryState` to Web artifacts.
- [ ] Store artifact index under `~/.codex-web/artifact-index.json`.
- [ ] Add API:
  - `GET /api/sessions/:sessionId/artifacts`
  - `GET /api/artifacts/:id`
  - `GET /api/artifacts/:id/content`
  - `PATCH /api/artifacts/:id/favorite`
- [ ] Support preview modes:
  - text/markdown
  - image
  - PDF download/inline
  - generic file download
- [ ] Keep report store as a specialized artifact source, not a separate isolated world.
- [ ] UI adds artifacts rail inside session and reports page.
- [ ] Security:
  - reject symlink escape
  - reject paths outside artifact/report roots unless explicitly declared by provider and inside project cwd
- [ ] Verification:
  - Tests cover path traversal, symlink escape, missing files, size limits, and UI preview routing.

### Task 10: Add Full Mobile/PWA Remote Experience

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/public/styles.css`
- Modify: `packages/codex-web/public/service-worker.js`
- Modify: `packages/codex-web/public/manifest.webmanifest`
- Test: `packages/codex-web/test/public_ui.test.ts`
- Create: `docs/MOBILE_REMOTE_WORKBENCH_E2E.md`

- [ ] Add mobile task inbox:
  - running
  - waiting approval
  - failed
  - completed recently
- [ ] Add approval-first mobile view:
  - command/file summary
  - allow once
  - allow session
  - deny
  - jump to thread
- [ ] Add PWA notification hooks where browser support allows:
  - turn completed
  - approval needed
  - turn failed
- [ ] Add offline/connection state:
  - connected
  - reconnecting
  - stream paused
  - server unavailable
- [ ] Add device/session management page:
  - active browser sessions
  - last seen
  - revoke device
- [ ] Add mobile E2E doc with mandatory flows:
  - login
  - create turn
  - background/foreground recovery
  - approve command
  - steer running turn
  - inspect diff
  - open artifact
  - admin role grant select stability
- [ ] Verification:
  - UI harness tests for state transitions.
  - Manual browser/PWA checklist before deployment.

### Task 11: Production Upgrade and Operations

**Files:**
- Create: `scripts/install/install-codex-web-linux-systemd.sh`
- Create: `scripts/service/status-codex-web-linux.sh`
- Create: `scripts/service/backup-codex-web-state.sh`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/HANDOVER.zh-CN.md`

- [ ] Add Linux systemd installer matching the production layout:
  - `/opt/codex-web`
  - `/root/.config/codex-web/service.env`
  - `/root/.codex-web`
  - local upstream `127.0.0.1:43210`
- [ ] Add backup script for:
  - source dirty diff
  - `~/.codex-web`
  - service env
  - nginx site file path if present
- [ ] Add health script:
  - Node version
  - npm version
  - Codex CLI version
  - service active/enabled
  - local root 200
  - `/api/health` auth gate 401
  - nginx config test when installed
- [ ] Add documented upgrade command sequence:
  - backup
  - `git pull --ff-only`
  - `npm ci` or `npm install`
  - build
  - typecheck
  - tests
  - restart
  - health check
- [ ] Verification:
  - Shell script tests modeled after existing launchd script tests.

### Task 12: Add Audit Logs, Device Sessions, and Admin Observability

**Files:**
- Create: `packages/codex-web/src/audit_store.ts`
- Modify: `packages/codex-web/src/auth_store.ts`
- Modify: `packages/codex-web/src/hybrid_auth_store.ts`
- Modify: `packages/codex-web/src/identity_store.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/public/styles.css`
- Test: `packages/codex-web/test/audit_store.test.ts`
- Test: `packages/codex-web/test/server_auth.test.ts`
- Test: `packages/codex-web/test/server_multi_user.test.ts`
- Test: `packages/codex-web/test/public_ui.test.ts`

- [ ] Add append-only audit store under `~/.codex-web/audit-log.jsonl`.
- [ ] Record security and write actions:
  - login success/failure/rate limit
  - logout
  - device/session revocation
  - password reset
  - project/user/role/settings changes
  - session create/archive/unarchive/share
  - turn start/steer/interrupt
  - approval accept/accept-for-session/deny
  - terminal start/input/stop
  - artifact/report read for shared links
  - plugin/MCP/config writes
- [ ] Add API:
  - `GET /api/auth/sessions`
  - `DELETE /api/auth/sessions/:id`
  - `GET /api/admin/audit?cursor=&limit=&actor=&project=&action=`
- [ ] Add device management UI:
  - current device marker
  - last seen
  - revoke other sessions
- [ ] Add admin audit UI:
  - filter by user/project/action/session
  - jump to session
  - export JSONL slice
- [ ] Keep secrets out of audit payloads:
  - no password text
  - no bearer token
  - no uploaded file content
  - no terminal command output in audit, only command metadata
- [ ] Verification:
  - Tests assert every write route emits an audit event.
  - Tests assert sensitive fields are redacted.

### Task 13: Add Product Observability and Diagnostics

**Files:**
- Create: `packages/codex-web/src/diagnostics.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/src/runtime.ts`
- Modify: `packages/codex-web/public/app.js`
- Test: `packages/codex-web/test/diagnostics.test.ts`
- Test: `packages/codex-web/test/server_auth.test.ts`

- [ ] Add API:
  - `GET /api/diagnostics/summary`
  - `GET /api/diagnostics/runtime`
  - `GET /api/diagnostics/storage`
  - `GET /api/diagnostics/providers`
- [ ] Diagnostics summary includes:
  - app version/build id
  - Node/npm/Codex CLI versions
  - service uptime
  - state directory path and writeability
  - auth configured
  - identity mode
  - report/artifact directory status
  - active turn count
  - terminal count
  - app-server connectivity
  - third-party provider mode detection when possible
- [ ] Provider diagnostics must treat official usage as optional:
  - `usageStatus: available | unavailable | unsupported`
  - `usageError` redacted and non-fatal
- [ ] Add admin diagnostics UI with copyable health report.
- [ ] Add JSON output suitable for support handoff.
- [ ] Verification:
  - Tests run diagnostics with missing usage auth and expect HTTP 200.

### Task 14: Add Automated Browser E2E and Launch QA

**Files:**
- Create: `packages/codex-web/test/e2e/remote_workbench.e2e.ts`
- Create: `packages/codex-web/test/e2e/mobile_pwa.e2e.ts`
- Create: `packages/codex-web/test/e2e/admin_security.e2e.ts`
- Modify: `packages/codex-web/package.json`
- Create: `docs/LAUNCH_QA.md`

- [ ] Add Playwright or Node browser automation dependency only if it can run
  reliably on the production target and CI/dev machines.
- [ ] Cover full launch flows:
  - first login
  - session create
  - running turn stream
  - simulated stream drop and reconnect
  - steering a running turn
  - approval action
  - workspace diff read
  - terminal command
  - artifact preview
  - skills/MCP list
  - admin creates project/user/role
  - role grant blocks unauthorized session read
  - share link read-only access
- [ ] Add mobile viewport tests at 390px width.
- [ ] Add desktop viewport tests at 1440px width.
- [ ] Add console error and failed network response capture.
- [ ] Add `npm run test:e2e --workspace packages/codex-web`.
- [ ] `docs/LAUNCH_QA.md` must include manual checks that automation cannot
  prove, including iOS PWA install and Android browser resume.
- [ ] Verification:
  - Unit tests, integration tests, UI harness tests, and E2E tests all pass
    before launch.

### Task 15: Add Backup, Restore, and Rollback Product Flows

**Files:**
- Create: `scripts/service/restore-codex-web-state.sh`
- Create: `scripts/service/rollback-codex-web-release.sh`
- Modify: `scripts/service/backup-codex-web-state.sh`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/HANDOVER.zh-CN.md`

- [ ] Backup script writes a manifest with:
  - timestamp
  - git commit
  - service env checksum
  - state archive checksum
  - source archive checksum
  - restore command
- [ ] Restore script supports dry-run and explicit backup path.
- [ ] Restore script refuses to run unless service is stopped or `--force` is
  supplied.
- [ ] Rollback script restores prior `/opt/codex-web` directory and restarts
  service.
- [ ] Document operator runbook:
  - pre-upgrade backup
  - upgrade
  - health check
  - rollback
  - post-rollback verification
- [ ] Verification:
  - Shell tests create temp source/state directories, back them up, mutate them,
    restore, and compare checksums.

## Engineering Milestone Order

1. Task 1: Stream recovery.
2. Task 2: Workspace live sync.
3. Task 3: Durable active turn state.
4. Task 4: Steering running turns.
5. Task 5: Remote commands.
6. Task 6: Workspace inspector.
7. Task 7: Skills/plugins/MCP/apps/config.
8. Task 8: Terminal/process monitor.
9. Task 9: Artifacts.
10. Task 10: Mobile/PWA polish.
11. Task 11: Linux ops hardening.
12. Task 12: Audit logs, device sessions, admin observability.
13. Task 13: Product observability and diagnostics.
14. Task 14: Automated browser E2E and launch QA.
15. Task 15: Backup, restore, and rollback product flows.

This is an engineering execution order, not a product release ladder. The
product is launch-ready only after Task 15 and all launch gates pass.

## Non-Goals

- Do not clone the full desktop app UI.
- Do not move Codex execution into the browser.
- Do not introduce a second agent runtime outside Codex app-server.
- Do not require official OpenAI login for third-party provider deployments.
- Do not expose unauthenticated app-server WebSockets to the public internet.

## Acceptance Criteria

The complete remote workbench is launch-ready when:

- A phone and desktop browser can watch and operate the same Codex session in real time.
- A running turn survives page refresh/background/foreground transitions without losing state.
- Another device can approve, stop, or steer a running turn.
- CLI-created threads can be discovered/resumed in Web, and Web-created threads remain normal Codex threads.
- The Web UI exposes effective model, permissions, cwd, goal, runtime status, skills, plugins, MCP, apps, and config diagnostics.
- Project status, git diff, changed files, terminal output, and artifacts are visible from the browser.
- Multi-user project grants protect all read/write/create/terminal/artifact actions.
- Third-party provider mode does not surface official account usage failures as task failures.
- The production upgrade path is documented and scriptable.
- Admins can review audit logs, revoke devices, inspect diagnostics, and export
  a redacted support report.
- Backup, restore, and rollback have been tested against a real state archive.
- Automated E2E and manual PWA launch QA have been run against the production
  deployment target.
