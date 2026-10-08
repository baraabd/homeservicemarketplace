import {
  assertWritable,
  normaliseEmail,
  settingEntry,
  validateSettingValue,
} from './setting-registry';

// R17-D — the one settings authority (D-1, D-2, D-3, D-5).

describe('setting registry', () => {
  it('fails closed for unknown keys, including prototype property names', () => {
    for (const key of ['nope', '__proto__', 'constructor', 'prototype', 'toString', ''])
      expect(() => settingEntry(key)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('validates structured policies with their consumer’s own parser', () => {
    const intake = settingEntry('disputes.self_service.intake');
    expect(() => validateSettingValue(intake, { enabled: true })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    const valid = {
      version: 'pilot-1',
      enabled: true,
      pilotUserIds: ['u1'],
      allowedBookingStates: ['COMPLETED'],
      terminalWindowHours: 72,
    };
    expect(validateSettingValue(intake, valid)).toEqual(valid);
    expect(() =>
      validateSettingValue(settingEntry('platform_supported_markets'), 'everywhere'),
    ).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('refuses writes to settings no product code reads', () => {
    expect(() => assertWritable(settingEntry('platform_fee_bps'))).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => assertWritable(settingEntry('verification_policy_max_documents'))).not.toThrow();
  });

  it('checks integer type and range', () => {
    const entry = settingEntry('verification_policy_max_documents');
    for (const bad of [0, 21, 2.5, '5', null, undefined, Number.NaN])
      expect(() => validateSettingValue(entry, bad)).toThrow(
        expect.objectContaining({ status: 400 }),
      );
    expect(validateSettingValue(entry, 7)).toBe(7);
  });
});

describe('normaliseEmail (D-2)', () => {
  it('accepts ordinary addresses and normalises case and whitespace', () => {
    expect(normaliseEmail('  Help@Example.COM ')).toBe('help@example.com');
    expect(normaliseEmail('a.b+c@sub.example.org')).toBe('a.b+c@sub.example.org');
  });

  it('rejects malformed addresses', () => {
    for (const bad of [
      'not-an-email',
      '@example.com',
      'a@',
      'a@b',
      'a@@b.com',
      'a@b..com',
      'a b@c.com',
      'a@b.com.',
      `${'a'.repeat(250)}@b.com`,
    ])
      expect(normaliseEmail(bad)).toBeNull();
  });

  it('answers a long hostile input in linear time', () => {
    // The old pattern backtracked quadratically on exactly this shape.
    const hostile = '!@!.' + '!.'.repeat(500_000) + '@';
    const started = process.hrtime.bigint();
    expect(normaliseEmail(hostile)).toBeNull();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    // Bounded by the length check before any scan; a generous ceiling keeps
    // this stable on a loaded CI runner.
    expect(ms).toBeLessThan(250);
  });
});
