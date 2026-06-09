import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CodexWebConfig } from './config.js';
import type { CodexWebIdentityState } from './identity_store.js';

export interface DiagnosticsCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type DiagnosticsCommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
) => Promise<DiagnosticsCommandResult>;

export interface CollectDiagnosticsSummaryInput {
  config: CodexWebConfig;
  authConfigured: boolean;
  identityState?: CodexWebIdentityState | null;
  runtime: {
    listModels?: () => Promise<unknown[]>;
    readUsage?: () => Promise<unknown>;
    getActiveTurnCount?: () => number;
  };
  terminalCount?: number;
  serviceName?: string;
  backupRoot?: string;
  rebootRequiredPath?: string;
  rebootRequiredPackagesPath?: string;
  runCommand?: DiagnosticsCommandRunner;
}

export interface DiagnosticsPathStatus {
  path: string;
  exists: boolean;
  kind: 'file' | 'directory' | 'missing' | 'other';
  writable: boolean | null;
  error?: string;
}

export interface DiagnosticsSummary {
  checkedAt: string;
  version: { gitCommit: string | null; buildId: string | null };
  versions: { node: string; npm: string | null; codex: string | null };
  process: { pid: number; uptimeSeconds: number; cwd: string };
  auth: { configured: boolean };
  identity: { mode: 'single' | 'multi'; users: number; projects: number; sessions: number };
  runtime: { activeTurnCount: number | null; terminalCount: number };
  provider: {
    status: string;
    models: {
      status: string;
      count: number;
      items: Array<Record<string, unknown>>;
      error?: string;
    };
    usage: {
      status: 'available' | 'unavailable' | 'unsupported';
      available: boolean;
      required: false;
      message: string;
      error?: string;
    };
  };
  service: { name: string; active: boolean | null; enabled: boolean | null; status: string };
  system: {
    platform: NodeJS.Platform;
    release: string;
    arch: string;
    reboot: { required: boolean; packages: string[] };
    upgrades: { status: 'available' | 'current' | 'unknown'; count: number | null };
    disk: { path: string; availableBytes: number | null; usedPercent: number | null; status: 'ok' | 'unknown' };
  };
  storage: {
    stateDir: DiagnosticsPathStatus;
    reportsDir: DiagnosticsPathStatus;
    defaultCwd: DiagnosticsPathStatus;
    authPath: DiagnosticsPathStatus;
    envPath: DiagnosticsPathStatus;
  };
  backup: {
    root: string;
    exists: boolean;
    latest: { name: string; path: string; modifiedAt: string } | null;
  };
}

export async function collectDiagnosticsSummary({
  config,
  authConfigured,
  identityState = null,
  runtime,
  terminalCount = 0,
  serviceName = process.env.CODEX_WEB_SERVICE_NAME || 'codex-web.service',
  backupRoot = path.join(process.cwd(), 'backups'),
  rebootRequiredPath = '/var/run/reboot-required',
  rebootRequiredPackagesPath = '/var/run/reboot-required.pkgs',
  runCommand = defaultDiagnosticsCommandRunner,
}: CollectDiagnosticsSummaryInput): Promise<DiagnosticsSummary> {
  const [versions, provider, service, system, storage, backup] = await Promise.all([
    collectVersions(config, runCommand),
    collectProviderDiagnostics(runtime),
    collectServiceDiagnostics(serviceName, runCommand),
    collectSystemDiagnostics({ stateDir: config.stateDir, rebootRequiredPath, rebootRequiredPackagesPath, runCommand }),
    collectStorageDiagnostics(config),
    collectBackupDiagnostics(backupRoot),
  ]);
  const activeTurnCount = typeof runtime.getActiveTurnCount === 'function'
    ? safeNumber(runtime.getActiveTurnCount())
    : null;

  return {
    checkedAt: new Date().toISOString(),
    version: {
      gitCommit: versions.gitCommit,
      buildId: process.env.CODEX_WEB_BUILD_ID || null,
    },
    versions: {
      node: process.version,
      npm: versions.npm,
      codex: versions.codex,
    },
    process: {
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      cwd: process.cwd(),
    },
    auth: { configured: authConfigured },
    identity: {
      mode: identityState?.settings?.multiUserEnabled === true ? 'multi' : 'single',
      users: identityState?.users?.length ?? 0,
      projects: identityState?.projects?.length ?? 0,
      sessions: identityState?.sessions?.length ?? 0,
    },
    runtime: {
      activeTurnCount,
      terminalCount: Math.max(0, Math.floor(Number(terminalCount) || 0)),
    },
    provider,
    service,
    system,
    storage,
    backup,
  };
}

