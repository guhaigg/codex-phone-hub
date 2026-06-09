import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexWebWorkspaceEventBus } from '../src/workspace_event_bus.js';

test('workspace event bus appends, replays after a cursor, and notifies subscribers', () => {
  const bus = new CodexWebWorkspaceEventBus({ maxEvents: 10 });
  const delivered: string[] = [];
  const unsubscribe = bus.subscribe((entry) => {
    delivered.push(`${entry.sequence}:${entry.event.type}`);
  });

  const created = bus.append({
    type: 'session.created',
    sessionId: 'app_1',
    threadId: 'thread_1',
    projectId: 'project_1',
    ownerUserId: 'user_1',
  });
  const started = bus.append({
    type: 'turn.started',
    sessionId: 'app_1',
    threadId: 'thread_1',
    turnId: 'turn_1',
    projectId: 'project_1',
    ownerUserId: 'user_1',
  });

  assert.equal(created.sequence, 1);
  assert.equal(started.sequence, 2);
  assert.equal(created.event.createdAt.length > 0, true);
  assert.deepEqual(delivered, ['1:session.created', '2:turn.started']);
  assert.deepEqual(bus.list(1).map((entry) => entry.event.type), ['turn.started']);

  unsubscribe();
  bus.append({ type: 'session.updated', sessionId: 'app_1', threadId: 'thread_1' });
  assert.deepEqual(delivered, ['1:session.created', '2:turn.started']);
});

test('workspace event bus bounds retained history', () => {
  const bus = new CodexWebWorkspaceEventBus({ maxEvents: 2 });

  bus.append({ type: 'session.created', sessionId: 'app_1' });
  bus.append({ type: 'session.updated', sessionId: 'app_1' });
  bus.append({ type: 'turn.completed', sessionId: 'app_1', turnId: 'turn_1' });

  assert.deepEqual(bus.list().map((entry) => entry.event.type), ['session.updated', 'turn.completed']);
  assert.deepEqual(bus.list('2').map((entry) => entry.event.type), ['turn.completed']);
});
