export type CodexWebWorkspaceEventType =
  | 'session.created'
  | 'session.updated'
  | 'session.archived'
  | 'session.unarchived'
  | 'session.favorite.updated'
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'report.updated';

export interface CodexWebWorkspaceEvent {
  type: CodexWebWorkspaceEventType;
  createdAt?: string;
  sessionId?: string | null;
  threadId?: string | null;
  turnId?: string | null;
  approvalId?: string | null;
  reportId?: string | null;
  projectId?: string | null;
  ownerUserId?: string | null;
  status?: string | null;
  details?: Record<string, unknown> | null;
}

export interface CodexWebStoredWorkspaceEvent {
  event: CodexWebWorkspaceEvent & { createdAt: string };
  sequence: number;
}

export type CodexWebWorkspaceEventListener = (storedEvent: CodexWebStoredWorkspaceEvent) => void;

export class CodexWebWorkspaceEventBus {
  private readonly maxEvents: number;

  private readonly history: CodexWebStoredWorkspaceEvent[] = [];

  private readonly listeners = new Set<CodexWebWorkspaceEventListener>();

  private nextSequence = 1;

  constructor({ maxEvents = 500 }: { maxEvents?: number } = {}) {
    this.maxEvents = maxEvents;
  }

  append(event: CodexWebWorkspaceEvent): CodexWebStoredWorkspaceEvent {
    const storedEvent: CodexWebStoredWorkspaceEvent = {
      event: {
        ...event,
        createdAt: event.createdAt ?? new Date().toISOString(),
      },
      sequence: this.nextSequence++,
    };
    this.history.push(storedEvent);
    if (this.history.length > this.maxEvents) {
      this.history.splice(0, this.history.length - this.maxEvents);
    }
    for (const listener of this.listeners) {
      listener(storedEvent);
    }
    return storedEvent;
  }

  list(afterId?: string | number | null): CodexWebStoredWorkspaceEvent[] {
    if (afterId === undefined || afterId === null || afterId === '') {
      return [...this.history];
    }
    const normalizedAfter = typeof afterId === 'number' ? afterId : Number(afterId);
    if (!Number.isFinite(normalizedAfter)) {
      return [...this.history];
    }
    return this.history.filter((entry) => entry.sequence > normalizedAfter);
  }

  subscribe(listener: CodexWebWorkspaceEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
