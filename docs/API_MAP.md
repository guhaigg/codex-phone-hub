# Codex Phone Hub API Map

This document maps the mobile UI actions to the backend API and the Codex
runtime bridge. It is intended as a maintenance checklist before changing
frontend controls.

## Verified runtime chain

- `POST /api/sessions`
  - Backend path: `server.ts` -> `runtime.createSession()` -> `client.startThread()`
  - Passes session options including `cwd`, `model`, `sandboxMode`, and
    `approvalPolicy`.
- `POST /api/sessions/:id/turns`
  - Backend path: `server.ts` -> `runtime.startTurn()` -> `client.startTurn()`
  - Passes turn options including `cwd`, `model`, `effort`, `personality`,
    `sandboxMode`, `approvalPolicy`, `collaborationMode`, attachments, and
    developer instructions.
- `POST /api/turns/:id/interrupt`
  - Backend path: `runtime.interruptTurn()` -> `client.interruptTurn()`.
- `GET /api/turns/:id/events`
  - Server-sent event stream from the runtime event bus.
- `POST /api/approvals/:id/accept`
  - Resolves an approval request once.
- `POST /api/approvals/:id/accept-for-session`
  - Resolves an approval request and stores the session-scoped approval mode.
- `POST /api/approvals/:id/deny`
  - Denies an approval request.

## UI action map

| UI action | API | Runtime or persistence effect |
| --- | --- | --- |
| Login | `POST /api/auth/login` | Creates an authenticated browser session. |
| Current user | `GET /api/auth/me` | Restores auth session and principal. |
| List sessions | `GET /api/sessions` | Reads Codex thread summaries. |
| Create session | `POST /api/sessions` | Starts a real Codex thread with cwd/settings. |
| Read session | `GET /api/sessions/:id` | Reads Codex thread timeline. |
| Save session settings | `PATCH /api/sessions/:id/settings` | Persists per-session runtime settings. |
| Upload attachments | `POST /api/sessions/:id/attachments` | Stores files under the project/state upload area. |
| Send task | `POST /api/sessions/:id/turns` | Starts a real Codex turn. |
| Stream output | `GET /api/turns/:id/events` | Receives work, message, approval, and error events. |
| Stop task | `POST /api/turns/:id/interrupt` | Interrupts the active Codex turn. |
| Approval decision | `POST /api/approvals/:id/...` | Resolves a Codex approval request. |
| Reports list/content | `GET /api/reports`, `GET /api/reports/:id/content` | Reads the local report store. |
| Favorite report | `PATCH /api/reports/:id/favorite` | Writes the report index. |
| Runtime reload | `POST /api/runtime/reload` | Reloads MCP servers when supported. |
| Admin projects | `GET/POST/PATCH /api/admin/projects` | Reads/writes identity project state. |
| Admin users | `GET/POST/PATCH/DELETE /api/admin/users` | Reads/writes identity users. |
| Admin roles | `GET/POST /api/admin/roles` | Reads/writes identity roles and project grants. |
| Multi-user setting | `GET/PATCH /api/admin/settings` | Toggles identity/auth mode settings. |

## RBAC notes

Role project grants preserve independent boolean flags:

- `canRead`
- `canCreate`
- `canWrite`

Do not collapse these flags to a single truthy grant in future migrations or
normalization code.
