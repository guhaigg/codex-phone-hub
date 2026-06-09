import fs from 'node:fs';
import path from 'node:path';

export interface CodexWebActiveTurnRecord {
  turnId: string;
  threadId: string;
  startedAt: number;
  lastEventSequence: number | null;
  lastKnownStatus: string;
  pendingApprovalIds: string[];
}

export interface CodexWebActiveTurnUpdate {
  lastEventSequence?: number | null;
  lastKnownStatus?: string;
  addPendingApprovalId?: string | null;
  removePendingApprovalId?: string | null;
}

export interface CodexWebActiveTurnStore {
  get(turnId: string): CodexWebActiveTurnRecord | null;
  findByThreadId(threadId: string): CodexWebActiveTurnRecord | null;
  listActive(): CodexWebActiveTurnRecord[];
  upsert(record: CodexWebActiveTurnRecord): void;
  update(turnId: string, patch: CodexWebActiveTurnUpdate): void;
  markTerminal(turnId: string, status: string): void;
  delete(turnId: string): void;
}

interface ActiveTurnsFile {
  version: 1;
  activeTurns: Record<string, CodexWebActiveTurnRecord>;
}

export class FileActiveTurnStore implements CodexWebActiveTurnStore {
  private readonly activeTurnsPath: string;

  private cache: ActiveTurnsFile | null = null;

  constructor({ activeTurnsPath }: { activeTurnsPath: string }) {
    this.activeTurnsPath = activeTurnsPath;
  }

  get(turnId: string): CodexWebActiveTurnRecord | null {
    return normalizeRecord(this.read().activeTurns[turnId]);
  }

  findByThreadId(threadId: string): CodexWebActiveTurnRecord | null {
    return this.listActive().find((record) => record.threadId === threadId) ?? null;
  }

  listActive(): CodexWebActiveTurnRecord[] {
    return Object.values(this.read().activeTurns)
      .map(normalizeRecord)
      .filter((record): record is CodexWebActiveTurnRecord => record !== null)
      .sort((left, right) => left.startedAt - right.startedAt || left.turnId.localeCompare(right.turnId));
  }

  upsert(record: CodexWebActiveTurnRecord): void {
    const normalized = normalizeRecord(record);
    if (!normalized) {
      return;
    }
    const file = this.read();
    file.activeTurns[normalized.turnId] = normalized;
    this.write(file);
  }

  update(turnId: string, patch: CodexWebActiveTurnUpdate): void {
    const current = this.get(turnId);
    if (!current) {
      return;
    }
    const pendingApprovalIds = new Set(current.pendingApprovalIds);
    const addApprovalId = normalizeOptionalString(patch.addPendingApprovalId);
    if (addApprovalId) {
      pendingApprovalIds.add(addApprovalId);
    }
    const removeApprovalId = normalizeOptionalString(patch.removePendingApprovalId);
    if (removeApprovalId) {
      pendingApprovalIds.delete(removeApprovalId);
    }
    this.upsert({
      ...current,
      lastEventSequence: Object.prototype.hasOwnProperty.call(patch, 'lastEventSequence')
        ? normalizeSequence(patch.lastEventSequence)
        : current.lastEventSequence,
      lastKnownStatus: normalizeOptionalString(patch.lastKnownStatus) || current.lastKnownStatus,
      pendingApprovalIds: [...pendingApprovalIds].sort(),
    });
  }

  markTerminal(turnId: string, _status: string): void {
    this.delete(turnId);
  }

  delete(turnId: string): void {
    const file = this.read();
    if (!(turnId in file.activeTurns)) {
      return;
    }
    delete file.activeTurns[turnId];
    this.write(file);
  }

  private read(): ActiveTurnsFile {
    if (this.cache) {
      return this.cache;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.activeTurnsPath, 'utf8')) as Partial<ActiveTurnsFile>;
      this.cache = {
        version: 1,
        activeTurns: isRecord(parsed.activeTurns)
          ? Object.fromEntries(
            Object.entries(parsed.activeTurns)
              .map(([turnId, record]) => [turnId, normalizeRecord({ ...(record as unknown as Record<string, unknown>), turnId })])
              .filter((entry): entry is [string, CodexWebActiveTurnRecord] => entry[1] !== null),
          )
          : {},
      };
    } catch {
      this.cache = { version: 1, activeTurns: {} };
    }
    return this.cache;
  }

  private write(file: ActiveTurnsFile): void {
    fs.mkdirSync(path.dirname(this.activeTurnsPath), { recursive: true, mode: 0o700 });
    const tmpPath = `${this.activeTurnsPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmpPath, this.activeTurnsPath);
    this.cache = file;
  }
}

function normalizeRecord(value: unknown): CodexWebActiveTurnRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const turnId = normalizeOptionalString(value.turnId);
  const threadId = normalizeOptionalString(value.threadId);
  if (!turnId || !threadId) {
    return null;
  }
  return {
    turnId,
    threadId,
    startedAt: Number.isFinite(value.startedAt) ? Number(value.startedAt) : Date.now(),
    lastEventSequence: normalizeSequence(value.lastEventSequence),
    lastKnownStatus: normalizeOptionalString(value.lastKnownStatus) || 'running',
    pendingApprovalIds: normalizeStringArray(value.pendingApprovalIds),
  };
}

function normalizeSequence(value: unknown): number | null {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map(normalizeOptionalString).filter(Boolean))].sort();
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
