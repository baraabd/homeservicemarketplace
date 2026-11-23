import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const schema = read('packages/database/prisma/schema.prisma');
const app = read('apps/api/src/app.module.ts');
const audit = read('apps/api/src/modules/iam/audit/audit.service.ts');
const index = JSON.parse(read('docs/production-readiness/baseline/MODEL_MIGRATION_INDEX.json'));
const workflow = read('.github/workflows/web-startup.yml');

// A fast regression fence for the semantic merge in PR #137. The mandatory
// Prisma validate/generate and real PostgreSQL suites remain the authority.
function model(source, name) {
  const body = source.match(new RegExp(`^model ${name} \\{\\n([\\s\\S]*?)^\\}`, 'm'));
  assert.ok(body, `Missing Prisma model: ${name}`);
  return body[1];
}

function job(source, name) {
  const header = source.match(new RegExp(`^  ${name}:\\n`, 'm'));
  assert.ok(header, `Missing CI job: ${name}`);
  const body = source.slice(header.index + header[0].length);
  const next = body.search(/^ {2}[a-z][a-z0-9-]*:\n/m);
  return next === -1 ? body : body.slice(0, next);
}

const inverseFields = [
  ['supportTicketsRequested', 'SupportTicket', 'SupportTicketRequester'],
  ['supportTicketsClosed', 'SupportTicket', 'SupportTicketCloser'],
  ['supportMessages', 'SupportMessage', null],
  ['ledgerAccounts', 'LedgerAccount', 'LedgerAccountOwner'],
];

function assertInverse(source, field, type, relation) {
  const user = model(source, 'User');
  const line = user.match(new RegExp(`^\\s*${field}\\s+${type}\\[\\][^\\n]*$`, 'm'));
  assert.ok(line, `Missing User.${field}`);
  if (relation) assert.ok(line[0].includes(`@relation("${relation}")`), `Wrong relation: ${field}`);
}

for (const [field, type, relation] of inverseFields) {
  test(`User retains ${field} alongside the other sprint relations`, () => {
    assertInverse(schema, field, type, relation);
  });

  test(`the merge fence refuses removal of User.${field}`, () => {
    const withoutField = schema.replace(new RegExp(`^\\s*${field}\\s+[^\\n]*\\n`, 'm'), '');
    assert.throws(() => assertInverse(withoutField, field, type, relation), /Missing User\./);
  });
}

function assertMoneyComposition(rootSource, moneySource) {
  const imports = rootSource.match(/imports:\s*\[([\s\S]*?)\n {2}\],/);
  assert.ok(imports, 'Root module imports must be identifiable');
  for (const name of ['SupportModule', 'MoneyModule']) {
    assert.equal(
      [...imports[1].matchAll(new RegExp(`^\\s*${name},`, 'gm'))].length,
      1,
      `${name} must be mounted once`,
    );
  }
  assert.doesNotMatch(imports[1], /^\s*LedgerModule,/m, 'Ledger belongs to one money composition');
  const moneyImports = moneySource.match(/imports:\s*\[([^\]]+)\]/);
  assert.ok(moneyImports, 'MoneyModule imports must be identifiable');
  assert.equal(
    [...moneyImports[1].matchAll(/\bLedgerModule\b/g)].length,
    1,
    'Existing ledger must be mounted once',
  );
  const moneyExports = moneySource.match(/exports:\s*\[([^\]]+)\]/);
  assert.ok(moneyExports, 'MoneyModule exports must be identifiable');
  assert.equal(
    [...moneyExports[1].matchAll(/\bLedgerModule\b/g)].length,
    1,
    'Existing ledger must remain exported',
  );
}

test('SupportModule coexists with one AppModule to MoneyModule to LedgerModule composition', () => {
  assertMoneyComposition(app, read('apps/api/src/modules/money/money.module.ts'));
});

test('the money composition fence rejects missing or duplicate mounts and lost exports', () => {
  const money = read('apps/api/src/modules/money/money.module.ts');
  const mutateLedger = (field, replacement) => {
    const mutated = money.replace(
      new RegExp(`(${field}:\\s*\\[)([^\\]]+)(\\])`),
      (_, opening, body, closing) =>
        `${opening}${body.replace(/\bLedgerModule\b,?/, replacement)}${closing}`,
    );
    assert.notEqual(mutated, money, `${field} fixture must change LedgerModule`);
    return mutated;
  };
  const withoutLedgerImport = mutateLedger('imports', '');
  const duplicateLedgerImport = mutateLedger('imports', 'LedgerModule, LedgerModule,');
  const withoutLedgerExport = mutateLedger('exports', '');
  assert.throws(() => assertMoneyComposition(app.replace(/^\s*MoneyModule,/m, ''), money));
  assert.throws(() =>
    assertMoneyComposition(
      app.replace('    MoneyModule,', '    MoneyModule,\n    MoneyModule,'),
      money,
    ),
  );
  assert.throws(() => assertMoneyComposition(app.replace(/^\s*SupportModule,/m, ''), money));
  assert.throws(() => assertMoneyComposition(app, withoutLedgerImport));
  assert.throws(() => assertMoneyComposition(app, duplicateLedgerImport));
  assert.throws(() => assertMoneyComposition(app, withoutLedgerExport));
});

