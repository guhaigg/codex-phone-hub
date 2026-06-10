import type { CodexWebArtifact } from './artifact_store.js';
import type { CodexWebSession } from './runtime.js';
import type {
  WorkspaceDiff,
  WorkspaceFileStatus,
  WorkspaceStatus,
} from './workspace_inspector.js';

export const CONTEXT_PACKAGE_FILE_LIMIT = 40;
export const CONTEXT_PACKAGE_DIFF_FILE_LIMIT = 30;
export const CONTEXT_PACKAGE_ARTIFACT_LIMIT = 20;

export interface CodexWebContextPackageInput {
  generatedAt?: string | null;
  session: Partial<CodexWebSession> & Record<string, unknown>;
  workspaceStatus?: WorkspaceStatus | null;
  workspaceDiff?: WorkspaceDiff | null;
  artifacts?: CodexWebArtifact[] | null;
}

export interface CodexWebContextPackageFile {
  path: string;
  status: string;
}

export interface CodexWebContextPackageDiffFile {
  path: string;
  hunks: number;
}

export interface CodexWebContextPackageArtifact {
  id: string;
  source: string;
  kind: string;
  displayPath: string;
  sizeBytes: number;
  favorite: boolean;
}

export interface CodexWebSessionContextPackage {
  sessionId: string;
  title: string;
  generatedAt: string;
  markdown: string;
  session: {
    id: string;
    title: string;
    projectId: string | null;
    cwd: string | null;
    model: string | null;
    reasoningEffort: string | null;
    sandboxMode: string | null;
    approvalPolicy: string | null;
    collaborationMode: string | null;
    activeTurnId: string | null;
    activeTurnRecoverable: boolean;
  };
  workspace: {
    cwd: string;
    exists: boolean;
    isGitRepository: boolean;
    branch: string | null;
    upstream: string | null;
    counts: WorkspaceStatus['counts'];
    files: CodexWebContextPackageFile[];
    omittedFiles: number;
    diffFiles: CodexWebContextPackageDiffFile[];
    omittedDiffFiles: number;
    lastCommit: WorkspaceStatus['lastCommit'];
    diskWritable: boolean;
  } | null;
  artifacts: CodexWebContextPackageArtifact[];
  omittedArtifacts: number;
}

export function buildSessionContextPackage(input: CodexWebContextPackageInput): CodexWebSessionContextPackage {
  const generatedAt = normalizeIsoDate(input.generatedAt) || new Date().toISOString();
  const session = normalizeSession(input.session);
  const workspace = input.workspaceStatus ? normalizeWorkspace(input.workspaceStatus, input.workspaceDiff) : null;
  const artifacts = normalizeArtifacts(input.artifacts || []);
  const contextPackage: CodexWebSessionContextPackage = {
    sessionId: session.id,
    title: session.title,
    generatedAt,
    markdown: '',
    session,
    workspace,
    artifacts: artifacts.visible,
    omittedArtifacts: artifacts.omitted,
  };
  return {
    ...contextPackage,
    markdown: renderContextMarkdown(contextPackage),
  };
}

function normalizeSession(session: Partial<CodexWebSession> & Record<string, unknown>): CodexWebSessionContextPackage['session'] {
  const settings: Record<string, unknown> = isRecord(session.settings) ? session.settings : {};
  return {
    id: cleanInlineText(session.id) || 'unknown-session',
    title: cleanInlineText(session.title) || cleanInlineText(session.projectName) || cleanInlineText(session.id) || 'Untitled session',
    projectId: cleanInlineText(session.projectId) || null,
    cwd: cleanInlineText(session.cwd) || null,
    model: cleanInlineText(settings.model) || null,
    reasoningEffort: cleanInlineText(settings.reasoningEffort) || null,
    sandboxMode: cleanInlineText(settings.sandboxMode) || null,
    approvalPolicy: cleanInlineText(settings.approvalPolicy) || null,
    collaborationMode: cleanInlineText(settings.collaborationMode) || null,
    activeTurnId: cleanInlineText(session.activeTurnId) || null,
    activeTurnRecoverable: session.activeTurnRecoverable === true,
  };
}

