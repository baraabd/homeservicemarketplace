import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBundle, recordProblems, readinessProblems } from './g3-record.mjs';
import { G3_REQUIRED_EVIDENCE } from './wave-gate.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const current = await readBundle();
const clone = () => structuredClone(current);
const sha = (value) => value.repeat(40);
const digest = '1'.repeat(64);
const checkNames = [
  'CI gate',
  'Analyze JavaScript/TypeScript',
  'Production governance',
  'R18 functional completion acceptance',
  'R25 real replicas and recovery',
  'R27 comparable measurements and unchanged budgets',
];
const checks = (source) => ({
  completeInventoryVerified: true,
  observed: checkNames.map((name, i) => ({
    name,
    id: 8000 + i,
    headSha: source,
    status: 'completed',
    conclusion: 'success',
  })),
  officialCodeQL: {
    id: 9000,
    headSha: source,
    appSlug: 'github-advanced-security',
    conclusion: 'success',
    annotationsCount: 0,
  },
});
const provenance = (source, tree) => ({
  sourceSha: source,
  treeSha: tree,
  artifactId: 9100,
  runId: 9101,
  treeRecomputed: true,
  trackedBlobsVerified: 100,
  zipSha256: digest,
  innerArchiveSha256: digest,
});

// Pure contract doubles. All numbers/identities below are synthetic and cannot
// establish execution, remote evidence authenticity or actual owner authority.
function acceptedDouble(published = true) {
  const b = clone();
  const { g2, registry } = b;
  const source = g2.gate.candidateSourceSha;
  const tree = g2.gate.candidateTreeSha;
  Object.assign(g2.gate, {
    decision: 'ACCEPTED',
    frozenBaseSha: source,
    frozenTreeSha: tree,
    blockers: [],
    acceptedSprints: registry.sprints
      .filter((sprint) => sprint.wave < 3)
      .map((sprint) => sprint.id),
    publication: {
      branch: 'test/g2-fixture',
      state: 'MERGED',
      verifiedMerge: true,
      acceptanceRecordCommitSha: sha('c'),
    },
    restrictions: {
      liveMoney: false,
      deploy: false,
      merge: false,
      accountGrants: false,
      spend: false,
      preserveG1: true,
      preserveR16R18Holds: true,
    },
    checks: checks(source),
    sourceArtifact: provenance(source, tree),
    contracts: {
      sourceSha: source,
      version: 'hsm.money.v1',
      sha256: Object.fromEntries(
        ['activation', 'collection', 'finance-read', 'refund'].map((name) => [
          `apps/api/src/modules/money/ports/${name}.port.ts`,
          digest,
        ]),
      ),
    },
  });
  for (const entry of g2.gate.mandatoryEvidence)
    Object.assign(entry, { status: 'PASS', sourceSha: source, treeSha: tree });
  g2.gate.mandatoryEvidence.find((entry) => entry.id === 'r28-checked-platform-plan').scope =
    'CONFIGURATION_ONLY';
  Object.assign(g2.wave, {
    baseSha: source,
    status: 'READY_TO_START',
    startableLanes: g2.wave.lanes.map((lane) => lane.id),
    blockedLanes: [],
  });
  for (const lane of g2.wave.lanes) {
    const sprint = registry.sprints.find((entry) => entry.id === lane.id);
    lane.frozenBaseSha = sprint.frozenBase = source;
    lane.status = sprint.status = 'READY_TO_START';
    sprint.startBarrier.decision = 'ACCEPTED';
    lane.ownershipApproval = sprint.ownershipApproval = 'APPROVED_AFTER_VERIFIED_G2_PUBLICATION';
    lane.sessionAssignment = {
      sessionId: `synthetic-g2-${lane.id}`,
      assignedBy: 'synthetic fixture coordinator',
      assignedAt: '2026-10-22T00:00:00Z',
    };
  }
  g2.closeout = {
    sourceSha: source,
    treeSha: tree,
    historicalG1BaseSha: g2.g1.frozenBaseSha,
    decision: 'ACCEPTED',
    lanes: ['R24', 'R25', 'R26', 'R27', 'R28'].map((id, i) => ({
      id,
      branch: registry.sprints.find((sprint) => sprint.id === id).branch,
      merged: true,
      integration: 'PASS',
      pr: 7000 + i,
      prUrl: `https://github.com/baraabd/homeservicemarketplace/pull/${7000 + i}`,
      sourceHeadSha: sha('d'),
      mergeCommitSha: sha('e'),
    })),
  };
  g2.r25 = {
    headSha: source,
    treeSha: tree,
    zipDigestVerified: true,
    zipSha256: digest,
    runId: 7000,
    artifactId: 7001,
    status: 'SANDBOX_ACCEPTED',
    api: { success: true, passed: 13, failed: 0, skipped: 0 },
    browser: { exitCode: 0, passed: 1, failed: 0, skipped: 0, timedOut: false },
    commands: [{ label: 'browser', exitCode: 0, timedOut: false, signal: null }],
  };
  Object.assign(b.gate, {
    decision: 'ACCEPTED',
    candidateSourceSha: sha('a'),
    candidateTreeSha: sha('b'),
    frozenBaseSha: sha('a'),
    frozenTreeSha: sha('b'),
    blockers: [],
    prerequisite: {
      gateId: 'G2',
      record: registry.gates.G2,
      frozenBaseSha: source,
      acceptanceRecordCommitSha: sha('c'),
    },
    acceptedSprints: registry.sprints
      .filter((sprint) => sprint.wave < 4)
      .map((sprint) => sprint.id),
    publication: {
      branch: 'test/g3-fixture',
      state: published ? 'MERGED' : 'DRAFT_PENDING_OWNER_REVIEW',
      acceptanceRecordCommitSha: published ? sha('f') : null,
      verifiedMerge: published,
    },
    checks: checks(sha('a')),
    sourceArtifact: provenance(sha('a'), sha('b')),
    mandatoryEvidence: G3_REQUIRED_EVIDENCE.map((id, i) => ({
      id,
      status: 'PASS',
      sourceSha: sha('a'),
      treeSha: sha('b'),
      reference: 'synthetic contract only',
      artifact: {
        reference: 'synthetic artifact',
        sha256: digest,
        artifactId: 6000 + i,
        runId: 6500 + i,
      },
    })),
    lanes: ['R29', 'R30', 'R31', 'R32', 'R33'].map((id, i) => ({
      id,
      branch: registry.sprints.find((sprint) => sprint.id === id).branch,
      merged: true,
      integration: 'PASS',
      pr: 5000 + i,
      prUrl: `https://github.com/baraabd/homeservicemarketplace/pull/${5000 + i}`,
      sourceHeadSha: sha('d'),
      mergeCommitSha: sha('e'),
    })),
    integration: {
      sourceSha: sha('a'),
      treeSha: sha('b'),
      execution: 'REAL_REGISTERED_IMPLEMENTATIONS',
      reference: 'synthetic contract only; no actual implementation claim',
      participants: ['stripe', 'manual', 'activation', 'refund', 'finance-read'].map((id) => ({
        id,
        implementation: 'synthetic contract only',
        registrationReference: 'synthetic registration',
      })),
      boundaries: [
        'route-handler-discovery',
        'atomic-rollback',
        'retry-concurrency',
        'post-commit-outbox',
      ].map((id) => ({ id, status: 'PASS', reference: 'synthetic contract only' })),
    },
  });
  b.wave.baseSha = sha('a');
  Object.assign(b.wave, {
    status: published ? 'READY_TO_START' : 'BLOCKED',
    startableLanes: published ? b.wave.lanes.map((lane) => lane.id) : [],
    blockedLanes: published ? [] : b.wave.lanes.map((lane) => lane.id),
  });
  for (const lane of b.wave.lanes) {
    const sprint = registry.sprints.find((entry) => entry.id === lane.id);
    lane.frozenBaseSha = sprint.frozenBase = sha('a');
    lane.status = published ? 'READY_TO_START' : 'BLOCKED';
    sprint.status = published ? 'READY_TO_START' : 'PLANNED';
    sprint.startBarrier.decision = 'ACCEPTED';
    if (published) {
      lane.ownershipApproval = sprint.ownershipApproval = 'APPROVED_AFTER_VERIFIED_G3_PUBLICATION';
      lane.sessionAssignment = {
        sessionId: `test-${lane.id}`,
        assignedBy: 'synthetic coordinator',
        assignedAt: '2026-10-22T00:00:00Z',
      };
    }
  }
  return b;
}

