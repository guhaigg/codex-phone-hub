import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTEXT_PACKAGE_ARTIFACT_LIMIT,
  CONTEXT_PACKAGE_DIFF_FILE_LIMIT,
  CONTEXT_PACKAGE_FILE_LIMIT,
  buildSessionContextPackage,
} from '../src/context_package.js';

test('context package summarizes session workspace and artifacts without leaking raw content', () => {
  const changedFiles = Array.from({ length: CONTEXT_PACKAGE_FILE_LIMIT + 3 }, (_value, index) => ({
    path: `src/file-${index}.ts`,
    indexStatus: index % 2 === 0 ? 'M' : ' ',
    worktreeStatus: index % 2 === 0 ? ' ' : 'M',
  }));
  const diffFiles = Array.from({ length: CONTEXT_PACKAGE_DIFF_FILE_LIMIT + 2 }, (_value, index) => ({
    path: `src/diff-${index}.ts`,
    oldPath: null,
    newPath: `src/diff-${index}.ts`,
    hunks: [
      { header: '@@ -1 +1 @@', lines: ['-secret raw diff', '+new raw diff'] },
      { header: '@@ -8 +8 @@', lines: ['-another secret', '+another new'] },
    ],
  }));
  const artifacts = Array.from({ length: CONTEXT_PACKAGE_ARTIFACT_LIMIT + 2 }, (_value, index) => ({
    id: `artifact_${index}`,
    source: index % 2 === 0 ? 'project' : 'report',
    sessionId: 'thread_1',
    projectId: 'project-a',
    title: `Artifact ${index}`,
    path: `/workspace/dist/artifact-${index}.md`,
    displayPath: `dist/artifact-${index}.md`,
    kind: 'markdown',
    mimeType: 'text/markdown; charset=utf-8',
    sizeBytes: 1024 + index,
    createdAt: '2026-06-10T01:02:03.000Z',
    updatedAt: '2026-06-10T01:02:03.000Z',
    favorite: index === 0,
    previewable: true,
    downloadable: true,
  }));

  const contextPackage = buildSessionContextPackage({
    generatedAt: '2026-06-10T01:02:03.000Z',
    session: {
      id: 'thread_1',
      title: 'Ship context package',
      cwd: '/workspace/codex-phone-hub',
      projectName: 'codex-phone-hub',
      projectId: 'project-a',
      activeTurnId: 'turn_running',
      activeTurnRecoverable: true,
      settings: {
        model: 'gpt-5',
        reasoningEffort: 'high',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        collaborationMode: 'default',
      },
      preview: 'this prompt text must not be copied',
      timeline: [{ text: 'assistant output must not be copied' }],
    } as any,
    workspaceStatus: {
      cwd: '/workspace/codex-phone-hub',
      exists: true,
      isGitRepository: true,
      branch: 'main',
      upstream: 'origin/main',
      counts: {
        staged: 2,
        unstaged: 3,
        untracked: 1,
        total: changedFiles.length,
      },
      files: changedFiles,
      lastCommit: {
        hash: 'abcdef1234567890',
        shortHash: 'abcdef1',
        message: 'Add remote workbench',
        committedAt: '2026-06-09T23:00:00.000Z',
      },
      diskWritable: true,
    },
    workspaceDiff: {
      cwd: '/workspace/codex-phone-hub',
      isGitRepository: true,
      raw: 'diff --git a/secret.ts b/secret.ts\n-secret raw diff\n+new raw diff',
      files: diffFiles,
    },
    artifacts: artifacts as any,
  });

  assert.equal(contextPackage.sessionId, 'thread_1');
  assert.equal(contextPackage.workspace?.files.length, CONTEXT_PACKAGE_FILE_LIMIT);
  assert.equal(contextPackage.workspace?.omittedFiles, 3);
  assert.equal(contextPackage.workspace?.diffFiles.length, CONTEXT_PACKAGE_DIFF_FILE_LIMIT);
  assert.equal(contextPackage.workspace?.omittedDiffFiles, 2);
  assert.equal(contextPackage.artifacts.length, CONTEXT_PACKAGE_ARTIFACT_LIMIT);
  assert.equal(contextPackage.omittedArtifacts, 2);

  assert.match(contextPackage.markdown, /# Codex 交接包/u);
  assert.match(contextPackage.markdown, /Ship context package/u);
  assert.match(contextPackage.markdown, /\/workspace\/codex-phone-hub/u);
  assert.match(contextPackage.markdown, /main -> origin\/main/u);
  assert.match(contextPackage.markdown, /已暂存 2，未暂存 3，未跟踪 1，总计 43/u);
  assert.match(contextPackage.markdown, /src\/file-0\.ts/u);
  assert.match(contextPackage.markdown, /src\/diff-0\.ts：2 hunks/u);
  assert.match(contextPackage.markdown, /dist\/artifact-0\.md/u);
  assert.match(contextPackage.markdown, /另有 3 个文件未展示/u);
  assert.match(contextPackage.markdown, /另有 2 个 diff 文件未展示/u);
  assert.match(contextPackage.markdown, /另有 2 个产物未展示/u);

  assert.doesNotMatch(contextPackage.markdown, /secret raw diff/u);
  assert.doesNotMatch(contextPackage.markdown, /new raw diff/u);
  assert.doesNotMatch(contextPackage.markdown, /this prompt text/u);
  assert.doesNotMatch(contextPackage.markdown, /assistant output/u);
});
