import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const REDACTED = '[redacted]';

export interface CodexWebAuditRecordInput {
  action: string;
  actorUserId?: string | null;
  actorUsername?: string | null;
  sessionId?: string | null;
  targetSessionId?: string | null;
  targetUserId?: string | null;
  projectId?: string | null;
  codexSessionId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CodexWebAuditRecord extends CodexWebAuditRecordInput {
  id: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface CodexWebAuditListInput {
  cursor?: string | number | null;
  limit?: string | number | null;
  actor?: string | null;
  project?: string | null;
  action?: string | null;
}

export interface CodexWebAuditListResult {
  items: CodexWebAuditRecord[];
  nextCursor: string | null;
}

export class FileAuditStore {
  private readonly auditPath: string;

  private mutationLock: Promise<void> = Promise.resolve();

  constructor({ auditPath }: { auditPath: string }) {
    this.auditPath = auditPath;
  }

  async record(input: CodexWebAuditRecordInput): Promise<CodexWebAuditRecord> {
    const record: CodexWebAuditRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action: normalizeRequiredString(input.action, 'audit action'),
      actorUserId: normalizeOptionalString(input.actorUserId),
      actorUsername: normalizeOptionalString(input.actorUsername),
      sessionId: normalizeOptionalString(input.sessionId),
      targetSessionId: normalizeOptionalString(input.targetSessionId),
      targetUserId: normalizeOptionalString(input.targetUserId),
      projectId: normalizeOptionalString(input.projectId),
      codexSessionId: normalizeOptionalString(input.codexSessionId),
      metadata: sanitizeMetadata(input.metadata),
    };
    await this.withMutationLock(async () => {
      await fs.mkdir(path.dirname(this.auditPath), { recursive: true, mode: 0o700 });
      await fs.appendFile(this.auditPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      await fs.chmod(this.auditPath, 0o600).catch(() => {});
    });
    return record;
  }

  async list(input: CodexWebAuditListInput = {}): Promise<CodexWebAuditListResult> {
    const all = await this.readAll();
    const start = normalizeCursor(input.cursor);
    const limit = normalizeLimit(input.limit);
    const actor = normalizeOptionalString(input.actor);
    const project = normalizeOptionalString(input.project);
    const action = normalizeOptionalString(input.action);
    const filtered = all
      .filter((record) => !actor || record.actorUserId === actor || record.actorUsername === actor)
      .filter((record) => !project || record.projectId === project)
      .filter((record) => !action || record.action === action)
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
    const items = filtered.slice(start, start + limit);
    const nextOffset = start + items.length;
    return {
      items,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
    };
  }

  private async readAll(): Promise<CodexWebAuditRecord[]> {
    try {
      const raw = await fs.readFile(this.auditPath, 'utf8');
      return raw
        .split(/\r?\n/u)
        .filter((line) => line.trim().length > 0)
        .map((line) => normalizeRecordOrNull(line))
        .filter((record): record is CodexWebAuditRecord => record !== null);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.mutationLock;
    let release!: () => void;
    this.mutationLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(value);
  return isRecord(sanitized) ? sanitized : {};
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    next[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(child);
  }
  return next;
}

function isSensitiveKey(key: string): boolean {
  return /password|token|secret|authorization|cookie|credential|bearer/iu.test(key);
}

function normalizeRecordOrNull(line: string): CodexWebAuditRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed) || typeof parsed.id !== 'string' || typeof parsed.timestamp !== 'string' || typeof parsed.action !== 'string') {
      return null;
    }
    return {
      id: parsed.id,
      timestamp: parsed.timestamp,
      action: parsed.action,
      actorUserId: normalizeOptionalString(parsed.actorUserId),
      actorUsername: normalizeOptionalString(parsed.actorUsername),
      sessionId: normalizeOptionalString(parsed.sessionId),
      targetSessionId: normalizeOptionalString(parsed.targetSessionId),
      targetUserId: normalizeOptionalString(parsed.targetUserId),
      projectId: normalizeOptionalString(parsed.projectId),
      codexSessionId: normalizeOptionalString(parsed.codexSessionId),
      metadata: sanitizeMetadata(parsed.metadata),
    };
  } catch {
    return null;
  }
}

function normalizeCursor(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeLimit(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
