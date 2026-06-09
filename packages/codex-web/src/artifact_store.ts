import fs from 'node:fs/promises';
import path from 'node:path';
import { FileReportStore, type CodexWebReport } from './report_store.js';

export type CodexWebArtifactSource = 'project' | 'report';
export type CodexWebArtifactKind = 'text' | 'markdown' | 'html' | 'image' | 'pdf' | 'download';

export interface CodexWebArtifact {
  id: string;
  source: CodexWebArtifactSource;
  sessionId: string | null;
  projectId: string | null;
  title: string;
  path: string;
  displayPath: string;
  kind: CodexWebArtifactKind;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  previewable: boolean;
  downloadable: boolean;
}

export interface CodexWebArtifactContent {
  artifact: CodexWebArtifact;
  kind: CodexWebArtifactKind;
  content?: string;
  encoding?: 'base64';
  contentBase64?: string;
}

export interface CodexWebArtifactBinary {
  artifact: CodexWebArtifact;
  body: Buffer;
}

export interface ListArtifactsInput {
  sessionId: string;
  projectId?: string | null;
  projectCwd?: string | null;
}

interface ArtifactIndexFile {
  version: 1;
  artifacts: Record<string, ArtifactIndexEntry>;
}

interface ArtifactIndexEntry {
  favorite?: boolean;
  title?: string;
  projectId?: string | null;
  sessionId?: string | null;
  updatedAt?: string;
}

interface ArtifactDescriptor {
  source: CodexWebArtifactSource;
  relativePath: string;
}

const MAX_SCAN_DEPTH = 4;
const MAX_PROJECT_ARTIFACTS = 160;
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const MAX_BINARY_PREVIEW_BYTES = 5 * 1024 * 1024;
const SKIP_DIRECTORIES = new Set([
  '.cache',
  '.codex',
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'node_modules',
]);

const ARTIFACT_TYPES = new Map<string, { kind: CodexWebArtifactKind; mimeType: string }>([
  ['.csv', { kind: 'text', mimeType: 'text/csv; charset=utf-8' }],
  ['.htm', { kind: 'html', mimeType: 'text/html; charset=utf-8' }],
  ['.html', { kind: 'html', mimeType: 'text/html; charset=utf-8' }],
  ['.jpeg', { kind: 'image', mimeType: 'image/jpeg' }],
  ['.jpg', { kind: 'image', mimeType: 'image/jpeg' }],
  ['.json', { kind: 'text', mimeType: 'application/json; charset=utf-8' }],
  ['.md', { kind: 'markdown', mimeType: 'text/markdown; charset=utf-8' }],
  ['.markdown', { kind: 'markdown', mimeType: 'text/markdown; charset=utf-8' }],
  ['.pdf', { kind: 'pdf', mimeType: 'application/pdf' }],
  ['.png', { kind: 'image', mimeType: 'image/png' }],
  ['.svg', { kind: 'image', mimeType: 'image/svg+xml' }],
  ['.txt', { kind: 'text', mimeType: 'text/plain; charset=utf-8' }],
  ['.webp', { kind: 'image', mimeType: 'image/webp' }],
]);

export class ArtifactStoreError extends Error {
  readonly code: string;

  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'ArtifactStoreError';
    this.code = code;
    this.status = status;
  }
}

export class FileArtifactStore {
  private readonly reportsDir: string;

  private readonly indexPath: string;

  private readonly reportStore: FileReportStore;

  private indexCache: ArtifactIndexFile | null = null;

  constructor({
    reportsDir,
    indexPath,
    reportIndexPath = indexPath,
  }: {
    reportsDir: string;
    indexPath: string;
    reportIndexPath?: string;
  }) {
    this.reportsDir = path.resolve(reportsDir);
    this.indexPath = indexPath;
    this.reportStore = new FileReportStore({
      reportsDir: this.reportsDir,
      indexPath: reportIndexPath,
    });
  }

