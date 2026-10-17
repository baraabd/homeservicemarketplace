import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { G2_REQUIRED_EVIDENCE, waveGateProblems } from './wave-gate.mjs';

const read = async (file) =>
  JSON.parse(
    await readFile(
      new URL(`../../docs/production-readiness/post-r18/${file}`, import.meta.url),
      'utf8',
    ),
  );
const initial = {
  gate: await read('gates/g1/SOURCE_MANIFEST.json'),
  wave: await read('waves/wave-02.plan.json'),
  registry: await read('SPRINT_REGISTRY.json'),
};
// Negative controls must remain blocked fixtures when the real gate advances.
// They are synthetic validation inputs, never evidence or a live decision.
const copy = () => {
  const x = structuredClone(initial);
  Object.assign(x.gate, {
    decision: 'BLOCKED',
    frozenBaseSha: null,
    frozenTreeSha: null,
    acceptedSprints: [],
    blockers: [{ id: 'SYNTHETIC', state: 'OPEN' }],
    mandatoryEvidence: x.gate.mandatoryEvidence.map((e) => ({ ...e, status: 'NOT_RUN' })),
    publication: { state: 'DRAFT_PENDING_OWNER_REVIEW', acceptanceRecordCommitSha: null },
  });
  Object.assign(x.wave, {
    status: 'BLOCKED',
    baseSha: null,
    startableLanes: [],
    blockedLanes: x.wave.lanes.map((lane) => lane.id),
  });
  for (const lane of x.wave.lanes) {
    Object.assign(lane, { status: 'BLOCKED', frozenBaseSha: null });
    Object.assign(
      x.registry.sprints.find((s) => s.id === lane.id),
      {
        status: 'PLANNED',
        frozenBase: null,
        startBarrier: { gate: 'G1', decision: 'BLOCKED' },
      },
    );
  }
  return x;
};
const problems = ({ gate, wave, registry }) => waveGateProblems(gate, wave, registry);

test('the committed G1, wave manifest and registry are internally consistent', () => {
  assert.deepEqual(problems(initial), []);
});

test('blocked G1 preparation is internally consistent and grants no start', () => {
  const x = copy();
  assert.deepEqual(problems(x), []);
  assert.equal(x.gate.frozenBaseSha, null);
  assert.deepEqual(x.wave.startableLanes, []);
});

for (const [name, mutate, pattern] of [
  [
    'abbreviated candidate',
    (x) => {
      x.gate.candidateSourceSha = '54a69f7';
    },
    /full source/u,
  ],
  [
    'tree substituted as a base',
    (x) => {
      x.gate.frozenBaseSha = x.gate.candidateTreeSha;
    },
    /cannot freeze/u,
  ],
  [
    'ready lane behind blocked gate',
    (x) => {
      x.wave.startableLanes = ['R24'];
    },
    /cannot authorize/u,
  ],
  [
    'inconsistent lane base',
    (x) => {
      x.wave.lanes[1].frozenBaseSha = 'a'.repeat(40);
    },
    /inconsistent wave bases/u,
  ],
  [
    'same-wave dependency',
    (x) => {
      x.wave.lanes[0].dependencies = ['R25'];
    },
    /invalid dependency/u,
  ],
  [
    'duplicate writers',
    (x) => {
      x.wave.lanes[1].exactFiles.push(x.wave.lanes[0].exactFiles[0]);
    },
    /conflicting ownership/u,
  ],
  [
    'lease overlaps normal owner',
    (x) => {
      x.wave.lanes[1].leases[0].paths.push(x.wave.lanes[0].exactFiles[0]);
    },
    /conflicting ownership/u,
  ],
  [
    'lease overlaps another lease',
    (x) => {
      x.wave.lanes[4].leases[0].paths.push(x.wave.lanes[1].leases[0].paths[0]);
    },
    /conflicting ownership/u,
  ],
  [
    'unsafe lease',
    (x) => {
      x.wave.lanes[1].leases[0].paths.push('../secret');
    },
    /unsafe or non-exact/u,
  ],
  [
    'prefix mistaken for exact ownership',
    (x) => {
      x.wave.lanes[0].exactFiles.push('apps/api/src/modules/money/');
    },
    /non-exact/u,
  ],
  [
    'incomplete lease handoff',
    (x) => {
      delete x.wave.lanes[1].leases[0].handoff;
    },
    /incomplete lease/u,
  ],
  [
    'unsupported acceptance',
    (x) => {
      x.gate.decision = 'ACCEPTED';
    },
    /unsupported acceptance claim/u,
  ],
  [
    'missing lane',
    (x) => {
      x.wave.lanes.pop();
    },
    /five unique lanes/u,
  ],
  [
    'registry attempts a ready status',
    (x) => {
      x.registry.sprints[5].status = 'READY_TO_START';
    },
    /cannot claim readiness/u,
  ],
]) {
  test(`rejects ${name}`, () => {
    const x = copy();
    mutate(x);
    assert.ok(
      problems(x).some((p) => pattern.test(p)),
      problems(x).join('\n'),
    );
  });
}

