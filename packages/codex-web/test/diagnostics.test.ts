import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  collectDiagnosticsSummary,
  type DiagnosticsCommandRunner,
} from '../src/diagnostics.js';

test('diagnostics summary reports host maintenance without treating usage failure as fatal', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-diagnostics-'));
  const reportsDir = path.join(stateDir, 'reports');
  const backupsDir = path.join(stateDir, 'backups');
  const rebootRequiredPath = path.join(stateDir, 'reboot-required');
  const rebootRequiredPackagesPath = path.join(stateDir, 'reboot-required.pkgs');
  await fs.mkdir(reportsDir);
  await fs.mkdir(path.join(backupsDir, '20260610-010203'), { recursive: true });
  await fs.writeFile(rebootRequiredPath, '');
  await fs.writeFile(rebootRequiredPackagesPath, 'linux-image-6.8.0-124-generic\nlinux-base\n');

  const commands: string[] = [];
  const runCommand: DiagnosticsCommandRunner = async (command, args) => {
    commands.push([command, ...args].join(' '));
    if (command === 'npm') {
      return { exitCode: 0, stdout: '10.9.2\n', stderr: '' };
    }
    if (command === 'codex') {
      return { exitCode: 0, stdout: 'codex-cli 0.42.0\n', stderr: '' };
    }
    if (command === 'git') {
      return { exitCode: 0, stdout: 'abc1234\n', stderr: '' };
    }
    if (command === 'systemctl' && args[0] === 'is-active') {
      return { exitCode: 0, stdout: 'active\n', stderr: '' };
    }
    if (command === 'systemctl' && args[0] === 'is-enabled') {
      return { exitCode: 0, stdout: 'enabled\n', stderr: '' };
    }
    if (command === 'apt') {
      return {
        exitCode: 0,
        stdout: [
          'Listing...',
          'bash/noble-updates 5.2 amd64 [upgradable from: 5.1]',
          'curl/noble-updates 8.5 amd64 [upgradable from: 8.4]',
        ].join('\n'),
        stderr: 'WARNING: apt does not have a stable CLI interface.\n',
      };
    }
    return { exitCode: 127, stdout: '', stderr: 'missing' };
  };

  try {
    const summary = await collectDiagnosticsSummary({
      config: {
        host: '127.0.0.1',
        port: 43210,
        defaultCwd: '/opt/workday',
        codexBin: 'codex',
        stateDir,
        authPath: path.join(stateDir, 'auth.json'),
        reportsDir,
        reportIndexPath: path.join(stateDir, 'report-index.json'),
        envPath: path.join(stateDir, 'service.env'),
        debug: false,
      },
      authConfigured: true,
      identityState: {
        settings: { multiUserEnabled: false, siteTitle: 'Codex Web' },
        users: [],
        roles: [],
        projects: [],
        sessions: [],
        shares: [],
      },
      runtime: {
        listModels: async () => [{ id: 'third-party-model', name: 'Third Party' }],
        readUsage: async () => {
          throw new Error('official usage endpoint unavailable');
        },
        getActiveTurnCount: () => 2,
      },
      terminalCount: 3,
      backupRoot: backupsDir,
      rebootRequiredPath,
      rebootRequiredPackagesPath,
      runCommand,
    });

    assert.equal(summary.auth.configured, true);
    assert.equal(summary.identity.mode, 'single');
    assert.equal(summary.storage.stateDir.writable, true);
    assert.equal(summary.storage.reportsDir.exists, true);
    assert.equal(summary.runtime.activeTurnCount, 2);
    assert.equal(summary.runtime.terminalCount, 3);
    assert.equal(summary.provider.status, 'provider_ok');
    assert.equal(summary.provider.models.count, 1);
    assert.equal(summary.provider.usage.status, 'unavailable');
    assert.equal(summary.provider.usage.required, false);
    assert.equal(summary.system.reboot.required, true);
    assert.deepEqual(summary.system.reboot.packages, ['linux-image-6.8.0-124-generic', 'linux-base']);
    assert.equal(summary.system.upgrades.count, 2);
    assert.equal(summary.service.active, true);
    assert.equal(summary.service.enabled, true);
    assert.equal(summary.backup.latest?.name, '20260610-010203');
    assert.equal(summary.versions.npm, '10.9.2');
    assert.equal(summary.versions.codex, 'codex-cli 0.42.0');
    assert.equal(summary.version.gitCommit, 'abc1234');
    assert.ok(commands.includes('apt list --upgradable'));
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
