import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { G2_REQUIRED_EVIDENCE, G3_REQUIRED_EVIDENCE, waveGateProblems } from './wave-gate.mjs';

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
    x.wave.lanes[3].ownershipApproval = 'APPROVED_AFTER_VERIFIED_G2_PUBLICATION';
    x.registry.sprints.find((sprint) => sprint.id === 'R32').ownershipApproval =
      x.wave.lanes[3].ownershipApproval;
    x.wave.lanes[3].sessionAssignment = {
      sessionId: 'synthetic-r32-session',
      assignedBy: 'synthetic fixture coordinator',
      assignedAt: '2026-10-22T00:00:00Z',
    };
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

for (const [name, mutate] of [
  [
    'no assigned session',
    (x) => {
      x.wave.lanes[3].sessionAssignment = null;
    },
  ],
  [
    'blank session identity',
    (x) => {
      x.wave.lanes[3].sessionAssignment.sessionId = ' ';
    },
  ],
  [
    'missing assigning coordinator',
    (x) => {
      delete x.wave.lanes[3].sessionAssignment.assignedBy;
    },
  ],
  [
    'missing assignment timestamp',
    (x) => {
      delete x.wave.lanes[3].sessionAssignment.assignedAt;
    },
  ],
  [
    'conditional ownership',
    (x) => {
      x.wave.lanes[3].ownershipApproval =
        'CONDITIONAL_AFTER_VERIFIED_G2_PUBLICATION_AND_SESSION_ASSIGNMENT';
      x.registry.sprints.find((sprint) => sprint.id === 'R32').ownershipApproval =
        x.wave.lanes[3].ownershipApproval;
    },
  ],
  [
    'different registry approval',
    (x) => {
      x.registry.sprints.find((sprint) => sprint.id === 'R32').ownershipApproval = 'CONDITIONAL';
    },
  ],
])
  test(`published G2 refuses ${name}`, () => {
    const x = acceptedG2Fixture();
    assert.deepEqual(problems(x), []);
    mutate(x);
    assert.ok(
      problems(x).some((problem) =>
        /approved ownership and exact writer assignment/u.test(problem),
      ),
    );
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

const g3Initial = {
  gate: await read('gates/g3/SOURCE_MANIFEST.json'),
  wave: await read('waves/wave-04.plan.json'),
  registry: await read('SPRINT_REGISTRY.json'),
};

// These contract doubles never execute services or grant real gate acceptance.
function g3Fixture() {
  const x = structuredClone(g3Initial);
  Object.assign(x.gate, {
    decision: 'BLOCKED',
    candidateSourceSha: null,
    candidateTreeSha: null,
    frozenBaseSha: null,
    frozenTreeSha: null,
    acceptedSprints: [],
    blockers: [{ id: 'SYNTHETIC', owner: 'fixture only', reason: 'not implemented' }],
    prerequisite: {
      gateId: 'G2',
      record: x.registry.gates.G2,
      frozenBaseSha: null,
      acceptanceRecordCommitSha: null,
    },
    mandatoryEvidence: G3_REQUIRED_EVIDENCE.map((id) => ({
      id,
      status: 'NOT_RUN',
      sourceSha: null,
      treeSha: null,
      reference: 'synthetic test reference',
    })),
    publication: {
      branch: 'test/g3-fixture',
      state: 'NOT_PREPARED',
      acceptanceRecordCommitSha: null,
      verifiedMerge: false,
    },
  });
  Object.assign(x.wave, {
    baseSha: null,
    status: 'BLOCKED',
    startableLanes: [],
    blockedLanes: x.wave.lanes.map((lane) => lane.id),
  });
  for (const lane of x.wave.lanes) {
    Object.assign(lane, { frozenBaseSha: null, status: 'BLOCKED' });
    Object.assign(
      x.registry.sprints.find((sprint) => sprint.id === lane.id),
      {
        status: 'PLANNED',
        frozenBase: null,
        startBarrier: { gate: 'G3', decision: 'BLOCKED' },
      },
    );
  }
  return x;
}

function acceptedG3Fixture(published = true) {
  const x = g3Fixture();
  const source = 'a'.repeat(40);
  const tree = 'b'.repeat(40);
  Object.assign(x.gate, {
    decision: 'ACCEPTED',
    candidateSourceSha: source,
    candidateTreeSha: tree,
    frozenBaseSha: source,
    frozenTreeSha: tree,
    blockers: [],
    acceptedSprints: x.registry.sprints
      .filter((sprint) => sprint.wave < 4)
      .map((sprint) => sprint.id),
    prerequisite: {
      gateId: 'G2',
      record: x.registry.gates.G2,
      frozenBaseSha: 'c'.repeat(40),
      acceptanceRecordCommitSha: 'd'.repeat(40),
    },
    publication: {
      branch: 'test/g3-fixture',
      state: published ? 'MERGED' : 'DRAFT_PENDING_OWNER_REVIEW',
      acceptanceRecordCommitSha: published ? 'e'.repeat(40) : null,
      verifiedMerge: published,
    },
    checks: {
      completeInventoryVerified: true,
      observed: [
        'CI gate',
        'Analyze JavaScript/TypeScript',
        'Production governance',
        'R18 functional completion acceptance',
        'R25 real replicas and recovery',
        'R27 comparable measurements and unchanged budgets',
      ].map((name, index) => ({
        name,
        id: 100 + index,
        headSha: source,
        status: 'completed',
        conclusion: 'success',
      })),
      officialCodeQL: {
        id: 200,
        headSha: source,
        appSlug: 'github-advanced-security',
        conclusion: 'success',
        annotationsCount: 0,
      },
    },
    sourceArtifact: {
      sourceSha: source,
      treeSha: tree,
      artifactId: 201,
      runId: 202,
      treeRecomputed: true,
      trackedBlobsVerified: 100,
      zipSha256: '1'.repeat(64),
      innerArchiveSha256: '2'.repeat(64),
    },
    lanes: ['R29', 'R30', 'R31', 'R32', 'R33'].map((id, index) => ({
      id,
      branch: x.registry.sprints.find((sprint) => sprint.id === id).branch,
      merged: true,
      integration: 'PASS',
      pr: 800 + index,
      prUrl: `https://github.com/baraabd/homeservicemarketplace/pull/${800 + index}`,
      sourceHeadSha: 'f'.repeat(40),
      mergeCommitSha: '1'.repeat(40),
    })),
    integration: {
      sourceSha: source,
      treeSha: tree,
      execution: 'REAL_REGISTERED_IMPLEMENTATIONS',
      reference: 'synthetic contract only; never execution evidence',
      participants: ['stripe', 'manual', 'activation', 'refund', 'finance-read'].map((id) => ({
        id,
        implementation: `synthetic ${id}`,
        registrationReference: 'synthetic contract only',
      })),
      boundaries: [
        'route-handler-discovery',
        'atomic-rollback',
        'retry-concurrency',
        'post-commit-outbox',
      ].map((id) => ({ id, status: 'PASS', reference: 'synthetic contract only' })),
    },
  });
  x.gate.mandatoryEvidence.forEach((entry, index) =>
    Object.assign(entry, {
      status: 'PASS',
      sourceSha: source,
      treeSha: tree,
      artifact: {
        reference: 'synthetic test artifact',
        sha256: '2'.repeat(64),
        artifactId: 900 + index,
        runId: 1000 + index,
      },
    }),
  );
  x.wave.baseSha = source;
  if (published)
    Object.assign(x.wave, {
      status: 'READY_TO_START',
      startableLanes: x.wave.lanes.map((lane) => lane.id),
      blockedLanes: [],
    });
  for (const lane of x.wave.lanes) {
    const sprint = x.registry.sprints.find((entry) => entry.id === lane.id);
    lane.frozenBaseSha = sprint.frozenBase = source;
    sprint.startBarrier.decision = 'ACCEPTED';
    if (published) {
      lane.status = sprint.status = 'READY_TO_START';
      lane.ownershipApproval = sprint.ownershipApproval = 'APPROVED_AFTER_VERIFIED_G3_PUBLICATION';
      lane.sessionAssignment = {
        sessionId: `synthetic-${lane.id}`,
        assignedBy: 'fixture coordinator',
        assignedAt: '2026-10-22T00:00:00Z',
      };
    }
  }
  return x;
}

test('G3 preparation has no invented candidate and does not release Wave 4', () => {
  assert.deepEqual(problems(g3Initial), []);
  const blocked = g3Fixture();
  assert.deepEqual(problems(blocked), []);
  assert.equal(blocked.gate.candidateSourceSha, null);
  assert.deepEqual(blocked.wave.startableLanes, []);
});

test('G3 contract double supports technical acceptance held for separate publication', () => {
  assert.deepEqual(problems(acceptedG3Fixture(false)), []);
  assert.deepEqual(problems(acceptedG3Fixture()), []);
  assert.equal(acceptedG3Fixture(false).wave.status, 'BLOCKED');
  assert.equal(acceptedG3Fixture().wave.r38Finalization.status, 'BLOCKED');
});

for (const [name, make, mutate, pattern] of [
  [
    'G2 substituted as the Wave 4 gate',
    g3Fixture,
    (x) => {
      x.gate.gateId = 'G2';
      x.wave.startGate = 'G2';
    },
    /invalid G3|G2 cannot release/u,
  ],
  [
    'unknown decision',
    g3Fixture,
    (x) => {
      x.gate.decision = 'GREEN';
    },
    /unsupported G3/u,
  ],
  [
    'partial candidate',
    g3Fixture,
    (x) => {
      x.gate.candidateSourceSha = 'a'.repeat(40);
    },
    /full distinct/u,
  ],
  [
    'zero candidate',
    g3Fixture,
    (x) => {
      x.gate.candidateSourceSha = '0'.repeat(40);
      x.gate.candidateTreeSha = 'b'.repeat(40);
    },
    /full distinct/u,
  ],
  [
    'commit used as tree',
    g3Fixture,
    (x) => {
      x.gate.candidateSourceSha = x.gate.candidateTreeSha = 'a'.repeat(40);
    },
    /full distinct/u,
  ],
  [
    'PASS without a candidate',
    g3Fixture,
    (x) => {
      x.gate.mandatoryEvidence[0].status = 'PASS';
    },
    /actual candidate/u,
  ],
  [
    'blocked source freeze',
    g3Fixture,
    (x) => {
      x.gate.frozenBaseSha = 'a'.repeat(40);
    },
    /cannot freeze/u,
  ],
  [
    'blocked acceptance label',
    g3Fixture,
    (x) => {
      x.gate.acceptedSprints = ['R29'];
    },
    /cannot accept/u,
  ],
  [
    'ownerless blocker',
    g3Fixture,
    (x) => {
      delete x.gate.blockers[0].owner;
    },
    /identity, owner/u,
  ],
  [
    'earlier prerequisite substitution',
    g3Fixture,
    (x) => {
      x.gate.prerequisite.gateId = 'G1';
    },
    /canonical G2/u,
  ],
  [
    'missing package',
    g3Fixture,
    (x) => {
      x.wave.lanes.pop();
    },
    /five unique/u,
  ],
  [
    'missing original source prompt',
    g3Fixture,
    (x) => {
      delete x.wave.lanes[0].sourcePrompt;
    },
    /source prompt/u,
  ],
  [
    'same-wave dependency',
    g3Fixture,
    (x) => {
      x.wave.lanes[0].dependencies.push('R35');
    },
    /earlier waves/u,
  ],
  [
    'duplicate exact file',
    g3Fixture,
    (x) => {
      x.wave.lanes[0].exactFiles.push(x.wave.lanes[0].exactFiles[0]);
    },
    /conflicting Wave 4/u,
  ],
  [
    'cross-lane writer collision',
    g3Fixture,
    (x) => {
      x.wave.lanes[1].exactFiles.push(x.wave.lanes[0].exactFiles[0]);
    },
    /conflicting Wave 4/u,
  ],
  [
    'unsafe exact path',
    g3Fixture,
    (x) => {
      x.wave.lanes[0].exactFiles.push('../private');
    },
    /unsafe or non-exact/u,
  ],
  [
    'prefix instead of exact file',
    g3Fixture,
    (x) => {
      x.wave.lanes[0].exactFiles.push('apps/api/');
    },
    /unsafe or non-exact/u,
  ],
  [
    'control character path',
    g3Fixture,
    (x) => {
      x.wave.lanes[0].exactFiles.push('a\u0000.ts');
    },
    /unsafe or non-exact/u,
  ],
  [
    'lease without publication prerequisite',
    g3Fixture,
    (x) => {
      delete x.wave.lanes[2].leases[0].startPrerequisite;
    },
    /incomplete conditional/u,
  ],
  [
    'lease without source prompt',
    g3Fixture,
    (x) => {
      delete x.wave.lanes[2].leases[0].sourcePrompt;
    },
    /incomplete conditional/u,
  ],
  [
    'lease released by G2',
    g3Fixture,
    (x) => {
      x.wave.lanes[2].leases[0].startPrerequisite.gate = 'G2';
    },
    /incomplete conditional/u,
  ],
  [
    'lease without handoff',
    g3Fixture,
    (x) => {
      delete x.wave.lanes[2].leases[0].handoff;
    },
    /incomplete conditional/u,
  ],
  [
    'incomplete evidence categories',
    acceptedG3Fixture,
    (x) => {
      x.gate.mandatoryEvidence.pop();
    },
    /cannot be removed/u,
  ],
  [
    'reordered evidence',
    acceptedG3Fixture,
    (x) => {
      x.gate.mandatoryEvidence.reverse();
    },
    /cannot be removed/u,
  ],
  [
    'wrong evidence source',
    acceptedG3Fixture,
    (x) => {
      x.gate.mandatoryEvidence[0].sourceSha = 'f'.repeat(40);
    },
    /actual candidate/u,
  ],
  [
    'wrong evidence tree',
    acceptedG3Fixture,
    (x) => {
      x.gate.mandatoryEvidence[0].treeSha = 'f'.repeat(40);
    },
    /actual candidate/u,
  ],
  [
    'failed evidence',
    acceptedG3Fixture,
    (x) => {
      x.gate.mandatoryEvidence[0].status = 'FAIL';
    },
    /successful artifacts/u,
  ],
  [
    'PASS without artifact identity',
    acceptedG3Fixture,
    (x) => {
      delete x.gate.mandatoryEvidence[0].artifact;
    },
    /successful artifacts/u,
  ],
  [
    'missing check inventory',
    acceptedG3Fixture,
    (x) => {
      x.gate.checks.completeInventoryVerified = false;
    },
    /check inventory/u,
  ],
  [
    'dropped required check',
    acceptedG3Fixture,
    (x) => {
      x.gate.checks.observed.pop();
    },
    /check inventory/u,
  ],
  [
    'duplicate check',
    acceptedG3Fixture,
    (x) => {
      x.gate.checks.observed.push(x.gate.checks.observed[0]);
    },
    /check inventory/u,
  ],
  [
    'cancelled check',
    acceptedG3Fixture,
    (x) => {
      x.gate.checks.observed[0].conclusion = 'cancelled';
    },
    /check inventory/u,
  ],
  [
    'skipped check',
    acceptedG3Fixture,
    (x) => {
      x.gate.checks.observed[0].conclusion = 'skipped';
    },
    /check inventory/u,
  ],
  [
    'wrong-source check',
    acceptedG3Fixture,
    (x) => {
      x.gate.checks.observed[0].headSha = 'f'.repeat(40);
    },
    /check inventory/u,
  ],
  [
    'unofficial CodeQL',
    acceptedG3Fixture,
    (x) => {
      x.gate.checks.officialCodeQL.appSlug = 'self-report';
    },
    /official successful/u,
  ],
  [
    'annotated CodeQL',
    acceptedG3Fixture,
    (x) => {
      x.gate.checks.officialCodeQL.annotationsCount = 1;
    },
    /official successful/u,
  ],
  [
    'unverified tree',
    acceptedG3Fixture,
    (x) => {
      x.gate.sourceArtifact.treeRecomputed = false;
    },
    /archive and tree/u,
  ],
  [
    'missing actual lane',
    acceptedG3Fixture,
    (x) => {
      x.gate.lanes.pop();
    },
    /five-lane/u,
  ],
  [
    'unmerged source lane',
    acceptedG3Fixture,
    (x) => {
      x.gate.lanes[0].merged = false;
    },
    /five-lane/u,
  ],
  [
    'wrong repository closeout',
    acceptedG3Fixture,
    (x) => {
      x.gate.lanes[0].prUrl = 'https://github.com/unrelated/repo/pull/800';
    },
    /five-lane/u,
  ],
  [
    'component double as integration',
    acceptedG3Fixture,
    (x) => {
      x.gate.integration.execution = 'CONTRACT_DOUBLES';
    },
    /actual registered/u,
  ],
  [
    'missing registered participant',
    acceptedG3Fixture,
    (x) => {
      x.gate.integration.participants.pop();
    },
    /actual registered/u,
  ],
  [
    'missing outbox boundary',
    acceptedG3Fixture,
    (x) => {
      x.gate.integration.boundaries.pop();
    },
    /actual registered/u,
  ],
  [
    'failed atomic rollback',
    acceptedG3Fixture,
    (x) => {
      x.gate.integration.boundaries[1].status = 'FAIL';
    },
    /actual registered/u,
  ],
  [
    'wrong integration source',
    acceptedG3Fixture,
    (x) => {
      x.gate.integration.sourceSha = 'f'.repeat(40);
    },
    /actual registered/u,
  ],
  [
    'unaccepted previous lane',
    acceptedG3Fixture,
    (x) => {
      x.gate.acceptedSprints = x.gate.acceptedSprints.filter((id) => id !== 'R30');
    },
    /all five|unresolved dependency/u,
  ],
  [
    'duplicate accepted sprint',
    acceptedG3Fixture,
    (x) => {
      x.gate.acceptedSprints.push('R29');
    },
    /unique earlier-wave/u,
  ],
  [
    'draft publication releasing lanes',
    acceptedG3Fixture,
    (x) => {
      x.gate.publication = {
        branch: 'fixture',
        state: 'DRAFT_PENDING_OWNER_REVIEW',
        acceptanceRecordCommitSha: null,
        verifiedMerge: false,
      };
    },
    /separately verified published/u,
  ],
  [
    'unverified publication',
    acceptedG3Fixture,
    (x) => {
      x.gate.publication.verifiedMerge = false;
    },
    /verified merged/u,
  ],
  [
    'self-referential publication',
    acceptedG3Fixture,
    (x) => {
      x.gate.publication.acceptanceRecordCommitSha = x.gate.candidateSourceSha;
    },
    /verified merged/u,
  ],
  [
    'stale lane base',
    acceptedG3Fixture,
    (x) => {
      x.wave.lanes[0].frozenBaseSha = 'f'.repeat(40);
    },
    /inconsistent Wave 4/u,
  ],
  [
    'missing writer assignment',
    acceptedG3Fixture,
    (x) => {
      delete x.wave.lanes[0].sessionAssignment;
    },
    /writer assignment/u,
  ],
  [
    'unapproved exact ownership',
    acceptedG3Fixture,
    (x) => {
      x.wave.lanes[0].ownershipApproval = 'PROPOSED';
    },
    /writer assignment/u,
  ],
  [
    'live operations permission',
    acceptedG3Fixture,
    (x) => {
      x.gate.restrictions.liveMoney = true;
    },
    /no operational authority/u,
  ],
  [
    'dropped R16/R18 hold',
    acceptedG3Fixture,
    (x) => {
      x.gate.restrictions.preserveR16R18Holds = false;
    },
    /policy holds/u,
  ],
  [
    'premature R38 final acceptance',
    acceptedG3Fixture,
    (x) => {
      x.wave.r38Finalization.status = 'RELEASE_ACCEPTED';
    },
    /serialized R38\/G4/u,
  ],
  [
    'missing R38 peer join',
    acceptedG3Fixture,
    (x) => {
      x.wave.lanes[4].finalEvidenceJoin.pop();
    },
    /serialized R38\/G4/u,
  ],
])
  test(`G3 refuses ${name}`, () => {
    const x = make();
    mutate(x);
    const errors = problems(x);
    assert.ok(
      errors.some((error) => pattern.test(error)),
      errors.join('\n'),
    );
  });

test('malformed G3 nested records fail closed without throwing', () => {
  assert.ok(waveGateProblems(null, { wave: 4 }, null).includes('invalid G3 record'));
  const x = g3Fixture();
  x.wave.lanes[0] = null;
  x.gate.mandatoryEvidence[0] = null;
  assert.ok(problems(x).includes('Invalid Wave 4 lane'));
});
