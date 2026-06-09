import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  inspectWorkspaceDiff,
  inspectWorkspaceFile,
  inspectWorkspaceStatus,
} from '../src/workspace_inspector.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function createGitWorkspace(): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-workspace-git-'));
  await git(cwd, ['init']);
  await git(cwd, ['config', 'user.email', 'codex-web@example.test']);
  await git(cwd, ['config', 'user.name', 'Codex Web']);
  await fs.writeFile(path.join(cwd, 'tracked.txt'), 'base\n');
  await git(cwd, ['add', 'tracked.txt']);
  await git(cwd, ['commit', '-m', 'initial commit']);
  return cwd;
}

test('workspace status reports non-git directories without failing', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-workspace-plain-'));
  try {
    await fs.writeFile(path.join(cwd, 'note.txt'), 'hello');

    const status = await inspectWorkspaceStatus(cwd);

    assert.equal(status.cwd, cwd);
    assert.equal(status.exists, true);
    assert.equal(status.isGitRepository, false);
    assert.equal(status.branch, null);
    assert.equal(status.upstream, null);
    assert.equal(status.counts.staged, 0);
    assert.equal(status.counts.unstaged, 0);
    assert.equal(status.counts.untracked, 0);
    assert.equal(status.diskWritable, true);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('workspace status reports branch, upstream, commit, and dirty counts', async () => {
  const cwd = await createGitWorkspace();
  try {
    await fs.writeFile(path.join(cwd, 'tracked.txt'), 'base\nunstaged\n');
    await fs.writeFile(path.join(cwd, 'staged.txt'), 'staged\n');
    await fs.writeFile(path.join(cwd, 'untracked.txt'), 'untracked\n');
    await git(cwd, ['add', 'staged.txt']);

    const status = await inspectWorkspaceStatus(cwd);

    assert.equal(status.isGitRepository, true);
    assert.ok(status.branch === 'main' || status.branch === 'master');
    assert.equal(status.lastCommit?.message, 'initial commit');
    assert.equal(status.counts.staged, 1);
    assert.equal(status.counts.unstaged, 1);
    assert.equal(status.counts.untracked, 1);
    assert.equal(status.counts.total, 3);
    assert.deepEqual(status.files.map((file) => [file.path, file.indexStatus, file.worktreeStatus]), [
      ['staged.txt', 'A', ' '],
      ['tracked.txt', ' ', 'M'],
      ['untracked.txt', '?', '?'],
    ]);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('workspace diff returns file entries and hunk text for staged and unstaged changes', async () => {
  const cwd = await createGitWorkspace();
  try {
    await fs.writeFile(path.join(cwd, 'tracked.txt'), 'base\nunstaged\n');
    await fs.writeFile(path.join(cwd, 'staged.txt'), 'staged\n');
    await git(cwd, ['add', 'staged.txt']);

    const diff = await inspectWorkspaceDiff(cwd);

    assert.equal(diff.cwd, cwd);
    assert.equal(diff.files.length, 2);
    assert.ok(diff.raw.includes('diff --git'));
    assert.ok(diff.files.some((file) => file.path === 'tracked.txt' && file.hunks.some((hunk) => hunk.header.includes('@@'))));
    assert.ok(diff.files.some((file) => file.path === 'staged.txt' && file.hunks.some((hunk) => hunk.lines.some((line) => line.includes('+staged')))));
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('workspace file reads are scoped to cwd and reject traversal', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-workspace-file-'));
  try {
    await fs.writeFile(path.join(cwd, 'safe.txt'), 'safe');

    const file = await inspectWorkspaceFile(cwd, 'safe.txt');
    assert.equal(file.relativePath, 'safe.txt');
    assert.equal(file.content, 'safe');

    await assert.rejects(
      () => inspectWorkspaceFile(cwd, '../outside.txt'),
      (error: unknown) => (error as { code?: string }).code === 'workspace_path_forbidden',
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('workspace file reads reject symlinks that escape cwd', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-workspace-link-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-workspace-outside-'));
  try {
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(cwd, 'secret-link.txt'));

    await assert.rejects(
      () => inspectWorkspaceFile(cwd, 'secret-link.txt'),
      (error: unknown) => (error as { code?: string }).code === 'workspace_path_forbidden',
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
