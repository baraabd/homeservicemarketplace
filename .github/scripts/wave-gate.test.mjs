import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { waveGateProblems } from './wave-gate.mjs';

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
const copy = () => structuredClone(initial);
const problems = ({ gate, wave, registry }) => waveGateProblems(gate, wave, registry);

test('blocked G1 preparation is internally consistent and grants no start', () => {
  assert.deepEqual(problems(initial), []);
  assert.equal(initial.gate.frozenBaseSha, null);
  assert.deepEqual(initial.wave.startableLanes, []);
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
