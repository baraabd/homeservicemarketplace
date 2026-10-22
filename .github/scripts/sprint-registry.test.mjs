import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registryProblems, verifyRegistry, STATUS_INDEX } from './sprint-registry.mjs';
import { G2_REQUIRED_EVIDENCE } from './wave-gate.mjs';

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
      // The active package is now recovered; preserve the unknown-package
      // negative input explicitly instead of making it depend on current work.
      r.sprints[10].status = 'RESERVED_PENDING_PACKAGE';
      r.sprints[10].branch = null;
      r.sprints[10].ownedPaths = null;
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

const G2_PATH = 'docs/production-readiness/post-r18/gates/g2/SOURCE_MANIFEST.json';
const WAVE3_PATH = 'docs/production-readiness/post-r18/waves/wave-03.plan.json';

// These are synthetic, temporary record inputs. They grant no actual ownership
// or acceptance and do not overwrite any repository evidence.
function g2RegistryFixture() {
  const r = clone();
  r.gates = { ...r.gates, G2: G2_PATH };
  r.waveManifests = { ...r.waveManifests, 3: WAVE3_PATH };
  const lanes = ['R29', 'R30', 'R31', 'R32', 'R33'].map((id, index) => ({
    id,
    lane: index + 1,
    title: null,
    branch: null,
    owner: null,
    status: 'RESERVED_PENDING_PACKAGE',
    frozenBaseSha: null,
    dependencies: null,
    exactFiles: [],
    leases: [],
  }));
  for (const lane of lanes) {
    Object.assign(
      r.sprints.find((sprint) => sprint.id === lane.id),
      {
        title: null,
        branch: null,
        owner: null,
        status: 'RESERVED_PENDING_PACKAGE',
        frozenBase: null,
        dependencies: null,
        ownedPaths: null,
        requiredEvidence: null,
        pr: null,
      },
    );
  }
  const r32 = r.sprints.find((sprint) => sprint.id === 'R32');
  Object.assign(r32, {
    title: 'Synthetic R32 package',
    branch: 'feat/r32-refund-recovery',
    owner: 'fixture writer',
    status: 'PLANNED',
    dependencies: ['R24', 'R22', 'R23'],
    ownedPaths: {
      exact: ['apps/api/src/modules/money/refunds/fixture-only.spec.ts'],
      prefixes: [],
      leases: [],
    },
    requiredEvidence: ['synthetic evidence only'],
    startBarrier: { gate: 'G2', decision: 'BLOCKED' },
  });
  Object.assign(lanes[3], {
    title: r32.title,
    branch: r32.branch,
    owner: r32.owner,
    status: 'BLOCKED',
    dependencies: structuredClone(r32.dependencies),
    exactFiles: structuredClone(r32.ownedPaths.exact),
  });
  const gate = {
    schemaVersion: 1,
    gateId: 'G2',
    decision: 'BLOCKED',
    candidateSourceSha: 'a'.repeat(40),
    candidateTreeSha: 'b'.repeat(40),
    frozenBaseSha: null,
    frozenTreeSha: null,
    acceptedSprints: [],
    blockers: [{ id: 'SYNTHETIC', state: 'OPEN' }],
    mandatoryEvidence: G2_REQUIRED_EVIDENCE.map((id) => ({
      id,
      status: 'NOT_RUN',
      sourceSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      reference: 'synthetic fixture evidence only',
      ...(id === 'r28-checked-platform-plan' ? { scope: 'CONFIGURATION_ONLY' } : {}),
    })),
    externalBlockers: [
      {
        id: 'SYNTHETIC-R28-HOSTED',
        sprint: 'R28',
        state: 'HOSTED_ENVIRONMENT_BLOCKED',
        owner: 'fixture deployment owner',
        reference: 'synthetic external evidence',
      },
    ],
    publication: { state: 'DRAFT_PENDING_OWNER_REVIEW', acceptanceRecordCommitSha: null },
  };
  const wave = {
    schemaVersion: 1,
    wave: 3,
    startGate: 'G2',
    status: 'BLOCKED',
    baseSha: null,
    startableLanes: [],
    blockedLanes: lanes.map((lane) => lane.id),
    lanes,
  };
  return { registry: r, gate, wave };
}