test('active G3 plan and canonical G2 inputs enforce their recorded publication state', () => {
  assert.deepEqual(recordProblems(current), []);
  for (const id of ['R34', 'R35', 'R36', 'R37', 'R38']) {
    const lane = current.wave.lanes.find((entry) => entry.id === id);
    const released =
      current.gate.decision === 'ACCEPTED' &&
      current.gate.publication.state === 'MERGED' &&
      current.gate.publication.verifiedMerge === true &&
      current.wave.status === 'READY_TO_START' &&
      lane.status === 'READY_TO_START' &&
      current.wave.startableLanes.includes(id);
    if (released) assert.deepEqual(readinessProblems(current, id), []);
    else
      assert.ok(
        readinessProblems(current, id).some((message) => message.includes('not authorized')),
      );
  }
});

test('complete G3 double needs separate verified publication before any Wave 4 release', () => {
  assert.deepEqual(recordProblems(acceptedDouble(false)), []);
  for (const id of ['R34', 'R35', 'R36', 'R37', 'R38']) {
    assert.ok(
      readinessProblems(acceptedDouble(false), id).some((message) =>
        message.includes('not authorized'),
      ),
    );
    assert.deepEqual(readinessProblems(acceptedDouble(), id), []);
  }
  assert.equal(acceptedDouble().wave.r38Finalization.status, 'BLOCKED');
  assert.ok(readinessProblems(acceptedDouble(), 'R29').length > 0);
});

