import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export type CodexWebTerminalStatus = 'running' | 'completed' | 'failed' | 'stopped';

export type CodexWebTerminalEvent =
  | {
    type: 'started';
    command: string;
    cwd: string;
    terminalId: string;
    sessionId: string;
    threadId?: string | null;
    appSessionId?: string | null;
    projectId?: string | null;
    ownerUserId?: string | null;
    startedAt: number;
  }
  | {
    type: 'output';
    stream: 'stdout' | 'stderr';
    text: string;
    at: number;
  }
  | {
    type: 'exit';
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    status: CodexWebTerminalStatus;
    at: number;
  }
  | {
    type: 'error';
    message: string;
    at: number;
  }
  | {
    type: 'input';
    bytes: number;
    at: number;
  };

export interface CodexWebStoredTerminalEvent {
  sequence: number;
  event: CodexWebTerminalEvent;
}

export interface CodexWebTerminalSummary {
  id: string;
  sessionId: string;
  threadId: string | null;
  appSessionId: string | null;
  projectId: string | null;
  ownerUserId: string | null;
  cwd: string;
  command: string;
  status: CodexWebTerminalStatus;
  startedAt: number;
  updatedAt: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface StartTerminalInput {
  sessionId: string;
  threadId?: string | null;
  appSessionId?: string | null;
  projectId?: string | null;
  ownerUserId?: string | null;
  cwd: string;
  command: string;
  rootCwd?: string | null;
}

type TerminalListener = (entry: CodexWebStoredTerminalEvent) => void;

interface TerminalRecord extends CodexWebTerminalSummary {
  process: ChildProcessWithoutNullStreams | null;
  events: CodexWebStoredTerminalEvent[];
  listeners: Set<TerminalListener>;
  nextSequence: number;
  stopRequested: boolean;
}

export class TerminalManagerError extends Error {
  readonly code: string;

  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'TerminalManagerError';
    this.code = code;
    this.status = status;
  }
}

export class CodexWebTerminalManager {
  private readonly maxEventsPerTerminal: number;

  private readonly terminals = new Map<string, TerminalRecord>();

  constructor({ maxEventsPerTerminal = 1000 }: { maxEventsPerTerminal?: number } = {}) {
    this.maxEventsPerTerminal = Math.max(10, Math.floor(maxEventsPerTerminal));
  }