export const defaultDiagnosticsCommandRunner: DiagnosticsCommandRunner = async (command, args, options = {}) => (
  new Promise((resolve) => {
    execFile(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      timeout: Math.max(100, options.timeoutMs ?? 1500),
    }, (error, stdout, stderr) => {
      const maybeCode = (error as (NodeJS.ErrnoException & { code?: unknown }) | null)?.code;
      const exitCode = typeof maybeCode === 'number' ? maybeCode : error ? 1 : 0;
      resolve({ exitCode, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  })
);

async function collectVersions(config: CodexWebConfig, runCommand: DiagnosticsCommandRunner): Promise<{
  npm: string | null;
  codex: string | null;
  gitCommit: string | null;
}> {
  const [npm, codex, git] = await Promise.all([
    runOptionalCommand(runCommand, 'npm', ['--version']),
    runOptionalCommand(runCommand, config.codexBin || 'codex', ['--version']),
    runOptionalCommand(runCommand, 'git', ['rev-parse', '--short', 'HEAD'], { cwd: process.cwd() }),
  ]);
  return {
    npm: firstLine(npm.stdout),
    codex: firstLine(codex.stdout || codex.stderr),
    gitCommit: firstLine(git.stdout),
  };
}

async function collectProviderDiagnostics(runtime: CollectDiagnosticsSummaryInput['runtime']): Promise<DiagnosticsSummary['provider']> {
  const models: DiagnosticsSummary['provider']['models'] = { status: 'unknown', count: 0, items: [] };
  const usage: DiagnosticsSummary['provider']['usage'] = {
    status: 'unavailable',
    available: false,
    required: false,
    message: 'Official usage data is unavailable; third-party API mode can still run.',
  };

  try {
    const items = typeof runtime.listModels === 'function' ? await runtime.listModels() : [];
    models.status = 'provider_ok';
    models.count = Array.isArray(items) ? items.length : 0;
    models.items = Array.isArray(items) ? items.slice(0, 8).map(summarizeModel) : [];
  } catch (error) {
    models.status = classifyProviderError(error);
    models.error = redactDiagnosticMessage(messageFromUnknown(error));
  }

  try {
    const report = typeof runtime.readUsage === 'function' ? await runtime.readUsage() : null;
    if (report) {
      usage.status = 'available';
      usage.available = true;
      usage.message = 'Official usage data is available.';
    }
  } catch (error) {
    usage.status = /unsupported|not supported|not implemented/iu.test(messageFromUnknown(error)) ? 'unsupported' : 'unavailable';
    usage.available = false;
    usage.error = redactDiagnosticMessage(messageFromUnknown(error));
    usage.message = `${usage.error || 'Official usage data is unavailable'}; third-party API mode can still run.`;
  }

  return {
    status: models.status === 'provider_ok' ? 'provider_ok' : models.status,
    models,
    usage,
  };
}

async function collectServiceDiagnostics(serviceName: string, runCommand: DiagnosticsCommandRunner): Promise<DiagnosticsSummary['service']> {
  const [active, enabled] = await Promise.all([
    runOptionalCommand(runCommand, 'systemctl', ['is-active', serviceName]),
    runOptionalCommand(runCommand, 'systemctl', ['is-enabled', serviceName]),
  ]);
  const activeText = firstLine(active.stdout);
  const enabledText = firstLine(enabled.stdout);
  const systemctlAvailable = active.exitCode !== 127 && enabled.exitCode !== 127;
  return {
    name: serviceName,
    active: systemctlAvailable ? activeText === 'active' : null,
    enabled: systemctlAvailable ? enabledText === 'enabled' : null,
    status: systemctlAvailable ? `${activeText || 'unknown'} / ${enabledText || 'unknown'}` : 'systemctl unavailable',
  };
}

async function collectSystemDiagnostics({
  stateDir,
  rebootRequiredPath,
  rebootRequiredPackagesPath,
  runCommand,
}: {
  stateDir: string;
  rebootRequiredPath: string;
  rebootRequiredPackagesPath: string;
  runCommand: DiagnosticsCommandRunner;
}): Promise<DiagnosticsSummary['system']> {
  const [rebootRequired, rebootPackages, upgrades, disk] = await Promise.all([
    pathExists(rebootRequiredPath),
    readLinesIfExists(rebootRequiredPackagesPath),
    collectUpgradeDiagnostics(runCommand),
    collectDiskDiagnostics(stateDir, runCommand),
  ]);
  return {
    platform: process.platform,
    release: os.release(),
    arch: os.arch(),
    reboot: { required: rebootRequired, packages: rebootPackages },
    upgrades,
    disk,
  };
}

async function collectUpgradeDiagnostics(runCommand: DiagnosticsCommandRunner): Promise<DiagnosticsSummary['system']['upgrades']> {
  const result = await runOptionalCommand(runCommand, 'apt', ['list', '--upgradable'], { timeoutMs: 2500 });
  if (result.exitCode !== 0 && !result.stdout) {
    return { status: 'unknown', count: null };
  }
  const count = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !/^Listing/u.test(line))
    .length;
  return { status: count > 0 ? 'available' : 'current', count };
}

async function collectDiskDiagnostics(stateDir: string, runCommand: DiagnosticsCommandRunner): Promise<DiagnosticsSummary['system']['disk']> {
  const result = await runOptionalCommand(runCommand, 'df', ['-Pk', stateDir], { timeoutMs: 1500 });
  const line = result.stdout.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean)[1] || '';
  const parts = line.split(/\s+/u);
  const availableKb = Number(parts[3]);
  const usedPercent = Number(String(parts[4] || '').replace(/%/gu, ''));
  return {
    path: stateDir,
    availableBytes: Number.isFinite(availableKb) ? availableKb * 1024 : null,
    usedPercent: Number.isFinite(usedPercent) ? usedPercent : null,
    status: Number.isFinite(availableKb) ? 'ok' : 'unknown',
  };
}

async function collectStorageDiagnostics(config: CodexWebConfig): Promise<DiagnosticsSummary['storage']> {
  const [stateDir, reportsDir, defaultCwd, authPath, envPath] = await Promise.all([
    pathStatus(config.stateDir, { directory: true, createDirectory: true, checkWritable: true }),
    pathStatus(config.reportsDir, { directory: true, createDirectory: true, checkWritable: true }),
    pathStatus(config.defaultCwd, { directory: true, createDirectory: false, checkWritable: true }),
    pathStatus(config.authPath, { directory: false, createDirectory: false, checkWritable: false }),
    pathStatus(config.envPath, { directory: false, createDirectory: false, checkWritable: false }),
  ]);
  return { stateDir, reportsDir, defaultCwd, authPath, envPath };
}

async function collectBackupDiagnostics(backupRoot: string): Promise<DiagnosticsSummary['backup']> {
  try {
    const entries = await fs.readdir(backupRoot, { withFileTypes: true });
    const stats = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(backupRoot, entry.name);
      const stat = await fs.stat(entryPath);
      return { name: entry.name, path: entryPath, modifiedAt: stat.mtime, mtimeMs: stat.mtimeMs };
    }));
    const latest = stats.sort((left, right) => right.mtimeMs - left.mtimeMs)[0] ?? null;
    return {
      root: backupRoot,
      exists: true,
      latest: latest
        ? { name: latest.name, path: latest.path, modifiedAt: latest.modifiedAt.toISOString() }
        : null,
    };
  } catch {
    return { root: backupRoot, exists: false, latest: null };
  }
}