function normalizeWorkspace(status: WorkspaceStatus, diff?: WorkspaceDiff | null): NonNullable<CodexWebSessionContextPackage['workspace']> {
  const visibleFiles = status.files.slice(0, CONTEXT_PACKAGE_FILE_LIMIT).map((file) => ({
    path: cleanInlineText(file.path) || '(unknown file)',
    status: fileStatusLabel(file),
  }));
  const diffFiles = (diff?.files || []).slice(0, CONTEXT_PACKAGE_DIFF_FILE_LIMIT).map((file) => ({
    path: cleanInlineText(file.path || file.newPath || file.oldPath) || '(unknown file)',
    hunks: Array.isArray(file.hunks) ? file.hunks.length : 0,
  }));
  return {
    cwd: cleanInlineText(status.cwd) || '',
    exists: status.exists === true,
    isGitRepository: status.isGitRepository === true,
    branch: cleanInlineText(status.branch) || null,
    upstream: cleanInlineText(status.upstream) || null,
    counts: {
      staged: Number(status.counts?.staged || 0),
      unstaged: Number(status.counts?.unstaged || 0),
      untracked: Number(status.counts?.untracked || 0),
      total: Number(status.counts?.total || 0),
    },
    files: visibleFiles,
    omittedFiles: Math.max(0, status.files.length - visibleFiles.length),
    diffFiles,
    omittedDiffFiles: Math.max(0, (diff?.files || []).length - diffFiles.length),
    lastCommit: status.lastCommit ? {
      hash: cleanInlineText(status.lastCommit.hash) || '',
      shortHash: cleanInlineText(status.lastCommit.shortHash) || '',
      message: cleanInlineText(status.lastCommit.message) || '',
      committedAt: cleanInlineText(status.lastCommit.committedAt) || null,
    } : null,
    diskWritable: status.diskWritable === true,
  };
}

function normalizeArtifacts(artifacts: CodexWebArtifact[]): {
  visible: CodexWebContextPackageArtifact[];
  omitted: number;
} {
  const visible = artifacts.slice(0, CONTEXT_PACKAGE_ARTIFACT_LIMIT).map((artifact) => ({
    id: cleanInlineText(artifact.id) || '',
    source: cleanInlineText(artifact.source) || 'project',
    kind: cleanInlineText(artifact.kind) || 'download',
    displayPath: cleanInlineText(artifact.displayPath || artifact.title) || '(unknown artifact)',
    sizeBytes: Number(artifact.sizeBytes || 0),
    favorite: artifact.favorite === true,
  }));
  return {
    visible,
    omitted: Math.max(0, artifacts.length - visible.length),
  };
}

function renderContextMarkdown(contextPackage: CodexWebSessionContextPackage): string {
  const lines: string[] = [
    '# Codex 交接包',
    '',
    `- 生成时间：${contextPackage.generatedAt}`,
    `- 会话：${contextPackage.session.title}`,
    `- Session ID：${contextPackage.session.id}`,
  ];
  if (contextPackage.session.projectId) lines.push(`- Project ID：${contextPackage.session.projectId}`);
  if (contextPackage.session.cwd) lines.push(`- 工作目录：${contextPackage.session.cwd}`);
  if (contextPackage.session.model) lines.push(`- 模型：${contextPackage.session.model}`);
  if (contextPackage.session.reasoningEffort) lines.push(`- 推理：${contextPackage.session.reasoningEffort}`);
  if (contextPackage.session.sandboxMode) lines.push(`- 沙箱：${contextPackage.session.sandboxMode}`);
  if (contextPackage.session.approvalPolicy) lines.push(`- 审批：${contextPackage.session.approvalPolicy}`);
  if (contextPackage.session.collaborationMode) lines.push(`- 模式：${contextPackage.session.collaborationMode}`);
  if (contextPackage.session.activeTurnId) {
    lines.push(`- 当前 turn：${contextPackage.session.activeTurnId}${contextPackage.session.activeTurnRecoverable ? '（可恢复）' : ''}`);
  }

  renderWorkspaceMarkdown(lines, contextPackage.workspace);
  renderArtifactsMarkdown(lines, contextPackage.artifacts, contextPackage.omittedArtifacts);
  lines.push(
    '',
    '## 继续建议',
    '',
    '请基于上述上下文继续。需要文件内容或完整 diff 时，请先读取工作区和 diff，不要假设未展示的内容。',
  );
  return `${lines.join('\n')}\n`;
}