  async start(input: StartTerminalInput): Promise<CodexWebTerminalSummary> {
    const command = String(input.command || '').trim();
    if (!command) {
      throw new TerminalManagerError('terminal_command_required', 'command is required', 400);
    }
    const cwd = await resolveAllowedCwd(input.cwd, input.rootCwd || input.cwd);
    const id = `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();
    const record: TerminalRecord = {
      id,
      sessionId: String(input.sessionId || ''),
      threadId: normalizeOptionalString(input.threadId) || null,
      appSessionId: normalizeOptionalString(input.appSessionId) || null,
      projectId: normalizeOptionalString(input.projectId) || null,
      ownerUserId: normalizeOptionalString(input.ownerUserId) || null,
      cwd,
      command,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      exitCode: null,
      signal: null,
      process: null,
      events: [],
      listeners: new Set(),
      nextSequence: 1,
      stopRequested: false,
    };
    this.terminals.set(id, record);
    this.append(record, {
      type: 'started',
      command,
      cwd,
      terminalId: id,
      sessionId: record.sessionId,
      threadId: record.threadId,
      appSessionId: record.appSessionId,
      projectId: record.projectId,
      ownerUserId: record.ownerUserId,
      startedAt: now,
    });

    const child = spawn(shellPath(), ['-lc', command], {
      cwd,
      env: process.env,
      stdio: 'pipe',
    });
    record.process = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.append(record, {
      type: 'output',
      stream: 'stdout',
      text: String(chunk),
      at: Date.now(),
    }));
    child.stderr.on('data', (chunk) => this.append(record, {
      type: 'output',
      stream: 'stderr',
      text: String(chunk),
      at: Date.now(),
    }));
    child.once('error', (error) => {
      record.status = 'failed';
      record.updatedAt = Date.now();
      this.append(record, {
        type: 'error',
        message: error.message,
        at: Date.now(),
      });
    });
    child.once('exit', (code, signal) => {
      record.process = null;
      record.exitCode = code;
      record.signal = signal;
      record.status = record.stopRequested
        ? 'stopped'
        : code === 0
          ? 'completed'
          : 'failed';
      record.updatedAt = Date.now();
      this.append(record, {
        type: 'exit',
        exitCode: code,
        signal,
        status: record.status,
        at: record.updatedAt,
      });
    });

    return this.summary(record);
  }

  list({ sessionId }: { sessionId?: string | null } = {}): CodexWebTerminalSummary[] {
    const normalizedSessionId = String(sessionId || '');
    return [...this.terminals.values()]
      .filter((record) => !normalizedSessionId || record.sessionId === normalizedSessionId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((record) => this.summary(record));
  }

  get(terminalId: string): CodexWebTerminalSummary | null {
    const record = this.terminals.get(terminalId);
    return record ? this.summary(record) : null;
  }

  getEvents(terminalId: string, afterId?: string | number | null): CodexWebStoredTerminalEvent[] {
    const record = this.requireTerminal(terminalId);
    if (afterId === undefined || afterId === null || afterId === '') {
      return [...record.events];
    }
    const sequence = typeof afterId === 'number' ? afterId : Number(afterId);
    if (!Number.isFinite(sequence)) {
      return [...record.events];
    }
    return record.events.filter((entry) => entry.sequence > sequence);
  }

  subscribe(terminalId: string, listener: TerminalListener): () => void {
    const record = this.requireTerminal(terminalId);
    record.listeners.add(listener);
    return () => {
      record.listeners.delete(listener);
    };
  }

  writeInput(terminalId: string, data: string): void {
    const record = this.requireTerminal(terminalId);
    if (record.status !== 'running' || !record.process?.stdin.writable) {
      throw new TerminalManagerError('terminal_not_running', 'terminal is not running', 409);
    }
    record.process.stdin.write(data);
    this.append(record, {
      type: 'input',
      bytes: Buffer.byteLength(data),
      at: Date.now(),
    });
  }

  async stop(terminalId: string): Promise<CodexWebTerminalSummary> {
    const record = this.requireTerminal(terminalId);
    if (record.status !== 'running' || !record.process) {
      return this.summary(record);
    }
    record.stopRequested = true;
    record.process.kill('SIGTERM');
    setTimeout(() => {
      if (record.process && record.status === 'running') {
        record.process.kill('SIGKILL');
      }
    }, 2000).unref?.();
    return this.summary(record);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.terminals.keys()].map((terminalId) => this.stop(terminalId).catch(() => null)));
  }

  private requireTerminal(terminalId: string): TerminalRecord {
    const record = this.terminals.get(terminalId);
    if (!record) {
      throw new TerminalManagerError('terminal_not_found', 'terminal not found', 404);
    }
    return record;
  }

  private append(record: TerminalRecord, event: CodexWebTerminalEvent): CodexWebStoredTerminalEvent {
    record.updatedAt = Date.now();
    const entry = {
      sequence: record.nextSequence++,
      event,
    };
    record.events.push(entry);
    if (record.events.length > this.maxEventsPerTerminal) {
      record.events.splice(0, record.events.length - this.maxEventsPerTerminal);
    }
    for (const listener of record.listeners) {
      listener(entry);
    }
    return entry;
  }

  private summary(record: TerminalRecord): CodexWebTerminalSummary {
    return {
      id: record.id,
      sessionId: record.sessionId,
      threadId: record.threadId,
      appSessionId: record.appSessionId,
      projectId: record.projectId,
      ownerUserId: record.ownerUserId,
      cwd: record.cwd,
      command: record.command,
      status: record.status,
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
      exitCode: record.exitCode,
      signal: record.signal,
    };
  }
}

async function resolveAllowedCwd(cwd: string, rootCwd: string): Promise<string> {
  const root = await realDirectory(rootCwd);
  const target = await realDirectory(cwd);
  const relative = path.relative(root, target);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return path.resolve(String(cwd || ''));
  }
  throw new TerminalManagerError('terminal_cwd_forbidden', 'terminal cwd must stay inside the project cwd', 403);
}

async function realDirectory(value: string): Promise<string> {
  const resolved = await fs.realpath(path.resolve(String(value || '')));
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new TerminalManagerError('terminal_cwd_not_found', 'terminal cwd is not a directory', 404);
  }
  return resolved;
}

function shellPath(): string {
  return process.env.SHELL || '/bin/sh';
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
