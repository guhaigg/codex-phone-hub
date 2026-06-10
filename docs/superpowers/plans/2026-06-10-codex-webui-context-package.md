# Codex WebUI Context Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-ready context package feature that lets the user copy, insert, or start a new session from the current Codex workbench context.

**Architecture:** Add a small TypeScript builder for bounded Markdown context packages, expose it through authenticated session APIs, and wire compact UI buttons into existing chat/workspace tools without changing high-frequency render paths. The browser remains a control plane and the package contains only metadata and summaries.

**Tech Stack:** Node.js, TypeScript, vanilla JS frontend, existing workspace inspector, existing artifact store, existing audit store, Node test runner, Playwright E2E.

---

## Files

- Create: `packages/codex-web/src/context_package.ts`
- Create: `packages/codex-web/test/context_package.test.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/src/index.ts`
- Modify: `packages/codex-web/test/server_auth.test.ts`
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/public/styles.css`
- Modify: `packages/codex-web/test/public_ui.test.ts`
- Modify: `docs/HANDOVER.zh-CN.md`
- Modify: `docs/DEPLOYMENT.md`

## Task 1: Context Package Builder

- [x] Write a failing test in `packages/codex-web/test/context_package.test.ts` that builds a package from a session, workspace status, workspace diff, and artifacts.
- [x] Verify the test fails because `context_package.ts` does not exist.
- [x] Create `packages/codex-web/src/context_package.ts` with `buildSessionContextPackage(input)`.
- [x] Ensure the builder caps changed files to 40, diff files to 30, artifacts to 20.
- [x] Ensure Markdown excludes raw diff text, file contents, prompt transcript, terminal input, and terminal output.
- [x] Export package types from `packages/codex-web/src/index.ts`.
- [x] Run `npx tsx --test packages/codex-web/test/context_package.test.ts`.

## Task 2: Authenticated API Route

- [x] Write a failing server test in `packages/codex-web/test/server_auth.test.ts` for `GET /api/sessions/thread_1/context-package`.
- [x] Test should assert `200`, package markdown contains cwd/branch/files/artifacts, and audit includes `session.context_package.read`.
- [x] Test should assert audit metadata does not include raw markdown or secret-looking strings.
- [x] Modify `packages/codex-web/src/server.ts` to collect workspace status/diff and artifacts, then call `buildSessionContextPackage`.
- [x] Add a multi-user readable route branch using existing `resolveReadableWorkspaceAppSession` where practical.
- [x] Run targeted server tests.

## Task 3: Frontend Actions

- [x] Write a failing UI harness test in `packages/codex-web/test/public_ui.test.ts` for clicking a context package action.
- [x] Test should assert the API path is called and the existing `#prompt-input` element is reused.
- [x] Add `contextPackageLoading` state to `packages/codex-web/public/app.js`.
- [x] Render context package buttons in chat header, session tools, and workspace inspector.
- [x] Bind `[data-context-package-action]` to `handleContextPackageAction(action)`.
- [x] Implement actions:
  - `insert`: fetch package and append Markdown to composer;
  - `copy`: fetch package and copy Markdown;
  - `new`: fetch package, open new session, then prefill composer.
- [x] Keep composer focus with `setPromptDraft()` and avoid shell replacement while focused.
- [x] Add compact CSS for context package controls.
- [x] Run targeted UI test and `node --check packages/codex-web/public/app.js`.

## Task 4: Docs and Verification

- [x] Update `docs/HANDOVER.zh-CN.md` with endpoint, UI controls, and privacy boundary.
- [x] Update `docs/DEPLOYMENT.md` with context package route and audit note.
- [x] Run:

```bash
npx tsx --test packages/codex-web/test/context_package.test.ts
npx tsx --test packages/codex-web/test/server_auth.test.ts --test-name-pattern "context package"
npx tsx --test packages/codex-web/test/public_ui.test.ts --test-name-pattern "context package"
node --check packages/codex-web/public/app.js
npm test --workspaces --if-present
npm run typecheck --workspaces --if-present
npm run build --workspaces --if-present
npm run test:e2e --workspace packages/codex-web
git diff --check
```

## Task 5: Commit and Deploy

- [ ] Commit the implementation.
- [ ] Push `main`.
- [ ] SSH to production, create backup, pull, install, build, typecheck, test, restart service.
- [ ] Run production smoke checks.
- [ ] Report commit, backup path, verification output, and remaining follow-up ideas.