// A synthetic, complete record tests the publication boundary only; it is not evidence.
function acceptedFixture() {
  const x = copy();
  Object.assign(x.gate, {
    decision: 'ACCEPTED',
    frozenBaseSha: x.gate.candidateSourceSha,
    frozenTreeSha: x.gate.candidateTreeSha,
    blockers: [],
    acceptedSprints: ['R19', 'R20', 'R21', 'R22', 'R23'],
    mandatoryEvidence: x.gate.mandatoryEvidence.map((e) => ({
      id: e.id,
      status: 'PASS',
      sourceSha: x.gate.candidateSourceSha,
      reference: 'synthetic fixture only',
    })),
  });
  x.gate.publication = { state: 'MERGED', acceptanceRecordCommitSha: 'b'.repeat(40) };
  x.wave.baseSha = x.gate.frozenBaseSha;
  x.wave.status = 'READY_TO_START';
  x.wave.startableLanes = x.wave.lanes.map((l) => l.id);
  x.wave.blockedLanes = [];
  for (const l of x.wave.lanes) {
    l.status = 'READY_TO_START';
    l.frozenBaseSha = x.wave.baseSha;
    Object.assign(
      x.registry.sprints.find((s) => s.id === l.id),
      { frozenBase: x.wave.baseSha, status: 'READY_TO_START' },
    );
  }
  return x;
}

test('supports a separately published complete record without a self-referential SHA', () => {
  assert.deepEqual(problems(acceptedFixture()), []);
});
test('accepted gate still refuses an unmerged publication', () => {
  const x = acceptedFixture();
  x.gate.publication.state = 'DRAFT_PENDING_OWNER_REVIEW';
  assert.ok(problems(x).some((p) => /separately published merged/u.test(p)));
});
test('a complete acceptance can await publication while all lanes remain held', () => {
  const x = acceptedFixture();
  x.gate.publication = {
    state: 'DRAFT_PENDING_OWNER_REVIEW',
    acceptanceRecordCommitSha: null,
  };
  x.wave.status = 'BLOCKED';
  x.wave.startableLanes = [];
  x.wave.blockedLanes = x.wave.lanes.map((lane) => lane.id);
  for (const lane of x.wave.lanes) {
    lane.status = 'BLOCKED';
    x.registry.sprints.find((s) => s.id === lane.id).status = 'PLANNED';
  }
  assert.deepEqual(problems(x), []);
});
test('accepted gate refuses a pending required run', () => {
  const x = acceptedFixture();
  x.gate.mandatoryEvidence[0].status = 'PENDING';
  assert.ok(problems(x).some((p) => /unsupported acceptance claim/u.test(p)));
});
test('accepted gate refuses an unresolved upstream dependency', () => {
  const x = acceptedFixture();
  x.gate.acceptedSprints = ['R19', 'R20', 'R21', 'R23'];
  assert.ok(problems(x).some((p) => /unresolved dependency R22/u.test(p)));
});

test('rejects acceptance with a deleted mandatory scenario', () => {
  const x = acceptedFixture();
  x.gate.mandatoryEvidence.pop();
  assert.ok(problems(x).some((p) => /evidence categories/u.test(p)));
});
test('rejects path aliases that could conceal another writer', () => {
  const x = copy();
  x.wave.lanes[1].exactFiles.push(`./${x.wave.lanes[0].exactFiles[0]}`);
  assert.ok(problems(x).some((p) => /unsafe or non-exact/u.test(p)));
});
test('rejects a held lane claiming readiness after acceptance', () => {
  const x = acceptedFixture();
  x.wave.blockedLanes = [x.wave.startableLanes.pop()];
  assert.ok(problems(x).some((p) => /held lane cannot claim/u.test(p)));
});
test('rejects startable lanes under a blocked wave even with accepted G1', () => {
  const x = acceptedFixture();
  x.wave.status = 'BLOCKED';
  assert.ok(problems(x).some((p) => /blocked wave cannot/u.test(p)));
});

