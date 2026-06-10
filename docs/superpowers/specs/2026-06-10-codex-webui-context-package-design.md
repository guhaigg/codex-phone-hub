# Codex WebUI Context Package Design

## Goal

Add a mobile-friendly "context package" feature to Codex Phone Hub so the user can copy, insert, or start a new conversation from the current session's working context.

## External References

- `friuns2/codexui`: browser-accessible Codex app UI, mobile access, hold-to-dictate, project ZIP export/import, and third-party provider mode that does not require `codex login`.
- `siteboon/claudecodeui`: responsive agent UI with chat, terminal, file explorer, Git explorer, session management, and plugin surface for Claude Code, Cursor CLI, Codex, and Gemini CLI.
- `johannesjo/parallel-code`: parallel agent/worktree task model, diff review, phone monitoring, focused task views, and progress tracking.

We will borrow product patterns, not source code. This keeps the implementation aligned with our existing Node/TypeScript/vanilla JS stack and avoids license or maintenance coupling.

## Product Decision

The next useful addition is not another broad page. The current product already has sessions, workspace status, terminal, artifacts, diagnostics, devices, and audit. The missing connective feature is a clean handoff primitive:

- continue the same task from another device;
- start a fresh session using the current repo state;
- paste a concise status packet into Codex without manually collecting branch, dirty files, artifacts, and cwd;
- keep the browser as a remote control plane rather than a second agent runtime.

## Context Package Contents

The package is Markdown plus structured metadata. It includes:

- generated time;
- session id, title, project id, cwd, model/reasoning/sandbox/approval/collaboration settings;
- active turn id and recoverability flag when present;
- Git branch, upstream, last commit, writable state, dirty counts;
- changed file list with staged/unstaged/untracked markers, capped to 40 entries;
- diff summary by file and hunk count, capped to 30 files;
- artifact list with kind, source, display path, size, favorite flag, capped to 20 entries;
- a short continuation instruction telling Codex to read files/diff before assuming content.

The package does not include:

- Web password, bearer token, cookies, provider secrets;
- full prompt transcript or assistant output;
- full raw diff;
- file contents;
- terminal input/output.

## Backend Architecture

Create `packages/codex-web/src/context_package.ts`.

Responsibilities:

- accept a runtime session, optional workspace status, optional workspace diff, and optional artifacts;
- normalize unknown session shapes defensively;
- produce structured summary fields and bounded Markdown;
- expose caps as constants for tests.

Add `GET /api/sessions/:sessionId/context-package`.

Flow:

1. Authenticate through existing bearer auth.
2. Read session from runtime.
3. If the session has cwd, collect workspace status and diff using existing inspector helpers.
4. List artifacts using the existing artifact store.
5. Build package.
6. Audit `session.context_package.read` with only counts and booleans.
7. Return `{ package }`.

Multi-user compatibility can use the existing readable app-session resolver, but the UI stays personal. If a project cwd is known, prefer it over runtime cwd.

## Frontend Architecture

Use existing stable render paths in `packages/codex-web/public/app.js`.

Add:

- `contextPackageLoading` state flag;
- buttons in the chat header and session tools:
  - insert context package into composer;
  - copy context package;
  - start new session with context package;
- helper `loadSessionContextPackage()`;
- helper `handleContextPackageAction(action)`.

Interaction constraints:

- inserting into the focused composer must use `setPromptDraft()` and must not rebuild the shell;
- copying uses existing `copyText()`;
- starting a new session calls `openNewSession()`, then fills the composer with the package;
- failures set `state.notice` / `state.error` and release loading state.

## UI Direction

Keep the existing refined notebook/workbench style. This is a professional operations control, not a marketing screen.

The feature should appear as compact controls:

- chat header icon button: "交接包";
- session tools row: "插入交接包", "复制交接包", "新会话继续";
- workspace inspector header mini button: "交接包".

No modal is required for v1. The output is a composer-ready Markdown packet.

## Testing

Add or update tests:

- pure builder test: caps lists, formats workspace/artifacts, excludes raw diff and file contents;
- server route test: returns package and records audit without leaking secrets;
- frontend harness test: clicking insert fetches package and updates the existing composer node;
- syntax/type/build/e2e verification before deployment.

## Rollout

Deploy to production after local verification. The production smoke check remains:

```bash
systemctl is-active codex-web.service
git -C /opt/codex-web rev-parse --short HEAD
curl -sS -I https://cockpit.codexgu.website/ | head -n 1
```