async function pathStatus(
  targetPath: string,
  options: { directory: boolean; createDirectory: boolean; checkWritable: boolean },
): Promise<DiagnosticsPathStatus> {
  try {
    if (options.createDirectory && options.directory) {
      await fs.mkdir(targetPath, { recursive: true, mode: 0o700 });
    }
    const stat = await fs.stat(targetPath);
    const kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    return {
      path: targetPath,
      exists: true,
      kind,
      writable: options.checkWritable && kind === 'directory' ? await canWriteDirectory(targetPath) : null,
    };
  } catch (error) {
    return {
      path: targetPath,
      exists: false,
      kind: 'missing',
      writable: null,
      error: redactDiagnosticMessage(messageFromUnknown(error)),
    };
  }
}

async function canWriteDirectory(directoryPath: string): Promise<boolean> {
  const probePath = path.join(directoryPath, `.codex-web-diagnostic-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(probePath, 'ok', { mode: 0o600 });
    await fs.rm(probePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function runOptionalCommand(
  runCommand: DiagnosticsCommandRunner,
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<DiagnosticsCommandResult> {
  try {
    return await runCommand(command, args, options);
  } catch (error) {
    return { exitCode: 1, stdout: '', stderr: messageFromUnknown(error) };
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readLinesIfExists(targetPath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(targetPath, 'utf8');
    return raw.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function summarizeModel(item: unknown): Record<string, unknown> {
  if (!item || typeof item !== 'object') {
    return { id: String(item || '') };
  }
  const record = item as Record<string, unknown>;
  const id = stringValue(record.id) || stringValue(record.model) || stringValue(record.name);
  return { id, name: stringValue(record.name) || stringValue(record.displayName) || id };
}

function classifyProviderError(error: unknown): 'auth_missing' | 'unsupported' | 'failed' {
  const message = messageFromUnknown(error).toLowerCase();
  if (/\b(unauthorized|forbidden|not\s*logged\s*in|login|required auth|auth required|api key|invalid key|401|403)\b/u.test(message)) {
    return 'auth_missing';
  }
  if (/\b(unsupported|not supported|not implemented)\b/u.test(message)) {
    return 'unsupported';
  }
  return 'failed';
}

function firstLine(value: string): string | null {
  return value.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

function redactDiagnosticMessage(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, 'sk-***')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer ***')
    .replace(/\b(api[_-]?key|token|password)=([^&\s]+)/giu, '$1=***');
}
