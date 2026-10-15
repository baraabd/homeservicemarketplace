// R19 — money at JSON boundaries and in idempotency payloads.
//
// In code, money is `bigint` minor units plus an uppercase three-letter
// currency (ADR 0014 decision 1). JSON cannot carry a bigint, and a JS number
// loses precision above 2^53 - 1, so every amount on the wire is a decimal
// string. The range is PostgreSQL BIGINT, which the ledger stores.
//
// Which currencies are supported, and each one's minor-unit scale, are not
// decided (R18 D-2 / R16 P8). These helpers check shape only and never assume
// two decimal places; a display layer must not divide by 100 on its own.

export const MONEY_CONTRACT_VERSION = 'hsm.money.v1' as const;

export const MAX_MINOR_AMOUNT = 9223372036854775807n; // PostgreSQL BIGINT max

/** A non-negative integer amount in minor units, as a canonical decimal string. */
export type MinorAmountString = string & { readonly __minorAmount: unique symbol };

const AMOUNT_PATTERN = /^(0|[1-9][0-9]{0,18})$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;

export class MoneyWireError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_AMOUNT'
      | 'AMOUNT_OUT_OF_RANGE'
      | 'INVALID_CURRENCY'
      | 'NOT_CANONICAL',
    message: string,
  ) {
    super(message);
    this.name = 'MoneyWireError';
  }
}

export function toMinorAmountString(amountMinor: bigint): MinorAmountString {
  if (typeof amountMinor !== 'bigint') {
    throw new MoneyWireError('INVALID_AMOUNT', 'Amounts are bigint minor units');
  }
  if (amountMinor < 0n || amountMinor > MAX_MINOR_AMOUNT) {
    throw new MoneyWireError('AMOUNT_OUT_OF_RANGE', 'Amount is outside the stored range');
  }
  return amountMinor.toString() as MinorAmountString;
}

/**
 * Strict parse: digits only, no sign, no leading zeros, no exponent, no
 * fraction, no whitespace. "1.0", "01", "1e3", " 5" and numbers are refused;
 * a value is never rounded or truncated.
 */
export function parseMinorAmountString(value: unknown): bigint {
  if (typeof value !== 'string' || !AMOUNT_PATTERN.test(value)) {
    throw new MoneyWireError(
      'INVALID_AMOUNT',
      'Amount must be a canonical non-negative integer string',
    );
  }
  const amount = BigInt(value);
  if (amount > MAX_MINOR_AMOUNT) {
    throw new MoneyWireError('AMOUNT_OUT_OF_RANGE', 'Amount is outside the stored range');
  }
  return amount;
}

/** Shape only. Never trims or upper-cases a value that arrives over the wire. */
export function assertCurrencyShape(value: unknown): string {
  if (typeof value !== 'string' || !CURRENCY_PATTERN.test(value)) {
    throw new MoneyWireError('INVALID_CURRENCY', 'Currency must be three uppercase letters');
  }
  return value;
}

export type MoneyWire = Readonly<{ amountMinor: MinorAmountString; currency: string }>;

export function toMoneyWire(money: { amountMinor: bigint; currency: string }): MoneyWire {
  return Object.freeze({
    amountMinor: toMinorAmountString(money.amountMinor),
    currency: assertCurrencyShape(money.currency),
  });
}

export function fromMoneyWire(value: unknown): { amountMinor: bigint; currency: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MoneyWireError('INVALID_AMOUNT', 'Money must be an object');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== 'amountMinor' || keys[1] !== 'currency') {
    throw new MoneyWireError('NOT_CANONICAL', 'Money has exactly amountMinor and currency');
  }
  return {
    amountMinor: parseMinorAmountString(record.amountMinor),
    currency: assertCurrencyShape(record.currency),
  };
}

/**
 * Canonical JSON for idempotency digests: object keys sorted, no
 * insignificant whitespace, bigint encoded as {"$bigint":"<decimal>"} so it
 * can never collide with a string or number. The $bigint object key is
 * reserved. Sparse/extended arrays, hidden/symbol properties and accessors
 * are refused rather than silently dropping data or executing getters.
 * undefined, functions, symbols, non-finite numbers, non-plain objects and
 * cycles are also refused. Finite numbers keep JSON.stringify semantics
 * (including -0 as 0); financial amounts use bigint or decimal strings.
 */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  const fail = (message: string): never => {
    throw new MoneyWireError('NOT_CANONICAL', message);
  };
  const encode = (input: unknown): string => {
    if (input === null) return 'null';
    switch (typeof input) {
      case 'string':
        return JSON.stringify(input);
      case 'boolean':
        return input ? 'true' : 'false';
      case 'number':
        if (!Number.isFinite(input)) return fail('Non-finite number');
        return JSON.stringify(input);
      case 'bigint':
        return `{"$bigint":${JSON.stringify(input.toString())}}`;
      case 'object': {
        if (seen.has(input)) return fail('Cyclic value');
        seen.add(input);
        if (Object.getOwnPropertySymbols(input).length !== 0) {
          return fail('Symbol keys are not canonical');
        }
        const descriptors = Object.getOwnPropertyDescriptors(input);
        let out: string;
        if (Array.isArray(input)) {
          if (Object.keys(descriptors).length !== input.length + 1) {
            return fail('Arrays must be dense and have no extra properties');
          }
          const encoded: string[] = [];
          for (let index = 0; index < input.length; index += 1) {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
              return fail('Arrays contain only enumerable data elements');
            }
            encoded.push(encode(descriptor.value));
          }
          out = `[${encoded.join(',')}]`;
        } else {
          const prototype = Object.getPrototypeOf(input);
          if (prototype !== Object.prototype && prototype !== null) {
            return fail('Only plain objects are canonical');
          }
          if (Object.hasOwn(descriptors, '$bigint')) {
            return fail('The $bigint key is reserved for the bigint encoding');
          }
          out = `{${Object.keys(descriptors)
            .sort()
            .map((key) => {
              const descriptor = descriptors[key];
              if (!descriptor.enumerable || !('value' in descriptor)) {
                return fail('Objects contain only enumerable data properties');
              }
              return `${JSON.stringify(key)}:${encode(descriptor.value)}`;
            })
            .join(',')}}`;
        }
        seen.delete(input);
        return out;
      }
      default:
        return fail(`Unsupported value of type ${typeof input}`);
    }
  };
  return encode(value);
}
