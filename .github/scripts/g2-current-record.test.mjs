import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  recordProblems,
  readinessProblems,
  readBundle,
  readHistoricalBundle,
} from './g2-record.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const recorded = await readBundle();
const historical = await readHistoricalBundle();
const archive = JSON.parse(
  await readFile(
    path.join(
      root,
      'docs/production-readiness/post-r18/gates/g2/history/pre-gate-96e92825/BUNDLE.json',
    ),
    'utf8',
  ),
);
const blocked = Object.fromEntries(
  Object.entries(archive.files).map(([key, file]) => [key, JSON.parse(file.content)]),
);
const clone = () => structuredClone(blocked);
const syntheticSha = (value) => value.repeat(40);
const digest = '1'.repeat(64);
const gatePath = 'docs/production-readiness/post-r18/gates/g2/SOURCE_MANIFEST.json';

// This suite tests the current coordinator format. Legacy negative controls
// remain in g2-record.test.mjs and read a byte-preserved prior-format snapshot.
test('active canonical G2 and the preserved legacy closeout are both consistent', () => {
  assert.equal(recorded.gate.gateId, 'G2');
  assert.equal(historical.gate.gate, 'G2');
  assert.deepEqual(recordProblems(recorded), []);
  assert.deepEqual(recordProblems(historical), []);
  assert.deepEqual(recordProblems(blocked), []);
  for (const id of ['R29', 'R30', 'R31', 'R32', 'R33']) {
    const lane = recorded.wave.lanes.find((entry) => entry.id === id);
    const released =
      recorded.gate.decision === 'ACCEPTED' &&
      recorded.gate.publication.state === 'MERGED' &&
      recorded.gate.publication.verifiedMerge === true &&
      recorded.wave.status === 'READY_TO_START' &&
      lane.status === 'READY_TO_START' &&
      recorded.wave.startableLanes.includes(id);
    if (released) assert.deepEqual(readinessProblems(recorded, id), []);
    else
      assert.ok(
        readinessProblems(recorded, id).some((message) => message.includes('not authorized')),
      );
  }
});

test('the earlier failed browser observation is not relabeled as current successful evidence', () => {
  assert.equal(historical.r25.browser.exitCode, 1);
  assert.equal(historical.r25.browser.failed, null);
  assert.equal(blocked.gate.decision, 'BLOCKED');
  assert.equal(blocked.gate.frozenBaseSha, null);
  assert.equal(recorded.gate.preservedG1SourceSha, recorded.g1.frozenBaseSha);
});