  static projectArtifactId(relativePath: string): string {
    return `project:${base64UrlEncode(normalizeArtifactRelativePath(relativePath))}`;
  }

  static reportArtifactId(reportId: string): string {
    return `report:${base64UrlEncode(normalizeReportId(reportId))}`;
  }

  async listForSession(input: ListArtifactsInput): Promise<CodexWebArtifact[]> {
    const items = [
      ...await this.listProjectArtifacts(input),
      ...await this.listReportArtifacts(input),
    ];
    return items.sort(compareArtifacts);
  }

  async readContent(artifactId: string, input: ListArtifactsInput): Promise<CodexWebArtifactContent> {
    const artifact = await this.readArtifact(artifactId, input);
    if (!artifact.previewable) {
      throw new ArtifactStoreError('artifact_preview_unsupported', 'Artifact cannot be previewed.', 415);
    }
    if (artifact.kind === 'image') {
      if (artifact.sizeBytes > MAX_BINARY_PREVIEW_BYTES) {
        throw new ArtifactStoreError('artifact_too_large', 'Artifact is too large to preview.', 413);
      }
      return {
        artifact,
        kind: artifact.kind,
        encoding: 'base64',
        contentBase64: (await fs.readFile(artifact.path)).toString('base64'),
      };
    }
    if (artifact.kind === 'pdf') {
      return {
        artifact,
        kind: artifact.kind,
      };
    }
    if (artifact.sizeBytes > MAX_TEXT_PREVIEW_BYTES) {
      throw new ArtifactStoreError('artifact_too_large', 'Artifact is too large to preview.', 413);
    }
    return {
      artifact,
      kind: artifact.kind,
      content: await fs.readFile(artifact.path, 'utf8'),
    };
  }

  async readBinary(artifactId: string, input: ListArtifactsInput): Promise<CodexWebArtifactBinary> {
    const artifact = await this.readArtifact(artifactId, input);
    return {
      artifact,
      body: await fs.readFile(artifact.path),
    };
  }

  async setFavorite(artifactId: string, favorite: boolean): Promise<void> {
    const index = await this.readIndex();
    index.artifacts[artifactId] = {
      ...index.artifacts[artifactId],
      favorite,
      updatedAt: new Date().toISOString(),
    };
    await this.writeIndex(index);
  }

  async readArtifact(artifactId: string, input: ListArtifactsInput): Promise<CodexWebArtifact> {
    const descriptor = decodeArtifactId(artifactId);
    if (descriptor.source === 'report') {
      const report = await this.reportStore.readReport(descriptor.relativePath);
      if (!report) {
        throw new ArtifactStoreError('artifact_not_found', 'Artifact was not found.', 404);
      }
      return this.reportToArtifact(report, input);
    }
    const root = await this.realProjectRoot(input.projectCwd);
    const target = await this.resolveProjectArtifactPath(root, descriptor.relativePath);
    const stat = await fs.stat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (!stat?.isFile()) {
      throw new ArtifactStoreError('artifact_not_found', 'Artifact was not found.', 404);
    }
    return this.projectFileToArtifact({
      input,
      root,
      absolutePath: target,
      relativePath: normalizePathForId(path.relative(root, target)),
      stat,
    });
  }

  private async listProjectArtifacts(input: ListArtifactsInput): Promise<CodexWebArtifact[]> {
    if (!normalizeOptionalString(input.projectCwd)) {
      return [];
    }
    const root = await this.realProjectRoot(input.projectCwd);
    const files: CodexWebArtifact[] = [];
    await this.scanProjectDirectory({
      input,
      root,
      directory: root,
      depth: 0,
      files,
    });
    return files;
  }