// All G2 examples below are synthetic record-validation inputs. They are not
// source evidence, ownership grants, coordinator decisions or published gates.
function g2Fixture() {
  const registry = structuredClone(initial.registry);
  const candidateSourceSha = 'a'.repeat(40);
  const candidateTreeSha = 'b'.repeat(40);
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
      registry.sprints.find((sprint) => sprint.id === lane.id),
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
  const r32 = lanes[3];
  Object.assign(r32, {
    title: 'Synthetic R32 package',
    branch: 'feat/r32-refund-recovery',
    owner: 'synthetic fixture writer',
    status: 'BLOCKED',
    dependencies: ['R24', 'R22', 'R23'],
    exactFiles: ['apps/api/src/modules/money/refunds/fixture-only.spec.ts'],
  });
  Object.assign(
    registry.sprints.find((sprint) => sprint.id === 'R32'),
    {
      title: r32.title,
      branch: r32.branch,
      owner: r32.owner,
      status: 'PLANNED',
      dependencies: structuredClone(r32.dependencies),
      ownedPaths: { exact: structuredClone(r32.exactFiles), prefixes: [], leases: [] },
      requiredEvidence: ['synthetic fixture evidence'],
      startBarrier: { gate: 'G2', decision: 'BLOCKED' },
    },
  );
  return {
    registry,
    gate: {
      schemaVersion: 1,
      gateId: 'G2',
      decision: 'BLOCKED',
      candidateSourceSha,
      candidateTreeSha,
      frozenBaseSha: null,
      frozenTreeSha: null,
      acceptedSprints: [],
      blockers: [{ id: 'SYNTHETIC', state: 'OPEN' }],
      mandatoryEvidence: G2_REQUIRED_EVIDENCE.map((id) => ({
        id,
        status: 'NOT_RUN',
        sourceSha: candidateSourceSha,
        treeSha: candidateTreeSha,
        reference: 'synthetic fixture evidence only',
        ...(id === 'r28-checked-platform-plan' ? { scope: 'CONFIGURATION_ONLY' } : {}),
      })),
      externalBlockers: [
        {
          id: 'R28-SYNTHETIC-HOSTED',
          sprint: 'R28',
          state: 'HOSTED_ENVIRONMENT_BLOCKED',
          owner: 'synthetic deployment owner',
          reference: 'synthetic external blocker evidence',
        },
      ],
      publication: { state: 'DRAFT_PENDING_OWNER_REVIEW', acceptanceRecordCommitSha: null },
    },
    wave: {
      schemaVersion: 1,
      wave: 3,
      startGate: 'G2',
      status: 'BLOCKED',
      baseSha: null,
      startableLanes: [],
      blockedLanes: lanes.map((lane) => lane.id),
      lanes,
    },
  };
}

function acceptedG2Fixture(published = true) {
  const x = g2Fixture();
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
  if (published) {
    x.gate.publication = { state: 'MERGED', acceptanceRecordCommitSha: 'c'.repeat(40) };
    x.wave.status = 'READY_TO_START';
    x.wave.startableLanes = ['R32'];
    x.wave.blockedLanes = ['R29', 'R30', 'R31', 'R33'];
    x.wave.lanes[3].status = 'READY_TO_START';
    x.registry.sprints.find((sprint) => sprint.id === 'R32').status = 'READY_TO_START';
  }
  return x;
}

test('G2 preparation holds a supplied R32 package and leaves missing peers reserved', () => {
  const x = g2Fixture();
  assert.deepEqual(problems(x), []);
  assert.equal(x.gate.frozenBaseSha, null);
  assert.deepEqual(x.wave.startableLanes, []);
});

test('G2 technical evidence can await publication without releasing any lane', () => {
  const x = acceptedG2Fixture(false);
  assert.deepEqual(problems(x), []);
  assert.equal(x.wave.status, 'BLOCKED');
  assert.deepEqual(x.wave.startableLanes, []);
});

test('published G2 starts only a complete package and retains the R28 hosted hold', () => {
  const x = acceptedG2Fixture();
  assert.deepEqual(problems(x), []);
  assert.deepEqual(x.wave.startableLanes, ['R32']);
  assert.equal(x.gate.externalBlockers[0].state, 'HOSTED_ENVIRONMENT_BLOCKED');
});

