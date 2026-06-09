# Mobile E2E Verification

This checklist covers the phone-first flows that are most likely to regress
when changing the vanilla frontend.

## Target viewport

- Mobile width around `390px`
- Touch-capable browser context
- Logged-in admin user for management flows

## Critical flows

1. Login
   - Open the app URL.
   - Submit valid credentials.
   - Verify recent sessions or the workspace appears.
2. New session
   - Open the new session sheet.
   - Select project, model, reasoning effort, sandbox mode, approval policy,
     collaboration mode, and personality.
   - Create the session and verify the backend receives those settings.
3. Settings page
   - Open Settings from bottom navigation.
   - Open every `select` control.
   - Verify the control stays focused and the DOM node is not replaced while
     the dropdown is open.
4. Admin users
   - Create/edit a user.
   - Toggle enabled state.
   - Save and reload to verify persistence.
5. Admin roles
   - Create/edit a role.
   - Toggle project grant flags independently:
     `canRead`, `canCreate`, `canWrite`.
   - Save and reload to verify the flags stay independent.
6. Reports
   - Open report list.
   - Open a Markdown or HTML report.
   - Toggle favorite state.

## Regression checks for mobile dropdown stability

When a `select`, `input`, or `textarea` is active:

- Background refresh must not replace the active form control.
- `visibilitychange` must not force a full render that closes the dropdown.
- Cross-page prefetch must not rebuild unrelated admin/settings DOM.

Expected browser-console result:

```text
console errors: []
badResponses: []
settings select: sameNode=true, activeAfter=true
admin role select: sameNode=true, activeAfter=true
```

## Suggested local commands

```bash
npm run typecheck --workspace packages/codex-web
npm test --workspace packages/codex-web -- --test-name-pattern "public UI|admin|settings"
```