  private async scanProjectDirectory({
    input,
    root,
    directory,
    depth,
    files,
  }: {
    input: ListArtifactsInput;
    root: string;
    directory: string;
    depth: number;
    files: CodexWebArtifact[];
  }): Promise<void> {
    if (depth > MAX_SCAN_DEPTH || files.length >= MAX_PROJECT_ARTIFACTS) {
      return;
    }
    let entries: Array<import('node:fs').Dirent>;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
    entries.sort((left, right) => {
      const leftDirectory = left.isDirectory() ? 1 : 0;
      const rightDirectory = right.isDirectory() ? 1 : 0;
      return leftDirectory - rightDirectory
        || left.name.toLowerCase().localeCompare(right.name.toLowerCase())
        || left.name.localeCompare(right.name);
    });
    for (const entry of entries) {
      if (files.length >= MAX_PROJECT_ARTIFACTS) {
        return;
      }
      if (entry.name.startsWith('.') && SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) {
          await this.scanProjectDirectory({ input, root, directory: absolutePath, depth: depth + 1, files });
        }
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) {
        continue;
      }
      if (!artifactTypeForPath(entry.name)) {
        continue;
      }
      try {
        const resolved = await this.resolveProjectArtifactPath(root, path.relative(root, absolutePath));
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
          continue;
        }
        files.push(await this.projectFileToArtifact({
          input,
          root,
          absolutePath: resolved,
          relativePath: normalizePathForId(path.relative(root, resolved)),
          stat,
        }));
      } catch (error) {
        if (!(error instanceof ArtifactStoreError && error.code === 'artifact_path_forbidden')) {
          throw error;
        }
      }
    }
  }

  private async listReportArtifacts(input: ListArtifactsInput): Promise<CodexWebArtifact[]> {
    const projectId = normalizeOptionalString(input.projectId);
    const reports = await this.reportStore.listReports();
    return Promise.all(reports
      .filter((report) => !projectId || report.project === projectId || report.id.startsWith(`${projectId}/`))
      .map((report) => this.reportToArtifact(report, input)));
  }

  private async projectFileToArtifact({
    input,
    root,
    absolutePath,
    relativePath,
    stat,
  }: {
    input: ListArtifactsInput;
    root: string;
    absolutePath: string;
    relativePath: string;
    stat: import('node:fs').Stats;
  }): Promise<CodexWebArtifact> {
    const type = artifactTypeForPath(relativePath) ?? { kind: 'download' as const, mimeType: 'application/octet-stream' };
    const id = FileArtifactStore.projectArtifactId(relativePath);
    const index = await this.readIndex();
    const indexed = index.artifacts[id] ?? {};
    return {
      id,
      source: 'project',
      sessionId: normalizeOptionalString(input.sessionId) || null,
      projectId: normalizeOptionalString(input.projectId) || null,
      title: normalizeOptionalString(indexed.title) || path.basename(relativePath),
      path: absolutePath,
      displayPath: normalizePathForId(path.relative(root, absolutePath)),
      kind: type.kind,
      mimeType: type.mimeType,
      sizeBytes: stat.size,
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
      favorite: indexed.favorite === true,
      previewable: type.kind !== 'download',
      downloadable: true,
    };
  }

  private async reportToArtifact(report: CodexWebReport, input: ListArtifactsInput): Promise<CodexWebArtifact> {
    const id = FileArtifactStore.reportArtifactId(report.id);
    const index = await this.readIndex();
    const indexed = index.artifacts[id] ?? {};
    const type = artifactTypeForPath(report.id) ?? {
      kind: report.kind === 'html' ? 'html' as const : 'markdown' as const,
      mimeType: report.kind === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8',
    };
    return {
      id,
      source: 'report',
      sessionId: normalizeOptionalString(input.sessionId) || null,
      projectId: normalizeOptionalString(input.projectId) || report.project,
      title: normalizeOptionalString(indexed.title) || report.title,
      path: report.path,
      displayPath: report.id,
      kind: type.kind,
      mimeType: type.mimeType,
      sizeBytes: report.sizeBytes,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      favorite: indexed.favorite === true || report.favorite,
      previewable: true,
      downloadable: true,
    };
  }

  private async realProjectRoot(projectCwd?: string | null): Promise<string> {
    const cwd = normalizeOptionalString(projectCwd);
    if (!cwd) {
      throw new ArtifactStoreError('artifact_workspace_required', 'Session has no workspace cwd.', 404);
    }
    const root = await fs.realpath(path.resolve(cwd)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        throw new ArtifactStoreError('artifact_workspace_required', 'Session workspace was not found.', 404);
      }
      throw error;
    });
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
      throw new ArtifactStoreError('artifact_workspace_required', 'Session workspace is not a directory.', 404);
    }
    return root;
  }

  private async resolveProjectArtifactPath(root: string, relativePath: string): Promise<string> {
    const normalized = normalizeArtifactRelativePath(relativePath);
    const candidate = path.join(root, ...normalized.split('/'));
    const target = await fs.realpath(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return path.resolve(candidate);
      }
      throw error;
    });
    if (!isPathInside(root, target)) {
      throw new ArtifactStoreError('artifact_path_forbidden', 'Artifact path is outside the workspace.', 403);
    }
    return path.resolve(candidate);
  }

  private async readIndex(): Promise<ArtifactIndexFile> {
    if (this.indexCache) {
      return this.indexCache;
    }
    try {
      const parsed = JSON.parse(await fs.readFile(this.indexPath, 'utf8')) as Partial<ArtifactIndexFile>;
      this.indexCache = {
        version: 1,
        artifacts: isRecord(parsed.artifacts) ? parsed.artifacts as Record<string, ArtifactIndexEntry> : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      this.indexCache = { version: 1, artifacts: {} };
    }
    return this.indexCache;
  }

  private async writeIndex(index: ArtifactIndexFile): Promise<void> {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true, mode: 0o700 });
    const tmpPath = `${this.indexPath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmpPath, this.indexPath);
    this.indexCache = index;
  }
}

function decodeArtifactId(artifactId: string): ArtifactDescriptor {
  const [source, encoded] = String(artifactId || '').split(':', 2);
  if ((source !== 'project' && source !== 'report') || !encoded) {
    throw new ArtifactStoreError('artifact_not_found', 'Artifact was not found.', 404);
  }
  const relativePath = source === 'report'
    ? normalizeReportId(base64UrlDecode(encoded))
    : normalizeArtifactRelativePath(base64UrlDecode(encoded));
  return { source, relativePath };
}

function artifactTypeForPath(filePath: string): { kind: CodexWebArtifactKind; mimeType: string } | null {
  return ARTIFACT_TYPES.get(path.extname(filePath).toLowerCase()) ?? null;
}

function compareArtifacts(left: CodexWebArtifact, right: CodexWebArtifact): number {
  if (left.favorite !== right.favorite) {
    return left.favorite ? -1 : 1;
  }
  if (left.source !== right.source) {
    return left.source === 'project' ? -1 : 1;
  }
  const leftDepth = artifactPathDepth(left.displayPath);
  const rightDepth = artifactPathDepth(right.displayPath);
  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }
  return left.displayPath.toLowerCase().localeCompare(right.displayPath.toLowerCase())
    || left.displayPath.localeCompare(right.displayPath);
}

function artifactPathDepth(displayPath: string): number {
  return normalizePathForId(displayPath).split('/').filter(Boolean).length;
}

function normalizeArtifactRelativePath(value: string): string {
  const normalized = String(value || '').replace(/\\/gu, '/').replace(/^\/+/u, '');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
    throw new ArtifactStoreError('artifact_path_forbidden', 'Artifact path is outside the workspace.', 403);
  }
  return parts.join('/');
}

function normalizeReportId(value: string): string {
  const normalized = String(value || '').replace(/\\/gu, '/').replace(/^\/+/u, '');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
    throw new ArtifactStoreError('artifact_not_found', 'Artifact was not found.', 404);
  }
  return parts.join('/');
}

function normalizePathForId(value: string): string {
  return String(value || '').split(path.sep).join('/');
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch (_error) {
    throw new ArtifactStoreError('artifact_not_found', 'Artifact was not found.', 404);
  }
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
