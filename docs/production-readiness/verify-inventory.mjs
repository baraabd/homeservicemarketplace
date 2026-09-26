import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Optional root supports validating an audited source archive without pretending
// it is a local git clone. Documentation inputs always come from this directory.
const here = fileURLToPath(new URL('.', import.meta.url));
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(here, '../..');
const readJson = async (name) => JSON.parse(await readFile(path.join(here, name), 'utf8'));
const inventory = await readJson('FEATURE_INVENTORY.json');
const migrations = await readJson('baseline/MODEL_MIGRATION_INDEX.json');
const evidence = await readJson('baseline/EVIDENCE.json');
assert.match(inventory.baselineSha, /^[a-f0-9]{40}$/u);
assert.equal(inventory.baselineSha, migrations.baselineSha);
assert.equal(inventory.baselineSha, evidence.baselineSha);
const schema = await readFile(path.join(root, 'packages/database/prisma/schema.prisma'), 'utf8');
const models = new Set([...schema.matchAll(/^model\s+(\w+)\s*\{/gmu)].map((match) => match[1]));
const required = ['frontend', 'backend', 'routes', 'api', 'guard', 'contract', 'models', 'unit', 'integration', 'browser', 'configuration', 'flags', 'risk'];
let sourceReferences = 0;
for (const [name, profile] of Object.entries(inventory.profiles)) {
  for (const key of required) assert.ok(Object.hasOwn(profile, key), `${name}: missing ${key}`);
  const files = [...profile.frontend, ...profile.backend, ...profile.unit];
  if (profile.contract) files.push(profile.contract);
  files.push(...profile.integration.map((file) => `${inventory.interpretation.integrationRoot}/${file}`));
  files.push(...profile.browser.map((file) => `${inventory.interpretation.browserRoot}/${file}`));
  for (const file of files) {
    assert.ok(!path.isAbsolute(file) && !file.split('/').includes('..'), `Unsafe reference: ${file}`);
    await stat(path.join(root, file));
    sourceReferences += 1;
  }
  for (const model of profile.models) {
    assert.ok(models.has(model), `${name}: no Prisma model ${model}`);
    assert.ok(Object.hasOwn(migrations.models, model), `${name}: missing migration index for ${model}`);
  }
}
for (const [model, directories] of Object.entries(migrations.models)) {
  assert.ok(models.has(model), `Stale model ${model}`);
  for (const directory of directories) {
    assert.match(directory, /^[a-zA-Z0-9_]+$/u);
    const sql = await readFile(path.join(root, migrations.migrationRoot, directory, 'migration.sql'), 'utf8');
    assert.ok(sql.includes(`"${model}"`), `Unrelated migration: ${directory} / ${model}`);
  }
}
assert.equal(Object.keys(migrations.models).length, models.size);
const statuses = new Set(['IMPLEMENTED_NOT_PRODUCTION_CONFIGURED', 'IMPLEMENTED_FEATURE_GATED', 'PARTIALLY_IMPLEMENTED', 'MISSING', 'BLOCKED', 'TEST_ONLY', 'DOCUMENTATION_ONLY']);
const keys = new Set();
for (const group of inventory.capabilityGroups) {
  assert.ok(inventory.profiles[group.profile], `Unknown profile ${group.profile}`);
  assert.ok(statuses.has(group.status), `Unsupported or unproven COMPLETE status ${group.status}`);
  assert.ok(group.owner && group.capabilities.length > 0);
  for (const capability of group.capabilities) {
    const key = `${group.track}/${capability}`;
    assert.ok(!keys.has(key), `Duplicate capability ${key}`);
    keys.add(key);
  }
}
assert.equal(keys.size, 79);
console.log(`PASS ${keys.size} capabilities, ${Object.keys(inventory.profiles).length} profiles, ${models.size} models, ${sourceReferences} source references`);
console.log('This checks documentation consistency, not application runtime or production completion.');