for (const [name, mutate] of [
  [
    'unknown format',
    (b) => {
      b.gate.gateId = 'G9';
    },
  ],
  [
    'ambiguous format',
    (b) => {
      b.gate.gate = 'G2';
    },
  ],
  [
    'mixed candidate fields',
    (b) => {
      b.gate.candidate = historical.gate.candidate;
    },
  ],
  [
    'missing prerequisite',
    (b) => {
      delete b.g1;
    },
  ],
  [
    'old G1 overwritten',
    (b) => {
      b.gate.preservedG1SourceSha = syntheticSha('a');
    },
  ],
  [
    'short SHA',
    (b) => {
      b.gate.candidateSourceSha = '736208b';
    },
  ],
  [
    'zero SHA',
    (b) => {
      b.gate.candidateSourceSha = syntheticSha('0');
    },
  ],
  [
    'tree used as commit',
    (b) => {
      b.gate.candidateSourceSha = b.gate.candidateTreeSha;
    },
  ],
  [
    'removed evidence',
    (b) => {
      b.gate.mandatoryEvidence.pop();
    },
  ],
  [
    'reordered evidence',
    (b) => {
      b.gate.mandatoryEvidence.reverse();
    },
  ],
  [
    'invented evidence status',
    (b) => {
      b.gate.mandatoryEvidence[0].status = 'green';
    },
  ],
  [
    'wrong evidence source',
    (b) => {
      b.gate.mandatoryEvidence[0].sourceSha = syntheticSha('a');
    },
  ],
  [
    'wrong evidence tree',
    (b) => {
      b.gate.mandatoryEvidence[0].treeSha = syntheticSha('a');
    },
  ],
  [
    'missing evidence reference',
    (b) => {
      b.gate.mandatoryEvidence[0].reference = '';
    },
  ],
  [
    'missing blocker owner',
    (b) => {
      delete b.gate.blockers[0].owner;
    },
  ],
  [
    'wrong registry path',
    (b) => {
      b.registry.gates.G2 = '../other.json';
    },
  ],
  [
    'wrong wave path',
    (b) => {
      b.wave.decisionRecord = 'old/SOURCE_MANIFEST.json';
    },
  ],
  [
    'missing evidence catalog',
    (b) => {
      b.gate.evidenceRecord = null;
    },
  ],
  [
    'malformed lane',
    (b) => {
      b.wave.lanes[0] = null;
    },
  ],
  [
    'unknown publication',
    (b) => {
      b.gate.publication.state = 'DONE';
    },
  ],
  [
    'draft pretending merged',
    (b) => {
      b.gate.publication.verifiedMerge = true;
    },
  ],
  [
    'blocked freeze',
    (b) => {
      b.gate.frozenBaseSha = b.gate.candidateSourceSha;
    },
  ],
  [
    'blocked publication',
    (b) => {
      b.gate.publication.state = 'MERGED';
    },
  ],
  [
    'premature lane',
    (b) => {
      b.wave.lanes[3].status = 'READY_TO_START';
    },
  ],
  [
    'live authority',
    (b) => {
      b.gate.restrictions = { liveMoney: true };
    },
  ],
  [
    'same-wave dependency',
    (b) => {
      b.wave.lanes[3].dependencies.push('R29');
    },
  ],
  [
    'duplicate owner',
    (b) => {
      b.wave.lanes[3].exactFiles.push(b.wave.lanes[3].exactFiles[0]);
    },
  ],
  [
    'unsafe path',
    (b) => {
      b.wave.lanes[3].exactFiles.push('../private');
    },
  ],
  [
    'acceptance by label',
    (b) => {
      b.gate.decision = 'ACCEPTED';
    },
  ],
]) {
  test(`active records reject ${name}`, () => {
    const b = clone();
    mutate(b);
    assert.ok(recordProblems(b).length > 0, name);
    assert.ok(readinessProblems(b, 'R32').length > 0, name);
  });
}