test('support and ledger audit identifiers both remain allowlisted', () => {
  for (const key of [
    'supportTicketId',
    'supportMessageId',
    'ledgerTransactionId',
    'reversesTransactionId',
    'actorSystem',
  ]) {
    assert.match(audit, new RegExp(`^\\s*'${key}',`, 'm'));
  }
});

test('migration inventory preserves both support and ledger ownership', () => {
  for (const [migration, names] of [
    ['20261004120000_r13_support_tickets', ['SupportTicket', 'SupportMessage']],
    ['20261004150000_r15_ledger_foundation', ['LedgerAccount', 'LedgerTransaction', 'LedgerEntry']],
    [
      '20261017163000_r24_money_api_orchestration',
      [
        'MoneyCommand',
        'MoneyIntentBinding',
        'MoneyExternalEvent',
        'MoneyRefundRequest',
        'MoneyDispatch',
      ],
    ],
  ]) {
    for (const name of names) {
      model(schema, name);
      assert.ok(index.models[name]?.includes(migration), `Missing migration inventory: ${name}`);
      assert.ok(
        read(`${index.migrationRoot}/${migration}/migration.sql`).includes(`"${name}"`),
        `Inventory does not reference the model: ${name}`,
      );
    }
    assert.ok(
      index.models.Permission.includes(migration),
      `Missing permission migration: ${migration}`,
    );
  }
});

test('startup uses explicit fail-fast bash on both operating systems', () => {
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(workflow, / {4}defaults:\n {6}run:\n {8}shell: bash\n/);
  assert.doesNotMatch(
    workflow.split('    steps:')[1],
    /^ {8}shell:/m,
    'A per-step shell must not weaken job defaults',
  );
  assert.match(workflow, /if-no-files-found: error/, 'Browser evidence remains mandatory');
});

test('startup shell refuses a failed native command before a later success', () => {
  const result = spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      '-e',
      '-o',
      'pipefail',
      '-c',
      'node -e "process.exit(23)"\nnode -e "console.log(\'UNREACHABLE_AFTER_FAILURE\')"',
    ],
    { encoding: 'utf8' },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 23, result.stderr);
  assert.doesNotMatch(result.stdout, /UNREACHABLE_AFTER_FAILURE/);
});

test('startup shell refuses an upstream pipeline failure', () => {
  const result = spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      '-e',
      '-o',
      'pipefail',
      '-c',
      'node -e "process.exit(29)" | node -e "process.stdin.resume()"\nnode -e "console.log(\'UNREACHABLE_AFTER_PIPELINE\')"',
    ],
    { encoding: 'utf8' },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 29, result.stderr);
  assert.doesNotMatch(result.stdout, /UNREACHABLE_AFTER_PIPELINE/);
});

test('CI retains the actual R12, R13 and R14 real-browser journeys', () => {
  const ci = job(read('.github/workflows/ci.yml'), 'phase5-real-api');
  const steps = ci.split(/^ {6}- /m);
  for (const [spec, artifact] of [
    ['r12-booking-communication.real-api.spec.ts', 'r12-booking-communication-evidence'],
    ['r13-support.real-api.spec.ts', 'r13-support-evidence'],
    ['r14-budget-authority.real-api.spec.ts', 'r14-budget-authority-evidence'],
  ]) {
    assert.ok(read(`apps/web/e2e/${spec}`).length > 0, `Missing real-browser source: ${spec}`);
    assert.ok(
      steps.some(
        (step) =>
          step.includes('pnpm --filter @homeservicemarketplace/web exec playwright test') &&
          step.includes(`e2e/${spec}`),
      ),
      `Missing real-browser execution: ${spec}`,
    );
    assert.ok(
      steps.some(
        (step) =>
          step.includes('uses: actions/upload-artifact@') &&
          step.includes(`name: ${artifact}`) &&
          step.includes('apps/web/test-results/'),
      ),
      `Missing retained evidence: ${artifact}`,
    );
  }
});

test('real PostgreSQL integration keeps the complete current API suite enabled', () => {
  const integration = job(read('.github/workflows/ci.yml'), 'integration-e2e');
  assert.match(integration, /RUN_DB_INTEGRATION: '1'/);
  assert.match(integration, /pnpm --filter @homeservicemarketplace\/database migrate:deploy/);
  assert.match(
    integration,
    /run: pnpm --filter @homeservicemarketplace\/api test --json --outputFile=g1-api-report\.json\s*\n/,
  );
  assert.match(integration, /uses: actions\/checkout@/);
  assert.doesNotMatch(
    integration,
    /^ {10}ref: '[a-f0-9]{40}'/m,
    'Integration must not validate a historical pinned source',
  );
});
