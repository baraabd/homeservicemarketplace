import { entitlementDecision, parsePlanEntitlements, subscriptionNow } from './entitlement-policy';

describe('R31 purchased entitlement snapshot', () => {
  const definitions = [
    { key: 'listing.publish', value: { kind: 'LIMIT', limit: 2 } },
    { key: 'profile.featured', value: { kind: 'BOOLEAN', enabled: false } },
    { key: 'messages.unlimited', value: { kind: 'LIMIT', limit: null } },
  ] as const;

  it('uses stored capabilities without interpreting a commercial plan name', () => {
    const parsed = parsePlanEntitlements(definitions);
    expect(parsed).toEqual(definitions);
    expect(entitlementDecision(parsed, 'listing.publish', 1, true)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(entitlementDecision(parsed, 'listing.publish', 2, true)).toMatchObject({
      allowed: false,
      reason: 'LIMIT_REACHED',
      remaining: 0,
    });
    expect(entitlementDecision(parsed, 'profile.featured', 0, true)).toMatchObject({
      allowed: false,
      reason: 'NOT_INCLUDED',
    });
    expect(entitlementDecision(parsed, 'missing.capability', 0, true)).toMatchObject({
      allowed: false,
      reason: 'NOT_INCLUDED',
    });
    expect(entitlementDecision(parsed, 'messages.unlimited', 100, true)).toMatchObject({
      allowed: true,
      remaining: null,
    });
    expect(entitlementDecision(parsed, 'messages.unlimited', 0, false)).toMatchObject({
      allowed: false,
      reason: 'NO_ACTIVE_SUBSCRIPTION',
    });
  });

  it.each([
    null,
    {},
    [{ key: 'a', value: { kind: 'LIMIT', limit: 1 } }],
    [{ key: 'listing.publish', value: { kind: 'LIMIT', limit: -1 } }],
    [{ key: 'listing.publish', value: { kind: 'LIMIT', limit: 1.1 } }],
    [{ key: 'listing.publish', value: { kind: 'LIMIT', limit: Number.MAX_SAFE_INTEGER + 1 } }],
    [{ key: 'listing.publish', value: { kind: 'LIMIT', limit: '10' } }],
    [{ key: 'listing.publish', value: { kind: 'BOOLEAN', enabled: 'true' } }],
    [{ key: 'listing.publish', value: { kind: 'BOOLEAN', enabled: true, limit: null } }],
    [{ key: 'listing.publish', value: { kind: 'LIMIT', limit: null }, verification: true }],
    [definitions[0], definitions[0]],
  ])('fails closed for malformed or ambiguous stored data %j', (input) => {
    expect(() => parsePlanEntitlements(input)).toThrow('snapshot is invalid');
  });

  it('validates and snapshots the injected clock', () => {
    const time = new Date('2030-01-01T00:00:00.000Z');
    const now = subscriptionNow({ now: () => time });
    time.setUTCFullYear(2040);
    expect(now.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    expect(() => subscriptionNow({ now: () => new Date('invalid') })).toThrow(
      'clock is unavailable',
    );
  });
});