// Pure in-memory contract double, never a published acceptance or authority grant.
function acceptedDouble(published = true) {
  const b = clone();
  const source = b.gate.candidateSourceSha;
  const tree = b.gate.candidateTreeSha;
  b.gate.decision = 'ACCEPTED';
  b.gate.blockers = [];
  b.gate.frozenBaseSha = b.wave.baseSha = source;
  b.gate.frozenTreeSha = tree;
  b.gate.acceptedSprints = Array.from({ length: 10 }, (_, i) => `R${19 + i}`);
  for (const e of b.gate.mandatoryEvidence) e.status = 'PASS';
  b.gate.mandatoryEvidence.find((e) => e.id === 'r28-checked-platform-plan').scope =
    'CONFIGURATION_ONLY';
  b.gate.restrictions = {
    liveMoney: false,
    deploy: false,
    merge: false,
    accountGrants: false,
    spend: false,
    preserveG1: true,
    preserveR16R18Holds: true,
  };
  b.gate.checks = {
    completeInventoryVerified: true,
    observed: [
      'R25 real replicas and recovery',
      'R18 functional completion acceptance',
      'CI gate',
      'Analyze JavaScript/TypeScript',
      'Production governance',
      'R27 comparable measurements and unchanged budgets',
    ].map((name, i) => ({
      name,
      id: 9000 + i,
      headSha: source,
      status: 'completed',
      conclusion: 'success',
    })),
    officialCodeQL: {
      id: 9900,
      headSha: source,
      appSlug: 'github-advanced-security',
      conclusion: 'success',
      annotationsCount: 0,
    },
  };
  b.gate.sourceArtifact = { treeRecomputed: true, trackedBlobsVerified: 100, zipSha256: digest };
  b.gate.contracts = {
    sourceSha: source,
    version: 'hsm.money.v1',
    sha256: Object.fromEntries(
      ['activation', 'collection', 'finance-read', 'refund'].map((name) => [
        `apps/api/src/modules/money/ports/${name}.port.ts`,
        digest,
      ]),
    ),
  };
  b.closeout = {
    sourceSha: source,
    treeSha: tree,
    historicalG1BaseSha: b.g1.frozenBaseSha,
    decision: 'ACCEPTED',
    lanes: Array.from({ length: 5 }, (_, i) => {
      const id = `R${24 + i}`;
      const s = b.registry.sprints.find((s) => s.id === id);
      const pr = 9000 + i;
      return {
        id,
        branch: s.branch,
        merged: true,
        integration: 'PASS',
        pr,
        prUrl: `https://github.com/baraabd/homeservicemarketplace/pull/${pr}`,
        sourceHeadSha: syntheticSha('a'),
        mergeCommitSha: syntheticSha('b'),
      };
    }),
  };
  b.r25 = {
    headSha: source,
    treeSha: tree,
    zipDigestVerified: true,
    zipSha256: digest,
    runId: 9000,
    artifactId: 9001,
    status: 'SANDBOX_ACCEPTED',
    api: { success: true, passed: 13, failed: 0, skipped: 0 },
    browser: { exitCode: 0, passed: 1, failed: 0, skipped: 0, timedOut: false },
    commands: [{ label: 'browser', exitCode: 0, timedOut: false, signal: null }],
  };
  const lane = b.wave.lanes[3];
  const s = b.registry.sprints.find((s) => s.id === 'R32');
  lane.frozenBaseSha = s.frozenBase = source;
  if (published) {
    b.gate.publication = {
      branch: 'chore/g2-wave2-acceptance',
      state: 'MERGED',
      acceptanceRecordCommitSha: syntheticSha('c'),
      verifiedMerge: true,
    };
    b.wave.status = 'READY_TO_START';
    b.wave.startableLanes = ['R32'];
    b.wave.blockedLanes = ['R29', 'R30', 'R31', 'R33'];
    lane.status = s.status = 'READY_TO_START';
    lane.ownershipApproval = s.ownershipApproval = 'APPROVED_AFTER_VERIFIED_G2_PUBLICATION';
    lane.sessionAssignment = {
      sessionId: 'synthetic-r32-session',
      assignedBy: 'synthetic fixture coordinator',
      assignedAt: '2026-10-22T00:00:00Z',
    };
  }
  return b;
}

test('complete canonical contract double needs separate verified publication before release', () => {
  assert.deepEqual(recordProblems(acceptedDouble(false)), []);
  assert.ok(readinessProblems(acceptedDouble(false), 'R32').length > 0);
  assert.deepEqual(readinessProblems(acceptedDouble(), 'R32'), []);
  assert.ok(readinessProblems(acceptedDouble(), 'R29').length > 0);
});

for (const [name, mutate] of [
  [
    'missing session assignment',
    (b) => {
      b.wave.lanes[3].sessionAssignment = null;
    },
  ],
  [
    'missing session identity',
    (b) => {
      delete b.wave.lanes[3].sessionAssignment.sessionId;
    },
  ],
  [
    'missing assignment authority',
    (b) => {
      delete b.wave.lanes[3].sessionAssignment.assignedBy;
    },
  ],
  [
    'missing assignment timestamp',
    (b) => {
      delete b.wave.lanes[3].sessionAssignment.assignedAt;
    },
  ],
  [
    'matching but conditional ownership',
    (b) => {
      b.wave.lanes[3].ownershipApproval =
        'CONDITIONAL_AFTER_VERIFIED_G2_PUBLICATION_AND_SESSION_ASSIGNMENT';
      b.registry.sprints.find((sprint) => sprint.id === 'R32').ownershipApproval =
        b.wave.lanes[3].ownershipApproval;
    },
  ],
  [
    'registry approval mismatch',
    (b) => {
      b.registry.sprints.find((sprint) => sprint.id === 'R32').ownershipApproval = 'CONDITIONAL';
    },
  ],
])
  test(`canonical Wave 3 readiness rejects ${name}`, () => {
    const b = acceptedDouble();
    assert.deepEqual(readinessProblems(b, 'R32'), []);
    mutate(b);
    assert.ok(
      readinessProblems(b, 'R32').some((message) =>
        /approved ownership and exact writer assignment/u.test(message),
      ),
    );
  });

