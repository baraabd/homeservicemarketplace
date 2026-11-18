'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');

for (const major of [2, 4]) {
  const entry = process.env.PICOMATCH_UNDER_TEST || path.join(root, `vendor/picomatch-v${major}`);
  const pm = require(entry);

  test(`picomatch v${major}: repeated wildcard bodies use the existing literal fallback`, () => {
    const patterns = [
      '+(*)',
      '*(*a)',
      '+(*a)',
      '+(a*)',
      '+(*?a)',
      '+(*[ab])',
      '+(*a|b)',
      '+([!]*a)',
      'prefix+(*a)suffix',
      '+(@(*a))',
      '+([[]*a)',
      '+(*(?=a)a)',
    ];
    for (const pattern of patterns) {
      for (const options of [{}, { maxExtglobRecursion: false }, { capture: true }]) {
        assert.equal(pm.isMatch(pattern, pattern, options), true, pattern);
        assert.equal(pm.isMatch('aaa!', pattern, options), false, pattern);
        assert.ok(!pm.makeRe(pattern, options).source.includes('[^/]*?'), pattern);
      }
    }
  });

  test(`picomatch v${major}: no-bracket mode cannot hide a wildcard from the guard`, () => {
    const pattern = '+([*a])';
    assert.ok(!pm.makeRe(pattern, { nobracket: true }).source.includes('[^/]*?'));
  });

  test(`picomatch v${major}: attacker-controlled matching completes in a bounded subprocess`, () => {
    // An unfixed copy hangs on these small inputs; kill its process rather than
    // letting a regression hang Jest, the application build, or this test runner.
    const program = `
      const assert = require('node:assert/strict');
      const pm = require(process.argv[1]);
      for (const pattern of ['+(*a)', '*(*a)', '+(*)', 'prefix+(*a)suffix']) {
        for (const options of [{}, { maxExtglobRecursion: false }]) {
          assert.equal(pm.isMatch('a'.repeat(1000) + '/', pattern, options), false);
        }
      }
    `;
    const result = spawnSync(process.execPath, ['-e', program, entry], {
      encoding: 'utf8',
      timeout: 2000,
      maxBuffer: 1024 * 1024,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
  });

  test(`picomatch v${major}: ordinary repository globs and literal stars keep their meaning`, () => {
    const cases = [
      ['apps/api/src/auth.ts', '**/*.{ts,tsx}', true],
      ['apps/web/src/auth.tsx', '**/*.{ts,tsx}', true],
      ['apps/web/src/auth.js', '**/*.{ts,tsx}', false],
      ['test/auth.spec.ts', '**/*.spec.ts', true],
      ['aaa', '+(a)', true],
      ['aba', '+(a|b)', true],
      ['***', '+([*])', true],
      ['***', '+("*")', true],
      ['***', '+(\\*)', true],
      ['aaa', '+([a])', true],
      ['aaa', '+(*(a))', true],
      ['auth.ts', '!*.js', true],
      ['.env', '*', false],
      ['file.txt', '*', true],
    ];
    for (const [value, pattern, expected] of cases) {
      assert.equal(pm.isMatch(value, pattern), expected, `${pattern}: ${value}`);
    }
  });
}
