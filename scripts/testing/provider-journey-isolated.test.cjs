/* Isolated checks, not a substitute for Jest, browser E2E or a real database.
 * Run from the repository root after installing dev dependencies:
 *   node --test scripts/testing/provider-journey-isolated.test.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const helperPath = path.join(root,
  'apps/api/src/modules/provider/onboarding/market/primary-specialty-default.ts');
const source = fs.readFileSync(helperPath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics.length, 0);
const exportsObject = {};
vm.runInNewContext(compiled.outputText, { exports: exportsObject });
const { seedPrimarySpecialty } = exportsObject;
const plain = (value) => JSON.parse(JSON.stringify(value));
const empty = { primaryServiceCategoryId: null, serviceCategories: [], categoryApplications: [] };
const category = (id, sortOrder = 0, extra = {}) => ({
  id, sortOrder, isLeaf: true, isActive: true, deletedAt: null, ...extra,
});
function fixture(profile, count = 1) {
  const reads = [];
  const writes = [];
  return { reads, writes, db: { providerProfile: {
    findUnique: async (query) => { reads.push(plain(query)); return profile; },
    updateMany: async (query) => { writes.push(plain(query)); return { count }; },
  } } };
}

test('pending choice seeds a primary but writes no approval or grant', async () => {
  const chosen = category('painting');
  const f = fixture({ ...empty, categoryApplications: [{ serviceCategory: chosen }] });
  assert.equal((await seedPrimarySpecialty(f.db, 'p')).id, 'painting');
  assert.deepEqual(f.writes[0].data, { primaryServiceCategoryId: 'painting' });
});

test('read limits applications to live pending rows', async () => {
  const f = fixture(empty);
  await seedPrimarySpecialty(f.db, 'p');
  assert.deepEqual(f.reads[0].select.categoryApplications.where,
    { status: 'PENDING', supersededAt: null });
});

test('explicit primary is preserved', async () => {
  const f = fixture({ ...empty, primaryServiceCategoryId: 'explicit' });
  assert.equal(await seedPrimarySpecialty(f.db, 'p'), null);
  assert.equal(f.writes.length, 0);
});

for (const [name, profile] of [['missing profile', null], ['no selections', empty]]) {
  test(name, async () => {
    const f = fixture(profile);
    assert.equal(await seedPrimarySpecialty(f.db, 'p'), null);
    assert.equal(f.writes.length, 0);
  });
}

for (const [name, extra] of [
  ['parent category', { isLeaf: false }],
  ['inactive category', { isActive: false }],
  ['deleted category', { deletedAt: new Date('2026-01-01') }],
]) {
  test(name + ' cannot supply the default', async () => {
    const f = fixture({ ...empty,
      categoryApplications: [{ serviceCategory: category('excluded', 0, extra) }] });
    assert.equal(await seedPrimarySpecialty(f.db, 'p'), null);
    assert.equal(f.writes.length, 0);
  });
}

test('approved and pending choices use stable catalogue order', async () => {
  const f = fixture({ ...empty,
    serviceCategories: [{ serviceCategory: category('z', 5) }],
    categoryApplications: [{ serviceCategory: category('b', 1) },
      { serviceCategory: category('a', 1) }],
  });
  assert.equal((await seedPrimarySpecialty(f.db, 'p')).id, 'a');
});

test('a lost conditional write is not reported as a successful default', async () => {
  const f = fixture({ ...empty,
    categoryApplications: [{ serviceCategory: category('painting') }] }, 0);
  assert.equal(await seedPrimarySpecialty(f.db, 'p'), null);
  assert.equal(f.writes[0].where.primaryServiceCategoryId, null);
  assert.deepEqual(f.writes[0].where.OR[1].categoryApplications.some, {
    serviceCategoryId: 'painting', status: 'PENDING', supersededAt: null,
    serviceCategory: { isLeaf: true, isActive: true, deletedAt: null },
  });
});
