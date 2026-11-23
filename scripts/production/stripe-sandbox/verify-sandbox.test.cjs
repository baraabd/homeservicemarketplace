'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('./verify-sandbox.cjs');
test('requires explicit offline scope and an absolute isolated SDK root', () => {
  assert.deepEqual(parseArgs(['--offline-signatures', '--sdk-root', '/task/sdk']), {
    sdkRoot: '/task/sdk',
  });
});
for (const args of [
  [],
  ['--live'],
  ['--sandbox'],
  ['--offline-signatures'],
  ['--offline-signatures', '--sdk-root', 'relative'],
  ['--offline-signatures', '--sdk-root', '/task/sdk', '--live'],
])
  test(`rejects ambiguous or unsupported invocation ${JSON.stringify(args)}`, () =>
    assert.throws(() => parseArgs(args)));
