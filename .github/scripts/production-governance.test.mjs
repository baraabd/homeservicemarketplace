import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  REQUIRED_CHECKS,
  PR_FIELDS,
  ownershipProblems,
  protectionProblems,
  templateProblems,
} from './production-governance.mjs';

function protectedBranch() {
  return {
    required_status_checks: { strict: true, contexts: [...REQUIRED_CHECKS] },
    enforce_admins: { enabled: true },
    required_pull_request_reviews: { dismiss_stale_reviews: true },
    required_conversation_resolution: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  };
}

test('complete classic branch-protection evidence passes', () => {
  assert.deepEqual(protectionProblems(protectedBranch()), []);
});

test('check objects are supported without contexts', () => {
  const evidence = protectedBranch();
  evidence.required_status_checks = {
    strict: true,
    checks: REQUIRED_CHECKS.map((context) => ({ context, app_id: 15368 })),
  };
  assert.deepEqual(protectionProblems(evidence), []);
});

test('an unreadable or absent policy never passes', () => {
  for (const evidence of [null, undefined, [], {}, { status: '403', message: 'Forbidden' }]) {
    assert.ok(protectionProblems(evidence).length > 0);
  }
});

test('each required status check is independently mandatory', () => {
  for (const name of REQUIRED_CHECKS) {
    const evidence = protectedBranch();
    evidence.required_status_checks.contexts = REQUIRED_CHECKS.filter((entry) => entry !== name);
    assert.ok(protectionProblems(evidence).includes(`Required check missing: ${name}`));
  }
});

test('unsafe settings and unknown booleans fail closed', () => {
  for (const field of ['enforce_admins', 'required_conversation_resolution']) {
    const evidence = protectedBranch();
    evidence[field].enabled = false;
    assert.ok(protectionProblems(evidence).length > 0);
  }
  for (const field of ['allow_force_pushes', 'allow_deletions']) {
    for (const setting of [{ enabled: true }, {}]) {
      const evidence = protectedBranch();
      evidence[field] = setting;
      assert.ok(protectionProblems(evidence).length > 0);
    }
  }
  const evidence = protectedBranch();
  evidence.required_status_checks.strict = false;
  assert.ok(protectionProblems(evidence).length > 0);
});

test('pull requests, stale-review invalidation and no bypass are mandatory', () => {
  for (const reviews of [null, {}, { dismiss_stale_reviews: false }]) {
    assert.ok(protectionProblems({ ...protectedBranch(), required_pull_request_reviews: reviews }).length);
  }
  for (const actor of ['users', 'teams', 'apps']) {
    const evidence = protectedBranch();
    evidence.required_pull_request_reviews.bypass_pull_request_allowances = { [actor]: [{}] };
    assert.ok(protectionProblems(evidence).includes('Remove pull-request bypass allowances'));
  }
});

test('PR template includes every evidence field', () => {
  const complete = PR_FIELDS.map((field) => `- ${field}:`).join('\n');
  assert.deepEqual(templateProblems(complete), []);
  for (const field of PR_FIELDS) {
    assert.ok(templateProblems(complete.replace(`- ${field}:`, '')).length > 0);
  }
});

test('a global CODEOWNER alone does not document authority-file ownership', () => {
  assert.ok(ownershipProblems('* @baraabd').length > 0);
  assert.ok(ownershipProblems('# /packages/database/ @baraabd').length > 0);
});


test('CLI resolves repository files independently of the working directory', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./production-governance.mjs', import.meta.url))], {
    cwd: tmpdir(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS repository governance files/u);
  assert.match(result.stdout, /protection is NOT verified/u);
});

test('CLI rejects a missing protection input without leaking file contents', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./production-governance.mjs', import.meta.url)), 'protection'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), 'FAIL governance input could not be read or parsed');
});
