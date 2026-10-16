import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { registryProblems, verifyRegistry, STATUS_INDEX } from './sprint-registry.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const registry = JSON.parse(
  await readFile(
    new URL('../../docs/production-readiness/post-r18/SPRINT_REGISTRY.json', import.meta.url),
    'utf8',
  ),
);
const clone = () => structuredClone(registry);

test('the committed post-R18 registry and status index are consistent', async () => {
  assert.deepEqual(await verifyRegistry(root), []);
});

for (const [name, change, pattern] of [
  [
    'a gap in the numbering',
    (r) => {
      r.sprints.splice(3, 1);
    },
    /expected 20 sprints/u,
  ],
  [
    'a duplicate id',
    (r) => {
      r.sprints[2].id = 'R20';
    },
    /duplicate id R20|must be R21/u,
  ],
  [
    'a renumbered sprint',
    (r) => {
      r.sprints[0].id = 'R18';
    },
    /must be R19/u,
  ],
  [
    'a wrong wave',
    (r) => {
      r.sprints[5].wave = 1;
    },
    /R24 must be wave 2/u,
  ],
  [
    'an invented title on a reserved id',
    (r) => {
      r.sprints[10].title = 'Something';
    },
    /must not carry an invented title/u,
  ],
  [
    'an unknown status',
    (r) => {
      r.sprints[0].status = 'DONE';
    },
    /unknown status/u,
  ],
  [
    'a same-wave dependency',
    (r) => {
      r.sprints[0].dependencies = ['R20'];
    },
    /earlier waves/u,
  ],
  [
    'a coordinator path outside a lease',
    (r) => {
      r.sprints[0].ownedPaths.prefixes.push('apps/api/src/config/');
    },
    /coordinator-owned/u,
  ],
  [
    'a missing frozen base',
    (r) => {
      r.sprints[0].frozenBase = 'abc';
    },
    /full frozen base/u,
  ],
  [
    'an unsafe path',
    (r) => {
      r.sprints[0].ownedPaths.exact.push('../elsewhere');
    },
    /unsafe path/u,
  ],
  [
    'two writers in one wave',
    (r) => {
      Object.assign(r.sprints[1], {
        title: 'Peer',
        branch: 'feat/r20',
        owner: {},
        status: 'PLANNED',
        frozenBase: r.sprints[0].frozenBase,
        requiredEvidence: ['x'],
        ownedPaths: { exact: [], prefixes: ['apps/api/src/modules/money/ledger/'] },
      });
    },
    /both own/u,
  ],
]) {
  test(`rejects ${name}`, () => {
    const r = clone();
    change(r);
    const problems = registryProblems(r);
    assert.ok(
      problems.some((p) => pattern.test(p)),
      problems.join('\n'),
    );
  });
}

test('a status index that names a sprint differently is rejected', async () => {
  const index = await readFile(new URL(`../../${STATUS_INDEX}`, import.meta.url), 'utf8');
  const changed = index.replace(
    'Extend and certify the existing money authority',
    'Something else',
  );
  assert.ok(registryProblems(registry, changed).some((p) => /names R19 differently/u.test(p)));
});
