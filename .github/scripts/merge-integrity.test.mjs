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

test('SupportModule and LedgerModule are both in the root module imports', () => {
  const imports = app.match(/imports:\s*\[([\s\S]*?)\n  \],/);
  assert.ok(imports, 'Root module imports must be identifiable');
  for (const name of ['SupportModule', 'LedgerModule']) {
    assert.match(imports[1], new RegExp(`^\\s*${name},`, 'm'));
  }
});

test('support and ledger audit identifiers both remain allowlisted', () => {
  for (const key of [
    'supportTicketId', 'supportMessageId', 'ledgerTransactionId',
    'reversesTransactionId', 'actorSystem',
  ]) {
    assert.match(audit, new RegExp(`^\\s*'${key}',`, 'm'));
  }
});

test('migration inventory preserves both support and ledger ownership', () => {
  const support = '20261004120000_r13_support_tickets';
  const ledger = '20261004150000_r15_ledger_foundation';
  for (const name of ['SupportTicket', 'SupportMessage']) {
    assert.ok(index.models[name]?.includes(support), `Missing support inventory: ${name}`);
  }
  for (const name of ['LedgerAccount', 'LedgerTransaction', 'LedgerEntry']) {
    assert.ok(index.models[name]?.includes(ledger), `Missing ledger inventory: ${name}`);
  }
  for (const migration of [support, ledger]) {
    assert.ok(index.models.Permission.includes(migration), `Missing permission migration: ${migration}`);
  }
});

test('startup uses explicit fail-fast bash on both operating systems', () => {
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(workflow, /    defaults:\n      run:\n        shell: bash\n/);
  assert.doesNotMatch(workflow.split('    steps:')[1], /^ {8}shell:/m, 'A per-step shell must not weaken job defaults');
  assert.match(workflow, /if-no-files-found: error/, 'Browser evidence remains mandatory');
});

test('startup shell refuses a failed native command before a later success', () => {
  const result = spawnSync('bash', [
    '--noprofile', '--norc', '-e', '-o', 'pipefail', '-c',
    'node -e "process.exit(23)"\nnode -e "console.log(\'UNREACHABLE_AFTER_FAILURE\')"',
  ], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 23, result.stderr);
  assert.doesNotMatch(result.stdout, /UNREACHABLE_AFTER_FAILURE/);
});

test('startup shell refuses an upstream pipeline failure', () => {
  const result = spawnSync('bash', [
    '--noprofile', '--norc', '-e', '-o', 'pipefail', '-c',
    'node -e "process.exit(29)" | node -e "process.stdin.resume()"\nnode -e "console.log(\'UNREACHABLE_AFTER_PIPELINE\')"',
  ], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 29, result.stderr);
  assert.doesNotMatch(result.stdout, /UNREACHABLE_AFTER_PIPELINE/);
});