for (const [name, mutate] of [
  [
    'failed checks',
    (b) => {
      b.gate.checks.observed[0].conclusion = 'failure';
    },
  ],
  [
    'skipped checks',
    (b) => {
      b.gate.checks.observed[0].conclusion = 'skipped';
    },
  ],
  [
    'cancelled checks',
    (b) => {
      b.gate.checks.observed[0].conclusion = 'cancelled';
    },
  ],
  [
    'old checks',
    (b) => {
      b.gate.checks.observed[0].headSha = syntheticSha('a');
    },
  ],
  [
    'missing checks',
    (b) => {
      b.gate.checks.observed = [];
    },
  ],
  [
    'duplicate checks',
    (b) => {
      b.gate.checks.observed.push(b.gate.checks.observed[0]);
    },
  ],
  [
    'incomplete inventory',
    (b) => {
      b.gate.checks.completeInventoryVerified = false;
    },
  ],
  [
    'missing unchanged-budget acceptance check',
    (b) => {
      b.gate.checks.observed = b.gate.checks.observed.filter(
        (check) => check.name !== 'R27 comparable measurements and unchanged budgets',
      );
    },
  ],
  [
    'failed unchanged-budget acceptance check',
    (b) => {
      b.gate.checks.observed.find(
        (check) => check.name === 'R27 comparable measurements and unchanged budgets',
      ).conclusion = 'failure';
    },
  ],
  [
    'missing CodeQL',
    (b) => {
      delete b.gate.checks.officialCodeQL;
    },
  ],
  [
    'annotated CodeQL',
    (b) => {
      b.gate.checks.officialCodeQL.annotationsCount = 1;
    },
  ],
  [
    'wrong CodeQL source',
    (b) => {
      b.gate.checks.officialCodeQL.headSha = syntheticSha('a');
    },
  ],
  [
    'missing provenance',
    (b) => {
      b.gate.sourceArtifact.treeRecomputed = false;
    },
  ],
  [
    'missing digest',
    (b) => {
      delete b.gate.contracts.sha256[Object.keys(b.gate.contracts.sha256)[0]];
    },
  ],
  [
    'wrong contract source',
    (b) => {
      b.gate.contracts.sourceSha = syntheticSha('a');
    },
  ],
  [
    'historical closeout',
    (b) => {
      b.closeout = historical.closeout;
    },
  ],
  [
    'missing R28',
    (b) => {
      b.closeout.lanes.pop();
    },
  ],
  [
    'wrong closeout repository',
    (b) => {
      b.closeout.lanes[0].prUrl = 'https://github.com/other/repo/pull/9000';
    },
  ],
  [
    'historical R25',
    (b) => {
      b.r25 = historical.r25;
    },
  ],
  [
    'unknown browser count',
    (b) => {
      b.r25.browser.failed = null;
    },
  ],
  [
    'failed browser',
    (b) => {
      b.r25.browser.exitCode = 1;
    },
  ],
  [
    'failed transport command',
    (b) => {
      b.r25.commands[0].exitCode = 1;
    },
  ],
  [
    'skipped API',
    (b) => {
      b.r25.api.skipped = 1;
    },
  ],
  [
    'unverified artifact',
    (b) => {
      b.r25.zipDigestVerified = false;
    },
  ],
  [
    'unverified publication',
    (b) => {
      b.gate.publication.verifiedMerge = false;
    },
  ],
  [
    'self-referential publication',
    (b) => {
      b.gate.publication.acceptanceRecordCommitSha = b.gate.candidateSourceSha;
    },
  ],
  [
    'old registry base',
    (b) => {
      b.registry.sprints.find((s) => s.id === 'R32').frozenBase = syntheticSha('a');
    },
  ],
  [
    'different registry ownership',
    (b) => {
      b.registry.sprints.find((s) => s.id === 'R32').ownedPaths.exact = [];
    },
  ],
  [
    'removed R28 hosted hold',
    (b) => {
      b.gate.externalBlockers = [];
    },
  ],
  [
    'missing policy preservation',
    (b) => {
      delete b.gate.restrictions;
    },
  ],
  [
    'dropped holds',
    (b) => {
      b.gate.restrictions.preserveR16R18Holds = false;
    },
  ],
  [
    'unpublished G1',
    (b) => {
      b.g1.publication.state = 'DRAFT';
    },
  ],
])
  test(`canonical acceptance refuses ${name}`, () => {
    const b = acceptedDouble();
    mutate(b);
    assert.ok(readinessProblems(b, 'R32').length > 0, name);
  });