for (const field of ['sourceSha', 'treeSha']) {
  test(`G3 rejects a G2 source artifact with mismatched ${field}`, () => {
    const b = acceptedDouble();
    assert.deepEqual(recordProblems(b), []);
    b.g2.gate.sourceArtifact[field] = sha('f');
    assert.ok(
      recordProblems(b).some((message) =>
        /Verified source artifact identity required/u.test(message),
      ),
    );
    assert.ok(readinessProblems(b, 'R34').length > 0);
  });
}

test('G3 cannot consume a published G2 prerequisite with an unassigned startable Wave 3 lane', () => {
  const b = acceptedDouble();
  b.g2.wave.lanes[0].sessionAssignment = null;
  assert.ok(
    readinessProblems(b, 'R34').some((message) =>
      /approved ownership and exact writer assignment/u.test(message),
    ),
  );
});

for (const [name, mutate] of [
  [
    'wrong source',
    (artifact) => {
      artifact.sourceSha = sha('f');
    },
  ],
  [
    'wrong tree',
    (artifact) => {
      artifact.treeSha = sha('f');
    },
  ],
  ...['sourceSha', 'treeSha', 'artifactId', 'runId', 'innerArchiveSha256'].map((field) => [
    `missing ${field}`,
    (artifact) => {
      delete artifact[field];
    },
  ]),
  [
    'zero artifact ID',
    (artifact) => {
      artifact.artifactId = 0;
    },
  ],
  [
    'negative run ID',
    (artifact) => {
      artifact.runId = -1;
    },
  ],
  [
    'fractional artifact ID',
    (artifact) => {
      artifact.artifactId = 1.5;
    },
  ],
  [
    'string run ID',
    (artifact) => {
      artifact.runId = '9101';
    },
  ],
  [
    'invalid inner digest',
    (artifact) => {
      artifact.innerArchiveSha256 = sha('a');
    },
  ],
]) {
  test(`G3 rejects its own source archive with ${name}`, () => {
    const b = acceptedDouble();
    assert.deepEqual(recordProblems(b), []);
    mutate(b.gate.sourceArtifact);
    assert.ok(
      recordProblems(b).some((message) => /G3 requires verified source archive/u.test(message)),
    );
    for (const lane of ['R34', 'R35', 'R36', 'R37', 'R38'])
      assert.ok(
        readinessProblems(b, lane).some((message) =>
          /G3 requires verified source archive/u.test(message),
        ),
      );
  });
}

test('G3 cannot consume conditional Wave 3 ownership as an executable prerequisite', () => {
  const b = acceptedDouble();
  const lane = b.g2.wave.lanes[0];
  lane.ownershipApproval = 'CONDITIONAL_AFTER_VERIFIED_G2_PUBLICATION_AND_SESSION_ASSIGNMENT';
  b.registry.sprints.find((sprint) => sprint.id === lane.id).ownershipApproval =
    lane.ownershipApproval;
  assert.ok(
    readinessProblems(b, 'R34').some((message) =>
      /approved ownership and exact writer assignment/u.test(message),
    ),
  );
});