function renderWorkspaceMarkdown(lines: string[], workspace: CodexWebSessionContextPackage['workspace']): void {
  lines.push('', '## 工作区', '');
  if (!workspace) {
    lines.push('- 当前会话没有可读取的工作区。');
    return;
  }
  lines.push(`- CWD：${workspace.cwd || '(unknown)'}`);
  lines.push(`- Git：${workspace.isGitRepository ? renderBranch(workspace.branch, workspace.upstream) : '不是 Git 工作区'}`);
  lines.push(`- Dirty：已暂存 ${workspace.counts.staged}，未暂存 ${workspace.counts.unstaged}，未跟踪 ${workspace.counts.untracked}，总计 ${workspace.counts.total}`);
  lines.push(`- 可写：${workspace.diskWritable ? 'yes' : 'no'}`);
  if (workspace.lastCommit) {
    lines.push(`- 最近提交：${workspace.lastCommit.shortHash} ${workspace.lastCommit.message}`);
  }
  lines.push('', '### 变更文件');
  if (!workspace.files.length) {
    lines.push('- 没有文件变更。');
  } else {
    for (const file of workspace.files) {
      lines.push(`- ${file.status} ${file.path}`);
    }
    if (workspace.omittedFiles > 0) {
      lines.push(`- 另有 ${workspace.omittedFiles} 个文件未展示。`);
    }
  }
  lines.push('', '### Diff 摘要');
  if (!workspace.diffFiles.length) {
    lines.push('- 没有 diff 摘要。');
  } else {
    for (const file of workspace.diffFiles) {
      lines.push(`- ${file.path}：${file.hunks} hunks`);
    }
    if (workspace.omittedDiffFiles > 0) {
      lines.push(`- 另有 ${workspace.omittedDiffFiles} 个 diff 文件未展示。`);
    }
  }
}

function renderArtifactsMarkdown(
  lines: string[],
  artifacts: CodexWebContextPackageArtifact[],
  omittedArtifacts: number,
): void {
  lines.push('', '## 产物', '');
  if (!artifacts.length) {
    lines.push('- 还没有可展示的产物。');
    return;
  }
  for (const artifact of artifacts) {
    const favorite = artifact.favorite ? '，已收藏' : '';
    lines.push(`- [${artifact.kind}/${artifact.source}] ${artifact.displayPath}（${formatBytes(artifact.sizeBytes)}${favorite}）`);
  }
  if (omittedArtifacts > 0) {
    lines.push(`- 另有 ${omittedArtifacts} 个产物未展示。`);
  }
}

function renderBranch(branch: string | null, upstream: string | null): string {
  if (branch && upstream) return `${branch} -> ${upstream}`;
  return branch || upstream || 'unknown';
}

function fileStatusLabel(file: WorkspaceFileStatus): string {
  if (file.indexStatus === '?' && file.worktreeStatus === '?') return '??';
  return `${statusCharacter(file.indexStatus)}${statusCharacter(file.worktreeStatus)}`;
}

function statusCharacter(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  return text.trim() ? text[0]! : '.';
}

function formatBytes(value: number): string {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeIsoDate(value: unknown): string | null {
  const text = cleanInlineText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanInlineText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim().slice(0, 500)
    : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
