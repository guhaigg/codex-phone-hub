import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CodexWebTerminalManager, TerminalManagerError } from '../src/terminal_manager.js';

test('terminal manager runs a command and stores bounded output history', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-terminal-'));
  const manager = new CodexWebTerminalManager({ maxEventsPerTerminal: 4 });

  const terminal = await manager.start({
    sessionId: 'session_1',
    cwd,
    command: `${process.execPath} -e "console.log('hello'); console.error('warn')"`,
  });
  await waitForExit(manager, terminal.id);

  const events = manager.getEvents(terminal.id);
  assert.equal(events.at(-1)?.event.type, 'exit');
  assert.equal(events.at(-1)?.event.exitCode, 0);
  assert.ok(events.some((entry) => entry.event.type === 'output' && entry.event.stream === 'stdout' && entry.event.text.includes('hello')));
  assert.ok(events.some((entry) => entry.event.type === 'output' && entry.event.stream === 'stderr' && entry.event.text.includes('warn')));
  assert.ok(events.length <= 4);

  await fs.rm(cwd, { recursive: true, force: true });
});

test('terminal manager rejects cwd outside the allowed project root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-terminal-root-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-terminal-outside-'));
  const manager = new CodexWebTerminalManager();

  await assert.rejects(
    manager.start({
      sessionId: 'session_1',
      rootCwd: root,
      cwd: outside,
      command: 'pwd',
    }),
    (error: unknown) => {
      assert.ok(error instanceof TerminalManagerError);
      assert.equal(error.code, 'terminal_cwd_forbidden');
      assert.equal(error.status, 403);
      return true;
    },
  );

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

test('terminal manager can write stdin and stop a running command', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-terminal-stdin-'));
  const manager = new CodexWebTerminalManager();

  const terminal = await manager.start({
    sessionId: 'session_1',
    cwd,
    command: `${process.execPath} -e "process.stdin.on('data', d => { console.log('in:' + d.toString().trim()) })"`,
  });
  manager.writeInput(terminal.id, 'ping\n');
  await waitForOutput(manager, terminal.id, 'in:ping');
  await manager.stop(terminal.id);
  await waitForExit(manager, terminal.id);

  const summary = manager.get(terminal.id);
  assert.equal(summary?.status, 'stopped');

  await fs.rm(cwd, { recursive: true, force: true });
});

async function waitForExit(manager: CodexWebTerminalManager, terminalId: string): Promise<void> {
  await waitForCondition(() => manager.get(terminalId)?.status !== 'running');
}

async function waitForOutput(manager: CodexWebTerminalManager, terminalId: string, text: string): Promise<void> {
  await waitForCondition(() => manager.getEvents(terminalId).some((entry) => (
    entry.event.type === 'output' && entry.event.text.includes(text)
  )));
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('timed out waiting for terminal condition');
}
