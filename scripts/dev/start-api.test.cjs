'use strict';

// REAL PowerShell execution of scripts/dev/start-api.ps1 (Windows PowerShell
// 5.1 and/or PowerShell 7, whichever is installed). Only `pnpm` is replaced,
// by a fixture placed first on PATH, so the stage ordering, exit-code checks
// and the "stop at the first failure" rule are those of the real script.

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

function shells() {
  const found = [];
  for (const shell of process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh']) {
    const probe = spawnSync(shell, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });
    if (probe.status === 0) found.push({ shell, major: probe.stdout.trim() });
  }
  return found;
}

async function fixture(t, failAt) {
  // Spaces on purpose.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm start api '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'scripts/dev'), { recursive: true });
  await fs.copyFile(
    path.join(__dirname, 'start-api.ps1'),
    path.join(root, 'scripts/dev/start-api.ps1'),
  );
  const record = (name) =>
    `require('node:fs').appendFileSync(${JSON.stringify(path.join(root, 'calls.log'))}, ${JSON.stringify(name)} + ' ' + process.argv.slice(2).join(' ') + '\\n');`;
  await fs.writeFile(path.join(root, 'scripts/dev/preflight.cjs'), `${record('preflight')}\n`);
  await fs.writeFile(path.join(root, 'scripts/dev/run-api.cjs'), `${record('run-api')}\n`);
  const bin = path.join(root, 'fake bin');
  await fs.mkdir(bin);
  await fs.writeFile(
    path.join(bin, 'fake-pnpm.cjs'),
    `${record('pnpm')}\nconst args = process.argv.slice(2).join(' ');\n` +
      `if (${JSON.stringify(failAt)} && args.includes(${JSON.stringify(failAt ?? '')})) process.exit(3);\n`,
  );
  if (process.platform === 'win32') {
    await fs.writeFile(
      path.join(bin, 'pnpm.cmd'),
      '@echo off\r\nnode "%~dp0fake-pnpm.cjs" %*\r\nexit /b %ERRORLEVEL%\r\n',
    );
  } else {
    await fs.writeFile(
      path.join(bin, 'pnpm'),
      `#!/bin/sh\nexec node "$(dirname "$0")/fake-pnpm.cjs" "$@"\n`,
      {
        mode: 0o755,
      },
    );
  }
  return { root, bin };
}

function run(shell, f, args = []) {
  return spawnSync(
    shell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(f.root, 'scripts/dev/start-api.ps1'),
      ...args,
    ],
    {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      timeout: 120_000,
      windowsHide: true,
      env: { ...process.env, PATH: `${f.bin}${path.delimiter}${process.env.PATH}` },
    },
  );
}

async function calls(root) {
  try {
    return (await fs.readFile(path.join(root, 'calls.log'), 'utf8')).trim().split('\n');
  } catch {
    return [];
  }
}

const available = shells();

for (const { shell, major } of available) {
  test(`REAL PowerShell ${major} (${shell}): a database build failure stops the sequence and propagates its exit code`, async (t) => {
    const f = await fixture(t, '@homeservicemarketplace/database build');
    const result = run(shell, f);
    assert.equal(result.status, 3, result.stdout + result.stderr);
    assert.match(result.stdout, /FAIL Build @homeservicemarketplace\/database \(exit code 3/u);
    assert.match(result.stdout, /Later stages were not run/u);
    assert.deepEqual(await calls(f.root), [
      'preflight --api',
      'pnpm --filter @homeservicemarketplace/database build',
    ]);
    assert.doesNotMatch(result.stdout, /Start the API watcher/u);
  });

  test(`REAL PowerShell ${major} (${shell}): stages run in order and the watcher starts only after all pass`, async (t) => {
    const f = await fixture(t, null);
    const result = run(shell, f);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(
      await calls(f.root),
      [
        'preflight --api',
        'pnpm --filter @homeservicemarketplace/database build',
        'pnpm --filter @homeservicemarketplace/contracts build',
        'pnpm --filter @homeservicemarketplace/api exec tsc --noEmit',
        'run-api ',
      ].map((line) => line.trimEnd()),
    );
  });
}

test(
  'at least one PowerShell is available where PowerShell support is claimed',
  { skip: process.platform !== 'win32' && 'PowerShell is optional off Windows' },
  () => {
    assert.ok(available.length > 0, 'Windows must provide PowerShell 5.1');
  },
);
