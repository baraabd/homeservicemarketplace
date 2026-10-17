import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { recordProblems, readinessProblems, readBundle } from './g2-record.mjs';

const recorded = await readBundle();
const clone = () => structuredClone(recorded);

test('checked-in G2 records are consistent but do not authorize R29', () => {
  assert.deepEqual(recordProblems(recorded), []);
  assert.ok(readinessProblems(recorded).some((error) => /not authorized/u.test(error)));
});

test('historical G1 source and publication remain separate from G2 inspection', async () => {
  const g1 = JSON.parse(await readFile(new URL(
    '../../docs/production-readiness/post-r18/gates/g1/SOURCE_MANIFEST.json', import.meta.url), 'utf8'));
  assert.equal(recorded.closeout.historicalG1BaseSha, g1.frozenBaseSha);
  assert.notEqual(recorded.gate.candidate.sourceSha, g1.frozenBaseSha);
});

test('safe failed browser evidence keeps unknown case counts rather than claiming zero failures', () => {
  assert.equal(recorded.r25.browser.exitCode, 1);
  assert.equal(recorded.r25.browser.failed, null);
  assert.equal(recorded.r25.browser.assertion, 'NOT_PUBLISHED');
  assert.equal(recorded.r25.commands.filter((command) => command.exitCode === 0).length, 8);
});

for (const [name, mutate] of [
  ['wrong repository', (b) => { b.gate.repository = 'other/repository'; }],
  ['short candidate SHA', (b) => { b.gate.candidate.sourceSha = '4e87bf0'; }],
  ['zero candidate SHA', (b) => { b.gate.candidate.sourceSha = '0'.repeat(40); }],
  ['mismatched source tree', (b) => { b.closeout.treeSha = 'a'.repeat(40); }],
  ['missing Wave 2 lane', (b) => { b.closeout.lanes.pop(); }],
  ['invented closeout branch', (b) => { b.closeout.lanes[0].branch = 'feat/other'; }],
  ['missing merge identity', (b) => { b.closeout.lanes[0].mergeCommitSha = null; }],
  ['wrong PR URL', (b) => { b.closeout.lanes[0].prUrl = 'https://github.com/other/repo/pull/1'; }],
  ['unmerged lane claiming merge', (b) => { b.closeout.lanes[4].mergeCommitSha = 'a'.repeat(40); }],
  ['overwritten historical G1 base', (b) => { b.closeout.historicalG1BaseSha = b.gate.candidate.sourceSha; }],
  ['removed mandatory requirement', (b) => { b.gate.mandatoryRequirements.pop(); }],
  ['missing requirement owner', (b) => { b.gate.mandatoryRequirements[0].owner = null; }],
  ['empty observed checks', (b) => { b.gate.checks.observed = []; }],
  ['old-source check', (b) => { b.gate.checks.observed[0].headSha = 'a'.repeat(40); }],
  ['duplicate check', (b) => { b.gate.checks.observed.push(b.gate.checks.observed[0]); }],
  ['fabricated check conclusion', (b) => { b.gate.checks.observed[0].conclusion = 'green'; }],
  ['unverified artifact digest', (b) => { b.r25.zipDigestVerified = false; }],
  ['wrong artifact source', (b) => { b.r25.headSha = 'a'.repeat(40); }],
  ['missing port digest', (b) => { delete b.gate.contracts.sha256[Object.keys(b.gate.contracts.sha256)[0]]; }],
  ['blocked gate frozen SHA', (b) => { b.gate.frozenBaseSha = b.gate.candidate.sourceSha; }],
  ['premature Wave 3 release', (b) => { b.wave.status = 'READY_TO_START'; }],
  ['unmerged acceptance publication', (b) => { b.gate.publication.state = 'MERGED'; }],
  ['conditional lane falsely startable', (b) => { b.wave.lanes[0].status = 'READY_TO_START'; }],
  ['path traversal', (b) => { b.wave.lanes[0].exact.push('../outside.ts'); }],
  ['wildcard ownership', (b) => { b.wave.lanes[0].exact.push('docs/production-readiness/r29/*.md'); }],
  ['shared application wiring', (b) => { b.wave.lanes[0].exact.push('apps/api/src/app.module.ts'); }],
  ['ungranted shared lease', (b) => { b.wave.lanes[0].leases.push({ path: 'package.json' }); }],
  ['same-wave dependency', (b) => { b.wave.lanes[0].dependencies.push('R31'); }],
  ['duplicate writer', (b) => { b.wave.lanes[0].exact.push(b.wave.lanes[0].exact[0]); }],
  ['invented missing peer package', (b) => { b.wave.lanes[1].title = 'Invented'; }],
  ['live-money authority', (b) => { b.gate.restrictions.liveMoney = true; }],
  ['dropped policy hold', (b) => { b.gate.restrictions.preserveR16R18Holds = false; }],
  ['acceptance by label only', (b) => { b.gate.decision = 'ACCEPTED'; b.closeout.decision = 'ACCEPTED'; }],
]) {
  test(`rejects ${name}`, () => {
    const candidate = clone();
    mutate(candidate);
    assert.ok(recordProblems(candidate).length > 0, name);
  });
}

