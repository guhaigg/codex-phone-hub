import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

function scriptPath(relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

function runScript(relativePath: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [scriptPath(relativePath), ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function requireSuccess(result: ReturnType<typeof runScript>) {
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function backupPathFromOutput(output: string): string {
  const match = output.match(/backup created:\s*(.+)\s*$/u);
  assert.ok(match?.[1], `missing backup path in output: ${output}`);
  return match[1].trim();
}

test('backup restore and rollback scripts recover state, service env, and source archives', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-service-flow-'));
  const appDir = path.join(root, 'app');
  const stateDir = path.join(root, 'state');
  const envPath = path.join(root, 'config', 'service.env');
  const backupRoot = path.join(root, 'backups');
  await fs.mkdir(path.join(appDir, 'src'), { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(path.dirname(envPath), { recursive: true });
  await fs.writeFile(path.join(appDir, 'package.json'), '{"name":"fixture"}\n');
  await fs.writeFile(path.join(appDir, 'src', 'marker.txt'), 'source-before\n');
  await fs.writeFile(path.join(stateDir, 'auth.json'), '{"token":"before"}\n');
  await fs.writeFile(envPath, 'CODEX_WEB_PORT=43210\n');

  try {
    const backup = runScript('scripts/service/backup-codex-web-state.sh', [
      '--app-dir', appDir,
      '--state-dir', stateDir,
      '--env-path', envPath,
      '--backup-root', backupRoot,
    ]);
    requireSuccess(backup);
    const backupDir = backupPathFromOutput(backup.stdout);
    const manifest = JSON.parse(await fs.readFile(path.join(backupDir, 'backup-manifest.json'), 'utf8')) as {
      sourceArchive?: string;
      rollbackCommand?: string;
    };
    assert.equal(manifest.sourceArchive, 'source.tar.gz');
    assert.match(manifest.rollbackCommand ?? '', /rollback-codex-web-release\.sh/u);

    await fs.writeFile(path.join(appDir, 'src', 'marker.txt'), 'source-after\n');
    await fs.writeFile(path.join(stateDir, 'auth.json'), '{"token":"after"}\n');
    await fs.writeFile(envPath, 'CODEX_WEB_PORT=9999\n');

    const dryRestore = runScript('scripts/service/restore-codex-web-state.sh', [
      '--backup', backupDir,
      '--state-dir', stateDir,
      '--env-path', envPath,
      '--dry-run',
    ], { CODEX_WEB_RESTORE_SERVICE_STATUS: 'inactive' });
    requireSuccess(dryRestore);
    assert.equal(await fs.readFile(path.join(stateDir, 'auth.json'), 'utf8'), '{"token":"after"}\n');
    assert.equal(await fs.readFile(envPath, 'utf8'), 'CODEX_WEB_PORT=9999\n');

    const refusedRestore = runScript('scripts/service/restore-codex-web-state.sh', [
      '--backup', backupDir,
      '--state-dir', stateDir,
      '--env-path', envPath,
    ], { CODEX_WEB_RESTORE_SERVICE_STATUS: 'active' });
    assert.notEqual(refusedRestore.status, 0);
    assert.match(refusedRestore.stderr, /service.*active.*--force/iu);

    const restore = runScript('scripts/service/restore-codex-web-state.sh', [
      '--backup', backupDir,
      '--state-dir', stateDir,
      '--env-path', envPath,
      '--force',
    ], { CODEX_WEB_RESTORE_SERVICE_STATUS: 'active' });
    requireSuccess(restore);
    assert.equal(await fs.readFile(path.join(stateDir, 'auth.json'), 'utf8'), '{"token":"before"}\n');
    assert.equal(await fs.readFile(envPath, 'utf8'), 'CODEX_WEB_PORT=43210\n');

    const dryRollback = runScript('scripts/service/rollback-codex-web-release.sh', [
      '--backup', backupDir,
      '--app-dir', appDir,
      '--skip-service',
      '--dry-run',
    ]);
    requireSuccess(dryRollback);
    assert.equal(await fs.readFile(path.join(appDir, 'src', 'marker.txt'), 'utf8'), 'source-after\n');

    const rollback = runScript('scripts/service/rollback-codex-web-release.sh', [
      '--backup', backupDir,
      '--app-dir', appDir,
      '--skip-service',
    ]);
    requireSuccess(rollback);
    assert.equal(await fs.readFile(path.join(appDir, 'src', 'marker.txt'), 'utf8'), 'source-before\n');

    const restoreDoc = await fs.readFile(scriptPath('docs/DEPLOYMENT.md'), 'utf8');
    assert.match(restoreDoc, /restore-codex-web-state\.sh/u);
    assert.match(restoreDoc, /rollback-codex-web-release\.sh/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
