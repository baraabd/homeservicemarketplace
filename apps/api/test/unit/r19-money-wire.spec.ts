// R19 — hsm.money.v1 wire helpers (packages/contracts/src/money/wire.ts).
// Precision, range, canonical form and idempotency payloads. Hermetic.
import {
  assertCurrencyShape,
  canonicalJson,
  fromMoneyWire,
  MAX_MINOR_AMOUNT,
  MONEY_CONTRACT_VERSION,
  MoneyWireError,
  parseMinorAmountString,
  toMinorAmountString,
  toMoneyWire,
} from '@homeservicemarketplace/contracts';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof MoneyWireError ? error.code : 'OTHER';
  }
  return 'NONE';
};

describe('R19 money wire contract', () => {
  it('names one contract version', () => {
    expect(MONEY_CONTRACT_VERSION).toBe('hsm.money.v1');
  });

  it('round-trips amounts beyond Number.MAX_SAFE_INTEGER exactly', () => {
    for (const amount of [0n, 1n, 9007199254740991n, 9007199254740993n, MAX_MINOR_AMOUNT]) {
      expect(parseMinorAmountString(toMinorAmountString(amount))).toBe(amount);
    }
    // A JS number would have lost the last digit here.
    expect(toMinorAmountString(9007199254740993n)).toBe('9007199254740993');
  });

  it('refuses values outside PostgreSQL BIGINT and negative amounts', () => {
    expect(code(() => toMinorAmountString(MAX_MINOR_AMOUNT + 1n))).toBe('AMOUNT_OUT_OF_RANGE');
    expect(code(() => toMinorAmountString(-1n))).toBe('AMOUNT_OUT_OF_RANGE');
    expect(code(() => parseMinorAmountString('9223372036854775808'))).toBe('AMOUNT_OUT_OF_RANGE');
    expect(code(() => parseMinorAmountString('99999999999999999999'))).toBe('INVALID_AMOUNT');
  });

  it('never rounds, truncates or coerces a non-canonical amount', () => {
    for (const value of [
      '1.0',
      '1.5',
      '01',
      '+1',
      '-1',
      '1e3',
      ' 1',
      '1 ',
      '',
      '0x10',
      1,
      1n,
      null,
      undefined,
      '١٢٣',
    ]) {
      expect(code(() => parseMinorAmountString(value))).toBe('INVALID_AMOUNT');
    }
    expect(code(() => toMinorAmountString(1 as unknown as bigint))).toBe('INVALID_AMOUNT');
  });

  it('checks currency shape only, without normalizing wire input', () => {
    expect(assertCurrencyShape('USD')).toBe('USD');
    for (const value of ['usd', 'US', 'USDT', ' USD', 'U$D', '', 840, null]) {
      expect(code(() => assertCurrencyShape(value))).toBe('INVALID_CURRENCY');
    }
  });

  it('money objects carry exactly an amount string and a currency', () => {
    const wire = toMoneyWire({ amountMinor: 12345n, currency: 'XTS' });
    expect(wire).toEqual({ amountMinor: '12345', currency: 'XTS' });
    expect(fromMoneyWire(JSON.parse(JSON.stringify(wire)))).toEqual({
      amountMinor: 12345n,
      currency: 'XTS',
    });
    expect(code(() => fromMoneyWire({ amountMinor: 12345, currency: 'XTS' }))).toBe(
      'INVALID_AMOUNT',
    );
    expect(code(() => fromMoneyWire({ amountMinor: '1', currency: 'XTS', fee: '0' }))).toBe(
      'NOT_CANONICAL',
    );
    expect(code(() => fromMoneyWire(['1', 'XTS']))).toBe('INVALID_AMOUNT');
  });

  describe('canonical idempotency payload', () => {
    it('is independent of key order and stable across runs', () => {
      const a = canonicalJson({ b: 2n, a: { y: 'x', x: [1, true, null] } });
      const b = canonicalJson({ a: { x: [1, true, null], y: 'x' }, b: 2n });
      expect(a).toBe(b);
      expect(a).toBe('{"a":{"x":[1,true,null],"y":"x"},"b":{"$bigint":"2"}}');
    });

    it('distinguishes a bigint from the same digits as a string or number', () => {
      const values = [canonicalJson({ v: 5n }), canonicalJson({ v: '5' }), canonicalJson({ v: 5 })];
      expect(new Set(values).size).toBe(3);
    });

    it('changes when any field changes, including one more minor unit', () => {
      const base = { intent: 'pi_1', amount: 1000n, currency: 'XTS' };
      expect(canonicalJson(base)).not.toBe(canonicalJson({ ...base, amount: 1001n }));
      expect(canonicalJson(base)).not.toBe(canonicalJson({ ...base, currency: 'XXX' }));
    });

    it('refuses values that would make two commands collide or be ambiguous', () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      for (const value of [
        { v: undefined },
        { v: () => 1 },
        { v: Number.NaN },
        { v: Infinity },
        { v: new Date(0) },
        cyclic,
        Symbol('x'),
      ]) {
        expect(code(() => canonicalJson(value))).toBe('NOT_CANONICAL');
      }
    });
  });
});
