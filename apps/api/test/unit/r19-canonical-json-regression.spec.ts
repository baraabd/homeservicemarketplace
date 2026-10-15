import assert from 'node:assert/strict';

import { canonicalJson, MoneyWireError } from '@homeservicemarketplace/contracts';

const rejects = (value: unknown) =>
  assert.throws(
    () => canonicalJson(value),
    (error: unknown) => error instanceof MoneyWireError && error.code === 'NOT_CANONICAL',
  );

test('preserves the published canonical example', () => {
  assert.equal(
    canonicalJson({ b: 2n, a: { y: 'x', x: [1, true, null] } }),
    '{"a":{"x":[1,true,null],"y":"x"},"b":{"$bigint":"2"}}',
  );
});
test('preserves key-order independence and exact large amounts', () => {
  assert.equal(
    canonicalJson({ b: 9007199254740993n, a: 'test' }),
    canonicalJson({ a: 'test', b: 9007199254740993n }),
  );
});
test('accepts null-prototype objects and repeated non-cyclic references', () => {
  const value = Object.assign(Object.create(null), { a: 'test' });
  assert.equal(canonicalJson([value, value]), '[{"a":"test"},{"a":"test"}]');
});
test('continues refusing cycles, undefined and non-finite input', () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const value of [cycle, undefined, NaN, Infinity, new Date(0)]) rejects(value);
});
test('rejects a user object impersonating the bigint tag', () =>
  rejects({ amount: { $bigint: '5' } }));
test('rejects reserved bigint tags on null-prototype objects', () =>
  rejects(Object.assign(Object.create(null), { $bigint: '5' })));
test('rejects a sparse singleton that would encode as an empty array', () => rejects(new Array(1)));
test('rejects nested sparse arrays', () =>
  rejects({ items: Object.assign(new Array<number>(3), { 0: 1, 2: 2 }) }));
test('rejects an array with extra named data', () =>
  rejects(Object.assign([1], { actor: 'different' })));
test('rejects symbol-keyed object data', () =>
  rejects({ id: 'test', [Symbol('actor')]: 'different' }));
test('rejects symbol-keyed array data', () =>
  rejects(Object.assign([1], { [Symbol('actor')]: 'different' })));
test('rejects non-enumerable object data', () =>
  rejects(Object.defineProperty({}, 'actor', { value: 'different' })));
test('rejects object accessors without invoking them', () => {
  let calls = 0;
  rejects({
    get actor() {
      calls += 1;
      return 'different';
    },
  });
  assert.equal(calls, 0);
});
test('rejects array accessors without invoking them', () => {
  let calls = 0;
  const value = [1];
  Object.defineProperty(value, '0', {
    enumerable: true,
    get() {
      calls += 1;
      return 2;
    },
  });
  rejects(value);
  assert.equal(calls, 0);
});
test('preserves output for representative existing confirmation commands', () => {
  const payload = {
    op: 'confirm-and-activate',
    contract: 'hsm.money.v1',
    amountMinor: 1000n,
    confirmedAt: '2026-10-15T00:00:00.000Z',
    currency: 'XTS',
    receiptMediaAssetId: null,
    reviewerUserId: null,
  };
  assert.equal(
    canonicalJson(payload),
    '{"amountMinor":{"$bigint":"1000"},"confirmedAt":"2026-10-15T00:00:00.000Z","contract":"hsm.money.v1","currency":"XTS","op":"confirm-and-activate","receiptMediaAssetId":null,"reviewerUserId":null}',
  );
});