for (const [name, mutate, pattern] of [
  [
    'unmerged G2',
    (b) => {
      b.g2.gate.publication.state = 'DRAFT_PENDING_OWNER_REVIEW';
    },
    /verified merged G2/u,
  ],
  [
    'unverified G2',
    (b) => {
      b.g2.gate.publication.verifiedMerge = false;
    },
    /verified merged G2/u,
  ],
  [
    'G2 acceptance label without evidence',
    (b) => {
      b.g2.gate.checks.observed = [];
    },
    /successful exact-source checks/u,
  ],
  [
    'missing G2 unchanged-budget evidence',
    (b) => {
      b.g2.gate.checks.observed = b.g2.gate.checks.observed.filter(
        (check) => !check.name.startsWith('R27 '),
      );
    },
    /successful exact-source checks/u,
  ],
  [
    'wrong G2 frozen source',
    (b) => {
      b.gate.prerequisite.frozenBaseSha = sha('e');
    },
    /exact accepted/u,
  ],
  [
    'wrong G2 publication',
    (b) => {
      b.gate.prerequisite.acceptanceRecordCommitSha = sha('e');
    },
    /exact accepted/u,
  ],
  [
    'different canonical registries',
    (b) => {
      b.g2.registry = structuredClone(b.registry);
      b.g2.registry.program = 'another record';
    },
    /same canonical registry/u,
  ],
  [
    'legacy G2 substitution',
    (b) => {
      delete b.g2.gate.gateId;
      b.g2.gate.gate = 'G2';
    },
    /canonical G2 prerequisite format/u,
  ],
  [
    'G3 identity substitution',
    (b) => {
      b.gate.gateId = 'G2';
    },
    /invalid G3/u,
  ],
  [
    'G2 released Wave 4',
    (b) => {
      b.wave.startGate = 'G2';
    },
    /G2 cannot release Wave 4/u,
  ],
  [
    'unmerged G3',
    (b) => {
      b.gate.publication.state = 'DRAFT_PENDING_OWNER_REVIEW';
    },
    /Unpublished G3/u,
  ],
  [
    'invented final R38 release',
    (b) => {
      b.wave.r38Finalization.status = 'RELEASE_ACCEPTED';
    },
    /serialized R38\/G4/u,
  ],
])
  test(`G3 active reader rejects ${name}`, () => {
    const b = acceptedDouble();
    mutate(b);
    assert.ok(
      recordProblems(b).some((message) => pattern.test(message)),
      recordProblems(b).join('\n'),
    );
    assert.ok(readinessProblems(b, 'R34').length > 0);
  });

for (const value of [null, [], {}, { gate: null }])
  test(`G3 malformed input fails closed: ${JSON.stringify(value)}`, () => {
    assert.ok(recordProblems(value).length > 0);
    assert.ok(readinessProblems(value).length > 0);
  });

test('G3 CLI reads active prerequisites, refuses invalid inputs and never uses historical fallback', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hsm-g3-reader-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(path.join(root, '.github/scripts'), path.join(directory, '.github/scripts'), {
    recursive: true,
  });
  await cp(
    path.join(root, 'docs/production-readiness/post-r18'),
    path.join(directory, 'docs/production-readiness/post-r18'),
    { recursive: true },
  );
  const run = (...args) =>
    spawnSync(process.execPath, [path.join(directory, '.github/scripts/g3-record.mjs'), ...args], {
      encoding: 'utf8',
      timeout: 10000,
    });
  const checked = run('--check');
  assert.equal(checked.error, undefined);
  assert.equal(checked.status, 0);
  for (const id of ['R34', 'R35', 'R36', 'R37', 'R38']) {
    const result = run('--ready', id);
    assert.equal(result.error, undefined);
    assert.equal(result.status, readinessProblems(current, id).length ? 1 : 0);
  }
  for (const args of [['--publish'], ['--ready', 'R29'], ['--check', 'R34', 'extra']]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unreadable or invalid G3/u);
  }
  const gate = path.join(
    directory,
    'docs/production-readiness/post-r18/gates/g3/SOURCE_MANIFEST.json',
  );
  await writeFile(gate, '{private_invalid_fixture');
  for (const mode of ['--check', '--ready']) {
    const result = run(mode, 'R34');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unreadable or invalid G3/u);
    assert.doesNotMatch(result.stderr, /private_invalid_fixture/u);
  }
  await rm(gate);
  assert.equal(run('--check').status, 1);
  await writeFile(gate, JSON.stringify(current.gate));
  await rm(
    path.join(directory, 'docs/production-readiness/post-r18/gates/g2/SOURCE_MANIFEST.json'),
  );
  const missing = run('--check');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /unreadable or invalid G3/u);
});
