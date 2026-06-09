import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArtifactStoreError, FileArtifactStore } from '../src/artifact_store.js';

test('artifact store lists report and project deliverables for a session', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-artifacts-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const projectDir = path.join(dir, 'project');
  const reportsDir = path.join(dir, 'reports');
  const indexPath = path.join(dir, 'artifact-index.json');
  await fs.mkdir(path.join(projectDir, 'dist'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'node_modules'), { recursive: true });
  await fs.mkdir(path.join(reportsDir, 'project-a'), { recursive: true });
  await fs.mkdir(path.join(reportsDir, 'project-b'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'README.md'), '# Project\n', 'utf8');
  await fs.writeFile(path.join(projectDir, 'dist', 'result.pdf'), '%PDF-1.4\n', 'utf8');
  await fs.writeFile(path.join(projectDir, 'node_modules', 'ignored.md'), '# ignored\n', 'utf8');
  await fs.writeFile(path.join(reportsDir, 'project-a', 'summary.md'), '# Summary\n', 'utf8');
  await fs.writeFile(path.join(reportsDir, 'project-b', 'other.md'), '# Other\n', 'utf8');

  const store = new FileArtifactStore({ reportsDir, indexPath });
  const items = await store.listForSession({
    sessionId: 'thread_1',
    projectId: 'project-a',
    projectCwd: projectDir,
  });

  assert.deepEqual(items.map((item) => ({
    source: item.source,
    sessionId: item.sessionId,
    projectId: item.projectId,
    displayPath: item.displayPath,
    kind: item.kind,
    mimeType: item.mimeType,
    favorite: item.favorite,
  })), [
    {
      source: 'project',
      sessionId: 'thread_1',
      projectId: 'project-a',
      displayPath: 'README.md',
      kind: 'markdown',
      mimeType: 'text/markdown; charset=utf-8',
      favorite: false,
    },
    {
      source: 'project',
      sessionId: 'thread_1',
      projectId: 'project-a',
      displayPath: 'dist/result.pdf',
      kind: 'pdf',
      mimeType: 'application/pdf',
      favorite: false,
    },
    {
      source: 'report',
      sessionId: 'thread_1',
      projectId: 'project-a',
      displayPath: 'project-a/summary.md',
      kind: 'markdown',
      mimeType: 'text/markdown; charset=utf-8',
      favorite: false,
    },
  ]);
});

test('artifact store previews text and image artifacts with safe metadata', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-artifacts-preview-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const projectDir = path.join(dir, 'project');
  const reportsDir = path.join(dir, 'reports');
  const indexPath = path.join(dir, 'artifact-index.json');
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, 'notes.txt'), 'hello artifact\n', 'utf8');
  await fs.writeFile(path.join(projectDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const store = new FileArtifactStore({ reportsDir, indexPath });
  const items = await store.listForSession({
    sessionId: 'thread_1',
    projectId: 'project-a',
    projectCwd: projectDir,
  });
  const textArtifact = items.find((item) => item.displayPath === 'notes.txt');
  const imageArtifact = items.find((item) => item.displayPath === 'image.png');
  assert.ok(textArtifact);
  assert.ok(imageArtifact);

  const text = await store.readContent(textArtifact.id, {
    sessionId: 'thread_1',
    projectId: 'project-a',
    projectCwd: projectDir,
  });
  assert.equal(text.kind, 'text');
  assert.equal(text.content, 'hello artifact\n');

  const image = await store.readContent(imageArtifact.id, {
    sessionId: 'thread_1',
    projectId: 'project-a',
    projectCwd: projectDir,
  });
  assert.equal(image.kind, 'image');
  assert.equal(image.encoding, 'base64');
  assert.equal(image.contentBase64, Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'));
});

test('artifact store rejects project symlinks that escape the workspace', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-artifacts-symlink-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const projectDir = path.join(dir, 'project');
  const reportsDir = path.join(dir, 'reports');
  const indexPath = path.join(dir, 'artifact-index.json');
  const outside = path.join(dir, 'secret.txt');
  const link = path.join(projectDir, 'leak.txt');
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(outside, 'secret\n', 'utf8');
  try {
    await fs.symlink(outside, link);
  } catch (error: any) {
    if (process.platform === 'win32' && error?.code === 'EPERM') {
      t.skip('Windows symlink creation requires developer mode or elevated privileges.');
      return;
    }
    throw error;
  }

  const store = new FileArtifactStore({ reportsDir, indexPath });
  const items = await store.listForSession({
    sessionId: 'thread_1',
    projectId: 'project-a',
    projectCwd: projectDir,
  });
  assert.equal(items.some((item) => item.displayPath === 'leak.txt'), false);

  await assert.rejects(
    () => store.readContent(FileArtifactStore.projectArtifactId('leak.txt'), {
      sessionId: 'thread_1',
      projectId: 'project-a',
      projectCwd: projectDir,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ArtifactStoreError);
      assert.equal(error.code, 'artifact_path_forbidden');
      assert.equal(error.status, 403);
      return true;
    },
  );
});

test('artifact store persists favorite state in the artifact index', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-artifacts-favorite-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const projectDir = path.join(dir, 'project');
  const reportsDir = path.join(dir, 'reports');
  const indexPath = path.join(dir, 'artifact-index.json');
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, 'notes.txt'), 'hello\n', 'utf8');

  const store = new FileArtifactStore({ reportsDir, indexPath });
  const artifactId = FileArtifactStore.projectArtifactId('notes.txt');
  await store.setFavorite(artifactId, true);

  const reloaded = new FileArtifactStore({ reportsDir, indexPath });
  const items = await reloaded.listForSession({
    sessionId: 'thread_1',
    projectId: 'project-a',
    projectCwd: projectDir,
  });
  assert.equal(items.find((item) => item.id === artifactId)?.favorite, true);
});

test('artifact store preserves report index metadata when listing report artifacts', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-artifacts-report-index-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const reportsDir = path.join(dir, 'reports');
  const indexPath = path.join(dir, 'artifact-index.json');
  const reportIndexPath = path.join(dir, 'report-index.json');
  await fs.mkdir(path.join(reportsDir, 'project-a'), { recursive: true });
  await fs.writeFile(path.join(reportsDir, 'project-a', 'summary.md'), '# Summary\n', 'utf8');
  await fs.writeFile(reportIndexPath, JSON.stringify({
    version: 1,
    reports: {
      'project-a/summary.md': {
        title: 'Indexed Summary',
        favorite: true,
        project: 'project-a',
      },
    },
  }));

  const store = new FileArtifactStore({ reportsDir, indexPath, reportIndexPath });
  const items = await store.listForSession({
    sessionId: 'thread_1',
    projectId: 'project-a',
  });

  assert.equal(items[0]?.title, 'Indexed Summary');
  assert.equal(items[0]?.favorite, true);
});