test('both CLI modes read active files, never falling back to the preserved legacy snapshot', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hsm-g2-reader-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(path.join(root, '.github/scripts'), path.join(directory, '.github/scripts'), {
    recursive: true,
  });
  await cp(
    path.join(root, 'docs/production-readiness/post-r18'),
    path.join(directory, 'docs/production-readiness/post-r18'),
    { recursive: true },
  );
  const run = (mode) =>
    spawnSync(
      process.execPath,
      [path.join(directory, '.github/scripts/g2-record.mjs'), mode, 'R32'],
      { encoding: 'utf8', timeout: 10000 },
    );
  assert.equal(run('--check').status, 0);
  assert.equal(run('--ready').status, readinessProblems(recorded, 'R32').length ? 1 : 0);
  await writeFile(path.join(directory, gatePath), '{private_invalid_fixture');
  for (const mode of ['--check', '--ready']) {
    const result = run(mode);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unreadable or invalid G2/u);
    assert.doesNotMatch(result.stderr, /private_invalid_fixture/u);
  }
  await rm(path.join(directory, gatePath));
  assert.equal(run('--check').status, 1);
});

test('archived files retain the exact owner-merged Git blobs', async () => {
  const dir = 'docs/production-readiness/post-r18/gates/g2/history/closeout-6e13120/';
  const expected = JSON.parse(await readFile(path.join(root, dir, 'BLOBS.json'), 'utf8'));
  for (const [name, sha] of Object.entries(expected.files)) {
    const bytes = await readFile(path.join(root, dir, name));
    assert.equal(
      createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
      sha,
      name,
    );
  }
  assert.equal(expected.sourceCommit, '6e13120f140e973e793e9e1a7e76170dcb1850a0');
});

test('blocked canonical controls preserve all seven exact source blobs independently of active acceptance', () => {
  assert.equal(archive.schemaVersion, 1);
  assert.equal(archive.sourceCommit, '96e92825f9b65cf124317f43b55ce42fc97f5b49');
  assert.deepEqual(Object.keys(archive.files).sort(), [
    'closeout',
    'g1',
    'gate',
    'r25',
    'registry',
    'wave',
    'wave2',
  ]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(archive.files).map(([key, file]) => [key, file.blobSha])),
    {
      gate: '488888eff9e10739364a3fa5ddb00b452a2a2a4d',
      closeout: 'd380f36007cd0d05fa14e90159f4f6bec3dbf230',
      wave: 'd1fc12c16d7ab0b13a6aa7f6d4ea3e2c2f35ce2e',
      r25: 'c044719445ea2264e3fdebdaa6b023236e938ca5',
      registry: 'ca23801b5e8dbbd410538bbe505ae39117833e07',
      g1: 'a1648718f2f892cc9bebbde23c416a03c096915f',
      wave2: '3a08d715466cf70c010ca594ef5ec45ba0f43e43',
    },
  );
  for (const [key, file] of Object.entries(archive.files)) {
    const bytes = Buffer.from(file.content, 'utf8');
    assert.equal(
      createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
      file.blobSha,
      key,
    );
    assert.match(file.path, /^docs\/production-readiness\/post-r18\//u);
  }
  for (const id of ['R29', 'R30', 'R31', 'R32', 'R33'])
    assert.ok(readinessProblems(blocked, id).some((message) => message.includes('not authorized')));
});
