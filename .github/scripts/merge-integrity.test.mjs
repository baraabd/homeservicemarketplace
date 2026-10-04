import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

// These regressions protect the integration points lost during the R13/R15
// semantic merge. Prisma validation and the real-service suites still prove
// runtime behavior; this check makes removal of their wiring fail immediately.
function model(source, name) {
  const body = source.match(new RegExp(`^model ${name} \\{\\n([\\s\\S]*?)^\\}`, 'm'));
  assert.ok(body, `Missing Prisma model: ${name}`);
  return body[1];
}

function job(source, name) {
  const header = source.match(new RegExp(`^  ${name}:\\n`, 'm'));
  assert.ok(header, `Missing CI job: ${name}`);
  const body = source.slice(header.index + header[0].length);
  const next = body.search(/^  [a-z][a-z0-9-]*:\n/m);
  return next === -1 ? body : body.slice(0, next);
}

test('User retains support and ledger relation mappings together', () => {
  const user = model(read('packages/database/prisma/schema.prisma'), 'User');
  for (const [field, type, relation] of [
    ['supportTicketsRequested', 'SupportTicket', 'SupportTicketRequester'],
    ['supportTicketsClosed', 'SupportTicket', 'SupportTicketCloser'],
    ['supportMessages', 'SupportMessage', null],
    ['ledgerAccounts', 'LedgerAccount', 'LedgerAccountOwner'],
  ]) {
    const line = user.match(new RegExp(`^\\s*${field}\\s+${type}\\[\\][^\\n]*$`, 'm'));
    assert.ok(line, `Missing User.${field}`);
    if (relation)
      assert.ok(line[0].includes(`@relation("${relation}")`), `Wrong relation: ${field}`);
  }
});

test('migration inventory preserves support and ledger models and permissions', () => {
  const index = JSON.parse(read('docs/production-readiness/baseline/MODEL_MIGRATION_INDEX.json'));
  const schema = read('packages/database/prisma/schema.prisma');
  for (const [migration, names] of [
    ['20261004120000_r13_support_tickets', ['SupportTicket', 'SupportMessage']],
    ['20261004150000_r15_ledger_foundation', ['LedgerAccount', 'LedgerTransaction', 'LedgerEntry']],
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
      index.models.Permission?.includes(migration),
      `Missing permission migration: ${migration}`,
    );
  }
});

test('support and ledger are both mounted in the application module', () => {
  const app = read('apps/api/src/app.module.ts');
  const imports = app.match(/imports:\s*\[([\s\S]*?)\n  \],/);
  assert.ok(imports, 'Root module imports must be identifiable');
  for (const name of ['SupportModule', 'LedgerModule']) {
    assert.match(imports[1], new RegExp(`^\\s*${name},`, 'm'));
  }
});

test('support and ledger audit identifiers remain allowlisted together', () => {
  const audit = read('apps/api/src/modules/iam/audit/audit.service.ts');
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

for (const [sprint, spec, artifact] of [
  ['R12', 'r12-booking-communication.real-api.spec.ts', 'r12-booking-communication-evidence'],
  ['R13', 'r13-support.real-api.spec.ts', 'r13-support-evidence'],
  ['R14', 'r14-budget-authority.real-api.spec.ts', 'r14-budget-authority-evidence'],
]) {
  test(`CI retains the ${sprint} real-browser execution and evidence`, () => {
    const ci = job(read('.github/workflows/ci.yml'), 'phase5-real-api');
    assert.ok(read(`apps/web/e2e/${spec}`).length > 0, `Missing real-browser source: ${spec}`);
    const steps = ci.split(/^      - /m);
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
  });
}

test('real PostgreSQL integration keeps the complete current API suite enabled', () => {
  const integration = job(read('.github/workflows/ci.yml'), 'integration-e2e');
  assert.match(integration, /RUN_DB_INTEGRATION: '1'/);
  assert.match(integration, /pnpm --filter @homeservicemarketplace\/database migrate:deploy/);
  assert.match(integration, /run: pnpm --filter @homeservicemarketplace\/api test\s*\n/);
  assert.match(integration, /uses: actions\/checkout@/);
  assert.doesNotMatch(
    integration,
    /^          ref: '[a-f0-9]{40}'/m,
    'Integration must not validate a historical pinned source',
  );
});