for (const value of [null, [], {}, { gate: null }]) {
  test(`malformed bundle fails closed: ${JSON.stringify(value)}`, () => {
    assert.ok(recordProblems(value).length > 0);
  });
}

// In-memory contract doubles exercise transitions; these are not remote acceptance evidence.
function acceptedDouble(published = false) {
  const b = clone();
  const source = b.gate.candidate.sourceSha;
  b.gate.decision = b.closeout.decision = 'ACCEPTED';
  b.gate.frozenBaseSha = b.wave.frozenBaseSha = source;
  b.gate.frozenTreeSha = b.wave.frozenTreeSha = b.gate.candidate.treeSha;
  for (const lane of b.closeout.lanes) {
    lane.merged = true;
    lane.integration = 'PASS';
    lane.pr ??= 999999;
    lane.prUrl = `https://github.com/baraabd/homeservicemarketplace/pull/${lane.pr}`;
    lane.sourceHeadSha ??= 'b'.repeat(40);
    lane.mergeCommitSha ??= 'c'.repeat(40);
  }
  for (const requirement of b.gate.mandatoryRequirements) {
    requirement.status = 'PASS';
    requirement.sourceSha = source;
    requirement.evidenceUrls = ['https://example.invalid/contract-double-not-evidence'];
  }
  b.gate.checks.completeInventoryVerified = true;
  for (const check of b.gate.checks.observed) check.conclusion = 'success';
  for (const [i, name] of ['Analyze JavaScript/TypeScript', 'Production governance'].entries()) {
    b.gate.checks.observed.push({ name, id: 990 + i, headSha: source,
      status: 'completed', conclusion: 'success' });
  }
  b.gate.checks.officialCodeQL = { id: 999, headSha: source,
    appSlug: 'github-advanced-security', conclusion: 'success', annotationsCount: 0 };
  b.r25.status = 'SANDBOX_ACCEPTED';
  Object.assign(b.r25.browser, { exitCode: 0, passed: 2, failed: 0, skipped: 0 });
  for (const command of b.r25.commands) command.exitCode = 0;
  if (published) {
    b.gate.publication = { state: 'MERGED', verifiedMerge: true,
      acceptanceRecordCommitSha: 'd'.repeat(40) };
    b.wave.status = 'READY_TO_START';
    b.wave.registryTransition = 'SYNCHRONIZED';
    b.wave.lanes[0].status = 'READY_TO_START';
    Object.assign(b.registry.sprints.find((entry) => entry.id === 'R29'), {
      status: 'READY_TO_START', branch: b.wave.lanes[0].branch, frozenBase: source,
      ownedPaths: { exact: [...b.wave.lanes[0].exact] },
    });
  }
  return b;
}

test('contract double: accepted source alone does not release a lane before publication', () => {
  const b = acceptedDouble();
  assert.deepEqual(recordProblems(b), []);
  assert.ok(readinessProblems(b).length > 0);
});

test('contract double: only published and synchronized ownership is structurally startable', () => {
  const b = acceptedDouble(true);
  assert.deepEqual(readinessProblems(b), []);
  assert.ok(readinessProblems(b, 'R30').length > 0);
});

for (const [name, change] of [
  ['failed required check', (b) => { b.gate.checks.observed[0].conclusion = 'failure'; }],
  ['skipped required check', (b) => { b.gate.checks.observed[0].conclusion = 'skipped'; }],
  ['cancelled required check', (b) => { b.gate.checks.observed[0].conclusion = 'cancelled'; }],
  ['incomplete inventory', (b) => { b.gate.checks.completeInventoryVerified = false; }],
  ['missing official CodeQL', (b) => { delete b.gate.checks.officialCodeQL; }],
  ['CodeQL annotations', (b) => { b.gate.checks.officialCodeQL.annotationsCount = 1; }],
  ['old requirement evidence', (b) => { b.gate.mandatoryRequirements[0].sourceSha = 'f'.repeat(40); }],
  ['missing R28 acceptance', (b) => { b.closeout.lanes[4].integration = 'NOT_IMPLEMENTED'; }],
  ['unknown browser counts', (b) => { b.r25.browser.passed = null; }],
  ['failed required transport command', (b) => { b.r25.commands[0].exitCode = 1; }],
  ['unverified publication', (b) => { b.gate.publication.verifiedMerge = false; }],
  ['self-referential publication', (b) => { b.gate.publication.acceptanceRecordCommitSha = b.gate.candidate.sourceSha; }],
  ['unsynchronized registry', (b) => { b.wave.registryTransition = 'PENDING_CR_001'; }],
  ['different registry frozen SHA', (b) => { b.registry.sprints.find((entry) => entry.id === 'R29').frozenBase = 'e'.repeat(40); }],
  ['different registry owned paths', (b) => { b.registry.sprints.find((entry) => entry.id === 'R29').ownedPaths.exact = []; }],
]) {
  test(`accepted contract double rejects ${name}`, () => {
    const b = acceptedDouble(true);
    change(b);
    assert.ok(readinessProblems(b).length > 0, name);
  });
}
