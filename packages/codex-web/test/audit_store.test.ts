import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileAuditStore } from '../src/audit_store.js';

test('audit store appends redacted jsonl events and pages newest entries first', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-audit-'));
  const auditPath = path.join(dir, 'audit-log.jsonl');
  const store = new FileAuditStore({ auditPath });

  await store.record({
    action: 'auth.login.success',
    actorUserId: 'local-admin',
    actorUsername: 'local',
    sessionId: 'device_1',
    metadata: {
      deviceName: 'iPhone',
      password: 'plain-password',
      token: 'cw_secret',
      nested: { bearerToken: 'secret-token', kept: 'ok' },
    },
  });
  await store.record({
    action: 'auth.logout',
    actorUserId: 'local-admin',
    actorUsername: 'local',
    sessionId: 'device_1',
    metadata: { reason: 'manual' },
  });

  const raw = await fs.readFile(auditPath, 'utf8');
  assert.equal(raw.includes('plain-password'), false);
  assert.equal(raw.includes('cw_secret'), false);
  assert.equal(raw.includes('secret-token'), false);

  const listed = await store.list({ limit: 1 });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0]?.action, 'auth.logout');
  assert.equal(listed.nextCursor, '1');
  assert.equal(listed.items[0]?.metadata.reason, 'manual');
});
