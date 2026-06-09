import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHelpCommandResult,
  formatGoalMessage,
  parseRemoteCommand,
} from '../src/remote_commands.js';

test('remote command parser recognizes status, model, permissions, and unsupported slash commands', () => {
  assert.deepEqual(parseRemoteCommand('/status'), { name: 'status', action: 'show' });
  assert.deepEqual(parseRemoteCommand('/model'), { name: 'model', action: 'show' });
  assert.deepEqual(parseRemoteCommand('/model gpt-5.5'), { name: 'model', action: 'set', model: 'gpt-5.5' });
  assert.deepEqual(parseRemoteCommand('/permissions'), { name: 'permissions', action: 'show' });
  assert.deepEqual(parseRemoteCommand('/permissions read-only'), {
    name: 'permissions',
    action: 'set',
    preset: 'read-only',
  });
  assert.deepEqual(parseRemoteCommand('/permissions sandbox workspace-write approval on-request'), {
    name: 'permissions',
    action: 'set',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
  });
  assert.deepEqual(parseRemoteCommand('/plan inspect workspace state'), {
    name: 'plan',
    action: 'switch',
    text: 'inspect workspace state',
  });
  assert.deepEqual(parseRemoteCommand('/resume thread_123'), {
    name: 'resume',
    action: 'resume',
    threadId: 'thread_123',
  });
  assert.deepEqual(parseRemoteCommand('/fork thread_123'), {
    name: 'fork',
    action: 'unsupported',
    threadId: 'thread_123',
  });
  assert.deepEqual(parseRemoteCommand('/mcp'), { name: 'mcp', action: 'show' });
  assert.deepEqual(parseRemoteCommand('/skills'), { name: 'skills', action: 'show' });
  assert.deepEqual(parseRemoteCommand('/plugins'), { name: 'plugins', action: 'show' });
  assert.deepEqual(parseRemoteCommand('/not-a-command'), {
    name: 'unknown',
    action: 'unsupported',
    command: '/not-a-command',
  });
});

test('remote command parser keeps normal prompts out of command handling', () => {
  assert.equal(parseRemoteCommand('please run /status in a doc'), null);
  assert.equal(parseRemoteCommand('goalish should be normal text'), null);
});

test('help command documents the remote workbench command set', () => {
  const result = createHelpCommandResult('/reports/help.md');

  assert.equal(result.command.name, 'help');
  assert.match(result.command.message, /\/status/u);
  assert.match(result.command.message, /\/model <id>/u);
  assert.match(result.command.message, /\/permissions/u);
  assert.match(result.command.message, /\/plan/u);
  assert.match(result.command.message, /\/resume <threadId>/u);
  assert.match(result.command.message, /\/fork <threadId>/u);
  assert.match(result.command.message, /\/mcp/u);
  assert.match(result.command.message, /\/skills/u);
  assert.match(result.command.message, /\/plugins/u);
});

test('goal message formatter reports unset and active goals', () => {
  assert.equal(formatGoalMessage(null), 'No goal is set.');
  assert.equal(formatGoalMessage({
    threadId: 'thread_1',
    objective: 'ship remote commands',
    status: 'active',
  }), 'Goal (active): ship remote commands');
});