function acceptG2Records(x) {
  Object.assign(x.gate, {
    decision: 'ACCEPTED',
    frozenBaseSha: x.gate.candidateSourceSha,
    frozenTreeSha: x.gate.candidateTreeSha,
    blockers: [],
    acceptedSprints: x.registry.sprints
      .filter((sprint) => sprint.wave < 3)
      .map((sprint) => sprint.id),
  });
  for (const entry of x.gate.mandatoryEvidence) entry.status = 'PASS';
  x.wave.baseSha = x.gate.frozenBaseSha;
  x.wave.lanes[3].frozenBaseSha = x.wave.baseSha;
  Object.assign(
    x.registry.sprints.find((sprint) => sprint.id === 'R32'),
    {
      frozenBase: x.wave.baseSha,
      startBarrier: { gate: 'G2', decision: 'ACCEPTED' },
    },
  );
}

async function withG2Records(mutate, assertion) {
  const x = g2RegistryFixture();
  const g1Path = 'docs/production-readiness/post-r18/gates/g1/SOURCE_MANIFEST.json';
  const wave2Path = 'docs/production-readiness/post-r18/waves/wave-02.plan.json';
  x.g1 = JSON.parse(await readFile(path.join(root, g1Path), 'utf8'));
  x.wave2 = JSON.parse(await readFile(path.join(root, wave2Path), 'utf8'));
  const g3Path = 'docs/production-readiness/post-r18/gates/g3/SOURCE_MANIFEST.json';
  const wave4Path = 'docs/production-readiness/post-r18/waves/wave-04.plan.json';
  x.g3 = JSON.parse(await readFile(path.join(root, g3Path), 'utf8'));
  x.wave4 = JSON.parse(await readFile(path.join(root, wave4Path), 'utf8'));
  mutate(x);
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'hsm-g2-registry-fixture-'));
  try {
    const index = x.registry.sprints
      .map(
        (sprint) =>
          `| ${sprint.id} | ${sprint.title ?? '(pending package)'} | ${sprint.wave} | ${sprint.status} |`,
      )
      .join('\n');
    const files = [
      [g1Path, JSON.stringify(x.g1)],
      [wave2Path, JSON.stringify(x.wave2)],
      ['docs/production-readiness/post-r18/SPRINT_REGISTRY.json', JSON.stringify(x.registry)],
      [STATUS_INDEX, index],
      [G2_PATH, JSON.stringify(x.gate)],
      [WAVE3_PATH, JSON.stringify(x.wave)],
      [g3Path, JSON.stringify(x.g3)],
      [wave4Path, JSON.stringify(x.wave4)],
    ];
    for (const [file, content] of files) {
      await mkdir(path.dirname(path.join(fixtureRoot, file)), { recursive: true });
      await writeFile(path.join(fixtureRoot, file), content);
    }
    await assertion(fixtureRoot, x);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

test('a supplied Wave 3 package can be planned with no base only behind canonical blocked G2', () => {
  assert.deepEqual(registryProblems(g2RegistryFixture().registry), []);
});

test('a Wave 3 null base is not permitted by the earlier G1 barrier', () => {
  const x = g2RegistryFixture();
  x.registry.sprints.find((sprint) => sprint.id === 'R32').startBarrier.gate = 'G1';
  assert.ok(
    registryProblems(x.registry).some((problem) => /R32 needs a full frozen base/u.test(problem)),
  );
});

test('a blocked-gate exception does not grant a ready Wave 3 status', () => {
  const x = g2RegistryFixture();
  x.registry.sprints.find((sprint) => sprint.id === 'R32').status = 'READY_TO_START';
  assert.ok(
    registryProblems(x.registry).some((problem) => /R32 needs a full frozen base/u.test(problem)),
  );
});

test('Wave 3 ownership still rejects two writers before the gate is accepted', () => {
  const x = g2RegistryFixture();
  const r32 = x.registry.sprints.find((sprint) => sprint.id === 'R32');
  Object.assign(
    x.registry.sprints.find((sprint) => sprint.id === 'R33'),
    structuredClone(r32),
    {
      id: 'R33',
      lane: 5,
      branch: 'feat/synthetic-r33',
      title: 'Synthetic peer',
    },
  );
  assert.ok(registryProblems(x.registry).some((problem) => /R32 and R33 both own/u.test(problem)));
});

test('the registry reader validates G2 and Wave 3 alongside the unchanged G1 records', async () => {
  await withG2Records(
    () => {},
    async (fixtureRoot) => {
      assert.deepEqual(await verifyRegistry(fixtureRoot), []);
    },
  );
});

for (const [name, mutate] of [
  [
    'missing gate path',
    (x) => {
      delete x.registry.gates.G2;
    },
  ],
  [
    'missing wave path',
    (x) => {
      delete x.registry.waveManifests['3'];
    },
  ],
  [
    'substituted gate path',
    (x) => {
      x.registry.gates.G2 = '../untrusted-gate.json';
    },
  ],
  [
    'substituted wave path',
    (x) => {
      x.registry.waveManifests['3'] = 'another-wave.json';
    },
  ],
  [
    'known package without G2 registration',
    (x) => {
      delete x.registry.gates.G2;
      delete x.registry.waveManifests['3'];
      x.registry.sprints.find((sprint) => sprint.id === 'R32').frozenBase = 'a'.repeat(40);
    },
  ],
]) {
  test(`the registry reader rejects ${name}`, async () => {
    await withG2Records(mutate, async (fixtureRoot) => {
      assert.ok(
        (await verifyRegistry(fixtureRoot)).includes('G2 records must use the canonical paths'),
      );
    });
  });
}

test('the registry reader does not ignore a ready lane behind a blocked G2 file', async () => {
  await withG2Records(
    (x) => {
      x.wave.startableLanes = ['R32'];
    },
    async (fixtureRoot) => {
      assert.ok(
        (await verifyRegistry(fixtureRoot)).some((problem) =>
          /blocked G2 cannot authorize/u.test(problem),
        ),
      );
    },
  );
});

test('the registry reader permits complete G2 evidence held for owner publication', async () => {
  await withG2Records(acceptG2Records, async (fixtureRoot) => {
    assert.deepEqual(await verifyRegistry(fixtureRoot), []);
  });
});

test('an accepted G2 file cannot bypass an unmerged G1 prerequisite', async () => {
  await withG2Records(
    (x) => {
      acceptG2Records(x);
      x.g1.publication.state = 'DRAFT_PENDING_OWNER_REVIEW';
    },
    async (fixtureRoot) => {
      assert.ok(
        (await verifyRegistry(fixtureRoot)).includes(
          'G2 acceptance requires the verified merged G1 prerequisite',
        ),
      );
    },
  );
});

test('all recovered Wave 4 packages remain planned with null bases only behind G3', () => {
  const r = clone();
  // Explicit blocked preparation fixture survives a later honest G3 release.
  // The separate active-reader test validates the current publication state.
  for (const sprint of r.sprints.filter((entry) => entry.wave === 4))
    Object.assign(sprint, {
      status: 'PLANNED',
      frozenBase: null,
      startBarrier: { gate: 'G3', decision: 'BLOCKED' },
    });
  assert.deepEqual(registryProblems(r), []);
  for (const sprint of r.sprints.filter((entry) => entry.wave === 4)) {
    assert.equal(sprint.status, 'PLANNED');
    assert.equal(sprint.frozenBase, null);
    assert.equal(sprint.startBarrier.gate, 'G3');
    sprint.startBarrier.gate = 'G2';
    assert.ok(
      registryProblems(r).some((problem) =>
        problem.includes(`${sprint.id} needs a full frozen base`),
      ),
    );
    sprint.startBarrier.gate = 'G3';
  }
});

for (const [name, mutate] of [
  [
    'missing G3',
    (x) => {
      delete x.registry.gates.G3;
    },
  ],
  [
    'missing Wave 4',
    (x) => {
      delete x.registry.waveManifests['4'];
    },
  ],
  [
    'G2 substituted for G3',
    (x) => {
      x.registry.gates.G3 = G2_PATH;
    },
  ],
  [
    'Wave 3 substituted for Wave 4',
    (x) => {
      x.registry.waveManifests['4'] = WAVE3_PATH;
    },
  ],
])
  test(`the registry reader refuses ${name}`, async () => {
    await withG2Records(mutate, async (fixtureRoot) => {
      assert.ok(
        (await verifyRegistry(fixtureRoot)).includes('G3 records must use the canonical paths'),
      );
    });
  });

test('R38 final evidence join is not a same-wave source-build dependency', () => {
  const r = clone();
  const r38 = r.sprints.find((sprint) => sprint.id === 'R38');
  assert.deepEqual(r38.finalEvidenceJoin, ['R34', 'R35', 'R36', 'R37']);
  assert.ok(r38.dependencies.every((id) => r.sprints.find((sprint) => sprint.id === id).wave < 4));
  r38.dependencies.push('R34');
  assert.ok(
    registryProblems(r).some((problem) => /R38 may depend only on earlier waves/u.test(problem)),
  );
});
