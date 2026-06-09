import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileActiveTurnStore } from '../src/active_turn_store.js';

test('file active turn store persists and reloads running turn records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-web-active-turns-'));
  try {
    const activeTurnsPath = path.join(dir, 'active-turns.json');
    const store = new FileActiveTurnStore({ activeTurnsPath });

    store.upsert({
      turnId: 'turn_1',
      threadId: 'thread_1',
      startedAt: 123,
      lastEventSequence: 4,
      lastKnownStatus: 'running',
      pendingApprovalIds: ['approval_1'],
    });

    const reloaded = new FileActiveTurnStore({ activeTurnsPath });
    assert.deepEqual(reloaded.get('turn_1'), {
      turnId: 'turn_1',
      threadId: 'thread_1',
      startedAt: 123,
      lastEventSequence: 4,
      lastKnownStatus: 'running',
      pendingApprovalIds: ['approval_1'],
    });
    assert.deepEqual(reloaded.listActive().map((record) => record.turnId), ['turn_1']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('file active turn store updates event cursors, approval ids, and terminal cleanup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-web-active-turns-'));
  try {
    const store = new FileActiveTurnStore({ activeTurnsPath: path.join(dir, 'active-turns.json') });
    store.upsert({
      turnId: 'turn_1',
      threadId: 'thread_1',
      startedAt: 123,
      lastEventSequence: 1,
      lastKnownStatus: 'running',
      pendingApprovalIds: [],
    });

    store.update('turn_1', {
      lastEventSequence: 7,
      lastKnownStatus: 'approval_pending',
      addPendingApprovalId: 'approval_1',
    });
    store.update('turn_1', {
      removePendingApprovalId: 'approval_1',
    });
    assert.deepEqual(store.get('turn_1'), {
      turnId: 'turn_1',
      threadId: 'thread_1',
      startedAt: 123,
      lastEventSequence: 7,
      lastKnownStatus: 'approval_pending',
      pendingApprovalIds: [],
    });

    store.markTerminal('turn_1', 'completed');
    assert.equal(store.get('turn_1'), null);
    assert.deepEqual(store.listActive(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
