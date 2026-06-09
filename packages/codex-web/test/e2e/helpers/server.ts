import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createCodexWebServer, type CodexWebAuthLike, type CodexWebServerHandle } from '../../../src/server.js';
import type { CodexWebConfig } from '../../../src/config.js';
import type { CodexWebSession, CodexWebStartTurnResult } from '../../../src/runtime.js';
import type { CodexWebIdentityState } from '../../../src/identity_store.js';
import { CodexWebEventBus } from '../../../src/event_bus.js';

export interface FrontendE2eServer {
  baseUrl: string;
  stop(): Promise<void>;
}

export async function startFrontendE2eServer(): Promise<FrontendE2eServer> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-e2e-'));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-e2e-project-'));
  await fs.writeFile(path.join(projectDir, 'README.md'), '# E2E Artifact\n', 'utf8');
  await fs.mkdir(path.join(stateDir, 'reports', 'project-e2e'), { recursive: true });
  await fs.writeFile(path.join(stateDir, 'reports', 'project-e2e', 'summary.md'), '# E2E Summary\n', 'utf8');
  const eventBus = new CodexWebEventBus();
  const runtime = new FrontendE2eRuntime(eventBus, projectDir);
  const server = createCodexWebServer({
    auth: new FrontendE2eAuth(),
    runtime: runtime as any,
    config: createE2eConfig(stateDir, projectDir),
    identityStore: new FrontendE2eIdentityStore(projectDir),
  });
  await server.start();
  return {
    baseUrl: server.baseUrl.replace('0.0.0.0', '127.0.0.1'),
    async stop() {
      await stopServer(server);
      await fs.rm(stateDir, { recursive: true, force: true });
      await fs.rm(projectDir, { recursive: true, force: true });
    },
  };
}

function createE2eConfig(stateDir: string, defaultCwd: string): CodexWebConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    defaultCwd,
    codexBin: 'codex',
    stateDir,
    authPath: path.join(stateDir, 'auth.json'),
    reportsDir: path.join(stateDir, 'reports'),
    reportIndexPath: path.join(stateDir, 'report-index.json'),
    envPath: path.join(stateDir, 'service.env'),
    debug: false,
  };
}

async function stopServer(server: CodexWebServerHandle): Promise<void> {
  await server.stop();
}

class FrontendE2eAuth implements CodexWebAuthLike {
  private readonly token = 'e2e-token';

  async isConfigured(): Promise<boolean> {
    return true;
  }

  async login(): Promise<any> {
    return {
      token: this.token,
      session: this.session(),
      configuredNow: false,
    };
  }

  async verifyToken(token: string | null | undefined): Promise<any | null> {
    return token === this.token ? this.session() : null;
  }

  async logout(): Promise<void> {}

  private session(): any {
    return {
      id: 'auth_e2e',
      principal: {
        userId: 'user_e2e',
        username: 'guhai',
        roleIds: ['admin'],
        isAdmin: true,
        mode: 'single',
      },
    };
  }
}

class FrontendE2eIdentityStore {
  constructor(private readonly projectDir: string) {}

  async readState(): Promise<CodexWebIdentityState> {
    return {
      settings: {
        multiUserEnabled: false,
        siteTitle: 'Codex Web',
      },
      users: [],
      roles: [],
      projects: [
        {
          id: 'project_phone_hub',
          internalName: 'phone-hub',
          cwd: this.projectDir,
          displayName: 'phone hub',
          enabled: true,
          activeSessionLimit: null,
        },
      ],
      sessions: [],
      shares: [],
      userSessions: [],
    };
  }
}

class FrontendE2eRuntime {
  private readonly sessions = new Map<string, CodexWebSession>();

  private nextSession = 1;

  private nextTurn = 1;

  constructor(
    private readonly eventBus: CodexWebEventBus,
    private readonly projectDir: string,
  ) {
    const first = this.createSessionObject('session_existing', '现有会话', '已经可以从侧边栏打开');
    first.timeline = [
      { id: 'msg_existing_user', kind: 'message', role: 'user', text: '检查页面稳定性', createdAt: Date.now() - 10_000 } as any,
      { id: 'msg_existing_assistant', kind: 'message', role: 'assistant', text: '稳定性检查已准备。', createdAt: Date.now() - 9_000 } as any,
    ];
    this.sessions.set(first.id, first);
  }

  async listModels(): Promise<any[]> {
    return [{ id: 'gpt-5', name: 'gpt-5' }];
  }

  async readUsage(): Promise<any> {
    return null;
  }

  async listSessions(): Promise<CodexWebSession[]> {
    return [...this.sessions.values()].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  }

  async createSession(): Promise<CodexWebSession> {
    const id = `session_${this.nextSession++}`;
    const session = this.createSessionObject(id, `新对话 ${this.nextSession - 1}`, '');
    this.sessions.set(id, session);
    return session;
  }

  async readSession(sessionId: string): Promise<CodexWebSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async startTurn(sessionId: string, input: { text?: string }): Promise<CodexWebStartTurnResult> {
    const session = this.sessions.get(sessionId) ?? await this.createSession();
    const text = String(input.text || '').trim();
    const turnId = `turn_${this.nextTurn++}`;
    session.activeTurnId = turnId;
    session.lastKnownTurnStatus = 'running';
    session.updatedAt = Date.now();
    session.lastUserInput = text;
    session.lastInputAt = Date.now();
    session.preview = text;
    session.timeline.push({
      id: `user_${turnId}`,
      kind: 'message',
      role: 'user',
      text,
      createdAt: Date.now(),
    } as any);
    setTimeout(() => {
      this.eventBus.append(turnId, {
        type: 'message',
        role: 'assistant',
        text: '收到，正在处理。',
      } as any);
      this.eventBus.append(turnId, {
        type: 'turn.completed',
        status: 'completed',
      } as any);
      session.activeTurnId = null;
      session.lastKnownTurnStatus = 'completed';
      session.timeline.push({
        id: `assistant_${turnId}`,
        kind: 'message',
        role: 'assistant',
        text: '处理完成。',
        createdAt: Date.now(),
      } as any);
    }, 50);
    return {
      type: 'turn',
      turnId,
      session,
    } as any;
  }

  getTurnEvents(turnId: string, afterId?: string | number | null): any[] {
    return this.eventBus.list(turnId, afterId);
  }

  subscribeToTurn(turnId: string, onEvent: (event: any) => void): () => void {
    return this.eventBus.subscribe(turnId, onEvent);
  }

  async interruptTurn(): Promise<void> {}

  async resolveApproval(): Promise<void> {}

  async reloadRuntime(): Promise<any> {
    return { reloaded: true };
  }

  async listSkills(): Promise<any> {
    return { items: [], errors: [] };
  }

  async listPlugins(): Promise<any> {
    return { items: [], marketplaceLoadErrors: [] };
  }

  async listApps(): Promise<any[]> {
    return [];
  }

  async listMcpServerStatuses(): Promise<any[]> {
    return [];
  }

  private createSessionObject(id: string, title: string, preview: string): CodexWebSession {
    const now = Date.now();
    return {
      id,
      cwd: this.projectDir,
      projectName: 'phone hub',
      title,
      updatedAt: now,
      preview,
      firstUserInput: preview,
      lastUserInput: preview,
      lastInputAt: now,
      favorite: false,
      favoriteOrder: null,
      goal: null,
      activeTurnId: null,
      activeTurnRecoverable: false,
      lastKnownTurnStatus: null,
      settings: {},
      thread: { id, title, cwd: this.projectDir, updatedAt: now } as any,
      timeline: [],
    };
  }
}