for (const [name, make, mutate, pattern] of [
  [
    'abbreviated candidate',
    g2Fixture,
    (x) => {
      x.gate.candidateSourceSha = '1234567';
    },
    /full source/u,
  ],
  [
    'mismatched gate identity',
    g2Fixture,
    (x) => {
      x.gate.gateId = 'G1';
    },
    /invalid G2/u,
  ],
  [
    'mismatched wave identity',
    g2Fixture,
    (x) => {
      x.wave.wave = 2;
    },
    /invalid Wave 3/u,
  ],
  [
    'unsupported gate decision',
    g2Fixture,
    (x) => {
      x.gate.decision = 'GREEN';
    },
    /unsupported G2/u,
  ],
  [
    'frozen source while blocked',
    g2Fixture,
    (x) => {
      x.gate.frozenBaseSha = x.gate.candidateSourceSha;
    },
    /cannot freeze/u,
  ],
  [
    'accepted sprint while blocked',
    g2Fixture,
    (x) => {
      x.gate.acceptedSprints = ['R24'];
    },
    /cannot claim accepted/u,
  ],
  [
    'missing blocker array',
    g2Fixture,
    (x) => {
      delete x.gate.blockers;
    },
    /explicit array/u,
  ],
  [
    'no reason for blocked state',
    g2Fixture,
    (x) => {
      x.gate.blockers = [];
    },
    /cannot authorize/u,
  ],
  [
    'reserved peer attempting a start',
    acceptedG2Fixture,
    (x) => {
      x.wave.startableLanes.push(x.wave.blockedLanes.shift());
    },
    /must remain reserved/u,
  ],
  [
    'blank package owner',
    g2Fixture,
    (x) => {
      x.wave.lanes[3].owner = ' ';
    },
    /missing Wave 3 package or ownership/u,
  ],
  [
    'different owner in the registry',
    g2Fixture,
    (x) => {
      x.registry.sprints.find((sprint) => sprint.id === 'R32').owner = 'another fixture writer';
    },
    /registry differs from Wave 3 manifest/u,
  ],
  [
    'invented reserved peer owner',
    g2Fixture,
    (x) => {
      x.wave.lanes[0].owner = 'invented';
    },
    /must remain reserved/u,
  ],
  [
    'invented reserved dependency',
    g2Fixture,
    (x) => {
      x.wave.lanes[0].dependencies = 'R24';
    },
    /must remain reserved/u,
  ],
  [
    'reserved peer claiming a base',
    acceptedG2Fixture,
    (x) => {
      x.wave.lanes[0].frozenBaseSha = x.wave.baseSha;
    },
    /must remain reserved/u,
  ],
  [
    'missing lane',
    g2Fixture,
    (x) => {
      x.wave.lanes.pop();
    },
    /five unique lanes/u,
  ],
  [
    'same-wave dependency',
    g2Fixture,
    (x) => {
      x.wave.lanes[3].dependencies = ['R29'];
      x.registry.sprints.find((sprint) => sprint.id === 'R32').dependencies = ['R29'];
    },
    /invalid dependency R29/u,
  ],
  [
    'missing prior-wave acceptance',
    acceptedG2Fixture,
    (x) => {
      x.gate.acceptedSprints = x.gate.acceptedSprints.filter((id) => id !== 'R22');
    },
    /unresolved dependency R22/u,
  ],
  [
    'unaccepted Wave 2 member',
    acceptedG2Fixture,
    (x) => {
      x.gate.acceptedSprints = x.gate.acceptedSprints.filter((id) => id !== 'R27');
    },
    /unresolved dependency R27/u,
  ],
  [
    'same-wave accepted ID',
    acceptedG2Fixture,
    (x) => {
      x.gate.acceptedSprints.push('R32');
    },
    /earlier-wave sprint IDs/u,
  ],
  [
    'duplicate accepted ID',
    acceptedG2Fixture,
    (x) => {
      x.gate.acceptedSprints.push('R24');
    },
    /unique earlier-wave/u,
  ],
  [
    'missing mandatory evidence',
    acceptedG2Fixture,
    (x) => {
      x.gate.mandatoryEvidence.pop();
    },
    /evidence categories/u,
  ],
  [
    'duplicated evidence category',
    acceptedG2Fixture,
    (x) => {
      x.gate.mandatoryEvidence.push(x.gate.mandatoryEvidence[0]);
    },
    /evidence categories/u,
  ],
  [
    'pending integration evidence',
    acceptedG2Fixture,
    (x) => {
      x.gate.mandatoryEvidence[0].status = 'PENDING';
    },
    /mandatory candidate evidence/u,
  ],
  [
    'evidence from another source',
    acceptedG2Fixture,
    (x) => {
      x.gate.mandatoryEvidence[0].sourceSha = 'd'.repeat(40);
    },
    /mandatory candidate evidence/u,
  ],
  [
    'evidence from another tree',
    acceptedG2Fixture,
    (x) => {
      x.gate.mandatoryEvidence[0].treeSha = 'd'.repeat(40);
    },
    /mandatory candidate evidence/u,
  ],
  [
    'blank evidence reference',
    acceptedG2Fixture,
    (x) => {
      x.gate.mandatoryEvidence[0].reference = ' ';
    },
    /mandatory candidate evidence/u,
  ],
  [
    'missing R28 hosted blocker',
    acceptedG2Fixture,
    (x) => {
      x.gate.externalBlockers = [];
    },
    /explicit hosted environment blocker/u,
  ],
  [
    'R28 config recast as deployment',
    acceptedG2Fixture,
    (x) => {
      x.gate.mandatoryEvidence.find((entry) => entry.id === 'r28-checked-platform-plan').scope =
        'HOSTED_ACCEPTED';
    },
    /checked R28 configuration/u,
  ],
  [
    'external block substituting for checked plan',
    acceptedG2Fixture,
    (x) => {
      x.gate.mandatoryEvidence.find((entry) => entry.id === 'r28-checked-platform-plan').status =
        'EXTERNAL_BLOCKED';
    },
    /mandatory candidate evidence/u,
  ],
  [
    'ownerless external blocker',
    acceptedG2Fixture,
    (x) => {
      delete x.gate.externalBlockers[0].owner;
    },
    /scope, owner and evidence/u,
  ],
  [
    'unmerged acceptance publication',
    acceptedG2Fixture,
    (x) => {
      x.gate.publication.state = 'DRAFT_PENDING_OWNER_REVIEW';
    },
    /separately published merged/u,
  ],
  [
    'abbreviated publication identity',
    acceptedG2Fixture,
    (x) => {
      x.gate.publication.acceptanceRecordCommitSha = 'abcdef0';
    },
    /separately published merged/u,
  ],
  [
    'substituted frozen tree',
    acceptedG2Fixture,
    (x) => {
      x.gate.frozenTreeSha = 'd'.repeat(40);
    },
    /inconsistent G2 frozen/u,
  ],
  [
    'blocked wave with startable lane',
    acceptedG2Fixture,
    (x) => {
      x.wave.status = 'BLOCKED';
    },
    /blocked Wave 3 cannot/u,
  ],
  [
    'held lane with ready registry status',
    () => acceptedG2Fixture(false),
    (x) => {
      x.registry.sprints.find((sprint) => sprint.id === 'R32').status = 'READY_TO_START';
    },
    /held Wave 3 lane cannot/u,
  ],
  [
    'control character in an owned path',
    g2Fixture,
    (x) => {
      x.wave.lanes[3].exactFiles.push('shared/fixture\u0000.ts');
    },
    /unsafe or non-exact/u,
  ],
  [
    'path alias concealing ownership',
    g2Fixture,
    (x) => {
      x.wave.lanes[3].exactFiles.push('./shared/file.ts');
    },
    /unsafe or non-exact/u,
  ],
  [
    'prefix claimed as an exact file',
    g2Fixture,
    (x) => {
      x.wave.lanes[3].exactFiles.push('apps/api/src/modules/money/');
    },
    /unsafe or non-exact/u,
  ],
  [
    'lease overlapping normal ownership',
    g2Fixture,
    (x) => {
      x.wave.lanes[3].leases.push({
        paths: [x.wave.lanes[3].exactFiles[0]],
        grantedBy: 'synthetic fixture',
        expires: 'end of fixture',
        scope: 'fixture',
        handoff: 'fixture',
      });
    },
    /conflicting Wave 3 ownership/u,
  ],
  [
    'lease without handoff',
    g2Fixture,
    (x) => {
      x.wave.lanes[3].leases.push({
        paths: ['shared/fixture.ts'],
        grantedBy: 'fixture',
        expires: 'fixture',
        scope: 'fixture',
      });
    },
    /incomplete Wave 3 lease/u,
  ],
]) {
  test(`G2 rejects ${name}`, () => {
    const x = make();
    mutate(x);
    assert.ok(
      problems(x).some((problem) => pattern.test(problem)),
      problems(x).join('\n'),
    );
  });
}

test('G2 malformed records fail closed without throwing', () => {
  assert.deepEqual(waveGateProblems(null, { wave: 3 }, null), [
    'invalid G2 record',
    'invalid Wave 3 manifest',
  ]);
  const x = g2Fixture();
  x.wave.lanes[3] = null;
  x.gate.mandatoryEvidence[0] = null;
  assert.ok(problems(x).includes('invalid Wave 3 lane record'));
});
