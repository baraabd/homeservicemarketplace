'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { summarize } = require('./assert-playwright-run.cjs');

const report = (stats, errors = []) => ({ stats, errors });

test('accepts exactly the expected passes and binds the source SHA', () => {
  const { problems, summary } = summarize(
    report({ expected: 7, unexpected: 0, flaky: 0, skipped: 0 }),
    7,
    'R18',
    'abc123',
  );
  assert.deepEqual(problems, []);
  assert.equal(summary.accepted, true);
  assert.equal(summary.sourceSha, 'abc123');
});

test('a fully skipped run (missing environment) is a failure, not a pass', () => {
  const { problems, summary } = summarize(
    report({ expected: 0, unexpected: 0, flaky: 0, skipped: 7 }),
    7,
    'R18',
  );
  assert.equal(summary.accepted, false);
  assert.ok(problems.some((p) => p.includes('skipped')));
  assert.ok(problems.some((p) => p.includes('expected exactly 7')));
});

test('fewer tests than expected (renamed or filtered spec) fail', () => {
  const { problems } = summarize(
    report({ expected: 6, unexpected: 0, flaky: 0, skipped: 0 }),
    7,
    'R18',
  );
  assert.deepEqual(problems, ['6 passed, expected exactly 7']);
});

test('a flaky pass and a failure both fail', () => {
  assert.ok(
    summarize(report({ expected: 7, unexpected: 0, flaky: 1, skipped: 0 }), 7, 'R18').problems
      .length,
  );
  assert.ok(
    summarize(report({ expected: 6, unexpected: 1, flaky: 0, skipped: 0 }), 7, 'R18').problems
      .length,
  );
});

test('run-level errors and a missing stats block fail', () => {
  assert.ok(
    summarize(
      report({ expected: 7, unexpected: 0, flaky: 0, skipped: 0 }, [{ message: 'x' }]),
      7,
      'R18',
    ).problems.length,
  );
  assert.deepEqual(summarize({}, 7, 'R18').problems, ['the report has no stats block']);
});

test('the expected count must be a positive integer', () => {
  assert.ok(
    summarize(
      report({ expected: 0, unexpected: 0, flaky: 0, skipped: 0 }),
      0,
      'R18',
    ).problems.includes('expected must be a positive integer'),
  );
});
