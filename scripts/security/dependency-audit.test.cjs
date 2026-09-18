'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  validateReport,
  assertNoExceptions,
  runAudit,
  parseArgs,
} = require('./dependency-audit.cjs');

const clean = () => ({
  advisories: {},
  muted: [],
  metadata: {
    totalDependencies: 42,
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
  },
});
const validate = (report, status = 0) => validateReport(JSON.stringify(report), status);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ pnpm: { overrides: {} } }));
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  fs.writeFileSync(path.join(root, '.npmrc'), '# No audit exceptions\n');
  return root;
}

test('accepts a complete zero-finding audit', () => assert.deepEqual(validate(clean()), clean()));
for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
  test(`fails on ${severity}, even when the process exits zero`, () => {
    const report = clean();
    report.metadata.vulnerabilities[severity] = 1;
    assert.throws(() => validate(report), /vulnerabilities remain/);
  });
}
for (const [label, raw] of [
  ['empty', ''],
  ['HTML', '<html>registry unavailable</html>'],
  ['truncated', '{'],
]) {
  test(`fails on ${label} output`, () => assert.throws(() => validateReport(raw, 0), /valid JSON/));
}
for (const report of [null, [], {}, { error: { code: 'REGISTRY_UNAVAILABLE' } }]) {
  test(`fails closed on missing registry response ${JSON.stringify(report)}`, () => {
    assert.throws(() => validate(report), /registry audit response/);
  });
}
for (const count of [-1, 0.5, '0', null]) {
  test(`rejects invalid vulnerability counter ${JSON.stringify(count)}`, () => {
    const report = clean();
    report.metadata.vulnerabilities.high = count;
    assert.throws(() => validate(report), /Incomplete audit schema/);
  });
}
test('requires every severity counter', () => {
  const report = clean();
  delete report.metadata.vulnerabilities.low;
  assert.throws(() => validate(report), /Incomplete audit schema/);
});
test('does not silently accept a new unknown severity', () => {
  const report = clean();
  report.metadata.vulnerabilities.unknown = 0;
  assert.throws(() => validate(report), /Incomplete audit schema/);
});
test('rejects an empty dependency tree', () => {
  const report = clean();
  report.metadata.totalDependencies = 0;
  assert.throws(() => validate(report), /Incomplete audit schema/);
});
test('requires an advisory map', () => {
  const report = clean();
  delete report.advisories;
  assert.throws(() => validate(report), /Incomplete audit schema/);
});
test('advisories cannot hide behind zero metadata counts', () => {
  const report = clean();
  report.advisories.example = { severity: 'low' };
  assert.throws(() => validate(report), /vulnerabilities remain/);
});
test('muted findings are not clean findings', () => {
  const report = clean();
  report.muted.push('GHSA-example');
  assert.throws(() => validate(report), /Muted advisories/);
});
for (const status of [1, 2, null]) {
  test(`a zero-finding payload cannot hide exit ${status}`, () => {
    assert.throws(() => validate(clean(), status), /process failed/);
  });
}
test('normal workspace policy is allowed', (t) => assertNoExceptions(fixture(t)));
test('package.json audit exceptions fail closed', (t) => {
  const root = fixture(t);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ pnpm: { auditConfig: { ignoreCves: ['CVE-test'] } } }),
  );
  assert.throws(() => assertNoExceptions(root), /exceptions are not permitted/);
});
for (const [file, content] of [
  ['pnpm-workspace.yaml', 'auditConfig:\n  ignoreGhsas: []\n'],
  ['.npmrc', 'ignoreRegistryErrors=true\n'],
]) {
  test(`rejects exceptions in ${file}`, (t) => {
    const root = fixture(t);
    fs.writeFileSync(path.join(root, file), content);
    assert.throws(() => assertNoExceptions(root), /exclusions are not permitted/);
  });
}
for (const production of [false, true]) {
  test(`executes the real audit command policy with production=${production}`, (t) => {
    const root = fixture(t);
    const output = path.join(root, 'reports', 'audit.json');
    const result = runAudit({
      root,
      output,
      production,
      execute: (command, args, options) => {
        assert.ok(command === 'pnpm' || command === process.execPath);
        assert.deepEqual(args.slice(-4 - Number(production)), [
          'audit',
          '--json',
          '--audit-level',
          'low',
          ...(production ? ['--prod'] : []),
        ]);
        assert.equal(options.cwd, root);
        assert.equal(options.shell, false);
        assert.ok(options.timeout > 0);
        return { status: 0, stdout: JSON.stringify(clean()) };
      },
    });
    assert.deepEqual(result, clean());
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), clean());
  });
}
for (const failure of [
  { error: new Error('unavailable'), status: null, stdout: '' },
  { signal: 'SIGTERM', status: null, stdout: '' },
  { status: 1, stdout: '<html>registry error</html>' },
]) {
  test(`failed processes retain evidence and fail the gate: ${failure.status}/${failure.signal ?? 'none'}`, (t) => {
    const root = fixture(t);
    const output = path.join(root, 'audit.json');
    assert.throws(() => runAudit({ root, output, execute: () => failure }));
    assert.equal(fs.readFileSync(output, 'utf8'), failure.stdout);
  });
}
test('CLI defaults to the full tree', () => {
  assert.deepEqual(parseArgs([]), { production: false, output: 'audit-full.json' });
  assert.deepEqual(parseArgs(['--prod']), { production: true, output: 'audit-production.json' });
});
for (const args of [['--output'], ['--audit-level', 'high'], ['--ignore-registry-errors']]) {
  test(`CLI rejects missing/weakening/unknown arguments ${args.join(' ')}`, () => {
    assert.throws(() => parseArgs(args), /Usage/);
  });
}
