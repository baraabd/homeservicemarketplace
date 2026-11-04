'use strict';

// Regression tests for GHSA-gcqx-w48m-w2h4 (CVE-2026-93753): deepmerge <= 4.3.1
// copies an own enumerable `__proto__` key into the merge result, which replaces
// the result's prototype with attacker-controlled data.
//
// DEEPMERGE_UNDER_TEST may point at another deepmerge build (for example the
// upstream 4.3.1 registry package) to show the defect these tests expose.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const implementation = process.env.DEEPMERGE_UNDER_TEST
  ? path.resolve(process.env.DEEPMERGE_UNDER_TEST)
  : path.join(__dirname, '..');
const merge = require(implementation);

function assertSafeObject(object) {
  assert.equal(Object.getPrototypeOf(object), Object.prototype, 'keeps the ordinary prototype');
  assert.equal(object.admin, undefined, 'does not inherit attacker-controlled properties');
  assert.equal(Object.hasOwn(object, '__proto__'), false, 'omits the __proto__ key');
}

test('rejects source __proto__ regardless of the target shape', () => {
  const source = JSON.parse('{ "__proto__": { "admin": true }, "safe": true }');
  const targets = [
    Object.create(null),
    null,
    undefined,
    false,
    0,
    '',
    JSON.parse('{ "__proto__": { "admin": false } }'),
  ];
  for (const target of targets) {
    const result = merge(target, source);
    assertSafeObject(result);
    assert.equal(result.safe, true, 'ordinary source properties are preserved');
  }
  assert.equal(Object.prototype.admin, undefined, 'the global prototype is unchanged');
});

test('rejects __proto__ while copying the target, with and without cloning', () => {
  for (const clone of [true, false]) {
    const target = JSON.parse('{ "__proto__": { "admin": true }, "safe": { "value": 1 } }');
    const result = merge(target, { added: true }, { clone });
    assertSafeObject(result);
    assert.deepEqual(result.safe, { value: 1 });
    assert.equal(result.added, true);
    assert.equal(Object.getPrototypeOf(target), Object.prototype, 'the input is not mutated');
  }
});

test('rejects nested __proto__ in cloned objects and array elements', () => {
  const payload = JSON.parse('{ "__proto__": { "admin": true }, "safe": true }');
  const result = merge({ nested: payload, items: [payload] }, { other: payload, items: [payload] });
  for (const object of [result.nested, result.other, result.items[0], result.items[1]]) {
    assertSafeObject(object);
    assert.equal(object.safe, true);
    assert.notEqual(object, payload, 'cloned objects stay independent');
  }
});

test('merge.all — the form jest-config uses — cannot introduce a prototype', () => {
  const payload = JSON.parse('{ "session": { "__proto__": { "admin": true }, "safe": true } }');
  const result = merge.all([{ session: null }, payload, { session: { added: true } }]);
  assertSafeObject(result.session);
  assert.deepEqual(result.session, { safe: true, added: true });
});

test('never reads a __proto__ getter or passes __proto__ to customMerge', () => {
  const target = { safe: true };
  const source = { added: true };
  const unexpected = () => assert.fail('__proto__ must not be read');
  for (const object of [target, source]) {
    Object.defineProperty(object, '__proto__', { enumerable: true, get: unexpected });
  }
  const result = merge(target, source, {
    customMerge: (key) => (key === '__proto__' ? unexpected() : undefined),
  });
  assert.deepEqual(result, { safe: true, added: true });
});

test('ordinary deep merge semantics are unchanged', () => {
  const symbol = Symbol('kept');
  const target = { a: { b: 1, list: [1] }, keep: 'x', [symbol]: 1 };
  const source = { a: { c: 2, list: [2] }, added: new Date(0) };
  const result = merge(target, source);
  assert.deepEqual(result.a, { b: 1, c: 2, list: [1, 2] });
  assert.equal(result.keep, 'x');
  assert.equal(result[symbol], 1);
  assert.equal(result.added, source.added, 'non-mergeable values are copied by reference');
  assert.deepEqual(target.a, { b: 1, list: [1] }, 'inputs are not mutated');
  assert.deepEqual(
    merge({ a: [1] }, { a: [2] }, { arrayMerge: (_t, s) => s }),
    { a: [2] },
    'custom arrayMerge is honoured',
  );
  assert.throws(() => merge.all('not-an-array'), /first argument should be an array/);
  // jest-config merges preset globals with the default export and defaults with .all.
  assert.equal(typeof merge, 'function');
  assert.equal(typeof merge.all, 'function');
});
