import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5000;
const MAX_FILE_BYTES = 1024 * 1024;

export interface WorkspaceFileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
}

export interface WorkspaceStatus {
  cwd: string;
  exists: boolean;
  isGitRepository: boolean;
  branch: string | null;
  upstream: string | null;
  counts: {
    staged: number;
    unstaged: number;
    untracked: number;
    total: number;
  };
  files: WorkspaceFileStatus[];
  lastCommit: {
    hash: string;
    shortHash: string;
    message: string;
    committedAt: string | null;
  } | null;
  diskWritable: boolean;
}

export interface WorkspaceDiffHunk {
  header: string;
  lines: string[];
}

export interface WorkspaceDiffFile {
  path: string;
  oldPath: string | null;
  newPath: string | null;
  hunks: WorkspaceDiffHunk[];
}

export interface WorkspaceDiff {
  cwd: string;
  isGitRepository: boolean;
  raw: string;
  files: WorkspaceDiffFile[];
}

export interface WorkspaceFileContent {
  cwd: string;
  relativePath: string;
  absolutePath: string;
  content: string;
  sizeBytes: number;
}

export class WorkspaceInspectorError extends Error {
  readonly code: string;

  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'WorkspaceInspectorError';
    this.code = code;
    this.status = status;
  }
}

export async function inspectWorkspaceStatus(cwd: string): Promise<WorkspaceStatus> {
  const root = path.resolve(cwd || '');
  const exists = await isDirectory(root);
  const diskWritable = exists ? await canWriteDirectory(root) : false;
  const isGitRepository = exists ? await isGitWorkTree(root) : false;
  if (!exists || !isGitRepository) {
    return emptyStatus(root, exists, diskWritable);
  }
  const [branch, upstream, lastCommit, porcelain] = await Promise.all([
    gitOutput(root, ['branch', '--show-current']).then((value) => value || null).catch(() => null),
    gitOutput(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
      .then((value) => value || null)
      .catch(() => null),
    readLastCommit(root),
    gitOutput(root, ['status', '--porcelain=v1', '-z']).catch(() => ''),
  ]);
  const files = parsePorcelainStatus(porcelain);
  return {
    cwd: root,
    exists,
    isGitRepository,
    branch,
    upstream,
    counts: countStatusFiles(files),
    files,
    lastCommit,
    diskWritable,
  };
}

export async function inspectWorkspaceDiff(cwd: string): Promise<WorkspaceDiff> {
  const root = path.resolve(cwd || '');
  if (!await isGitWorkTree(root)) {
    return {
      cwd: root,
      isGitRepository: false,
      raw: '',
      files: [],
    };
  }
  const [unstaged, staged] = await Promise.all([
    gitOutput(root, ['diff', '--no-ext-diff', '--no-color']).catch(() => ''),
    gitOutput(root, ['diff', '--cached', '--no-ext-diff', '--no-color']).catch(() => ''),
  ]);
  const raw = [staged, unstaged].filter(Boolean).join('\n');
  return {
    cwd: root,
    isGitRepository: true,
    raw,
    files: parseUnifiedDiff(raw),
  };
}

export async function inspectWorkspaceFile(cwd: string, relativePath: string): Promise<WorkspaceFileContent> {
  const root = await realDirectory(cwd);
  const target = await resolveWorkspacePath(root, relativePath);
  const stat = await fs.stat(target);
  if (!stat.isFile()) {
    throw new WorkspaceInspectorError('workspace_file_not_found', 'workspace file is not a regular file', 404);
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new WorkspaceInspectorError('workspace_file_too_large', 'workspace file is too large to preview', 413);
  }
  return {
    cwd: root,
    relativePath: normalizeRelativePath(root, target),
    absolutePath: target,
    content: await fs.readFile(target, 'utf8'),
    sizeBytes: stat.size,
  };
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

async function isGitWorkTree(cwd: string): Promise<boolean> {
  try {
    return (await gitOutput(cwd, ['rev-parse', '--is-inside-work-tree'])) === 'true';
  } catch (_error) {
    return false;
  }
}

async function readLastCommit(cwd: string): Promise<WorkspaceStatus['lastCommit']> {
  try {
    const output = await gitOutput(cwd, ['log', '-1', '--format=%H%x00%h%x00%s%x00%ct']);
    const [hash, shortHash, message, timestamp] = output.split('\0');
    if (!hash || !shortHash) {
      return null;
    }
    const seconds = Number(timestamp);
    return {
      hash,
      shortHash,
      message: message || '',
      committedAt: Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null,
    };
  } catch (_error) {
    return null;
  }
}

function parsePorcelainStatus(output: string): WorkspaceFileStatus[] {
  if (!output) return [];
  const entries = output.split('\0').filter(Boolean);
  const files: WorkspaceFileStatus[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const indexStatus = entry[0] || ' ';
    const worktreeStatus = entry[1] || ' ';
    const filePath = entry.slice(3);
    if (!filePath) continue;
    files.push({
      path: normalizeGitPath(filePath),
      indexStatus,
      worktreeStatus,
    });
    if (indexStatus === 'R' || indexStatus === 'C') {
      index += 1;
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function countStatusFiles(files: WorkspaceFileStatus[]): WorkspaceStatus['counts'] {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const file of files) {
    if (file.indexStatus === '?' && file.worktreeStatus === '?') {
      untracked += 1;
      continue;
    }
    if (file.indexStatus.trim()) staged += 1;
    if (file.worktreeStatus.trim()) unstaged += 1;
  }
  return {
    staged,
    unstaged,
    untracked,
    total: files.length,
  };
}

function parseUnifiedDiff(raw: string): WorkspaceDiffFile[] {
  const files: WorkspaceDiffFile[] = [];
  let currentFile: WorkspaceDiffFile | null = null;
  let currentHunk: WorkspaceDiffHunk | null = null;
  for (const line of raw.split(/\r?\n/u)) {
    const fileMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/u);
    if (fileMatch) {
      currentFile = {
        path: normalizeGitPath(fileMatch[2]!),
        oldPath: normalizeGitPath(fileMatch[1]!),
        newPath: normalizeGitPath(fileMatch[2]!),
        hunks: [],
      };
      files.push(currentFile);
      currentHunk = null;
      continue;
    }
    if (!currentFile) continue;
    if (line.startsWith('+++ b/')) {
      currentFile.newPath = normalizeGitPath(line.slice(6));
      currentFile.path = currentFile.newPath;
      continue;
    }
    if (line.startsWith('--- a/')) {
      currentFile.oldPath = normalizeGitPath(line.slice(6));
      continue;
    }
    if (line.startsWith('@@')) {
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (currentHunk) {
      currentHunk.lines.push(line);
    }
  }
  return files;
}

function normalizeGitPath(value: string): string {
  return value.replace(/\\/gu, '/');
}

async function isDirectory(value: string): Promise<boolean> {
  try {
    return (await fs.stat(value)).isDirectory();
  } catch (_error) {
    return false;
  }
}

async function canWriteDirectory(value: string): Promise<boolean> {
  try {
    await fs.access(value, fs.constants.W_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

function emptyStatus(cwd: string, exists: boolean, diskWritable: boolean): WorkspaceStatus {
  return {
    cwd,
    exists,
    isGitRepository: false,
    branch: null,
    upstream: null,
    counts: {
      staged: 0,
      unstaged: 0,
      untracked: 0,
      total: 0,
    },
    files: [],
    lastCommit: null,
    diskWritable,
  };
}

async function realDirectory(cwd: string): Promise<string> {
  const root = path.resolve(cwd || '');
  if (!await isDirectory(root)) {
    throw new WorkspaceInspectorError('workspace_not_found', 'workspace cwd does not exist', 404);
  }
  return fs.realpath(root);
}

async function resolveWorkspacePath(realRoot: string, requestedPath: string): Promise<string> {
  const value = String(requestedPath || '').trim();
  if (!value || path.isAbsolute(value)) {
    throw new WorkspaceInspectorError('workspace_path_forbidden', 'workspace path must be relative', 403);
  }
  const candidate = path.resolve(realRoot, value);
  if (!isPathInside(realRoot, candidate)) {
    throw new WorkspaceInspectorError('workspace_path_forbidden', 'workspace path escapes cwd', 403);
  }
  const realTarget = await fs.realpath(candidate).catch(() => {
    throw new WorkspaceInspectorError('workspace_file_not_found', 'workspace file not found', 404);
  });
  if (!isPathInside(realRoot, realTarget)) {
    throw new WorkspaceInspectorError('workspace_path_forbidden', 'workspace path escapes cwd', 403);
  }
  return realTarget;
}

function normalizeRelativePath(root: string, target: string): string {
  return normalizeGitPath(path.relative(root, target));
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
