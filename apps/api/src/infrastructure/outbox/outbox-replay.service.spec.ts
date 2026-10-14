import {
  OutboxReplayRefusedError,
  REPLAY_MAX_EVENTS_PER_CALL,
  validateReplayRequest,
  type OutboxReplayRequest,
} from './outbox-replay.service';

// Shape validation only. Authorization, rate limits, audit and the DEAD→PENDING
// transition run against real Postgres in
// test/integration/r22-outbox-replay.integration.spec.ts.
describe('outbox replay request validation', () => {
  const base: OutboxReplayRequest = {
    operatorUserId: 'cuid_operator_1',
    reason: 'INC-123 handler fixed in 1.4.2',
    scope: { eventType: 'notification.created' },
    limit: 10,
    dryRun: true,
  };

  const refusal = (over: Partial<OutboxReplayRequest>) => {
    try {
      validateReplayRequest({ ...base, ...over });
      return null;
    } catch (err) {
      expect(err).toBeInstanceOf(OutboxReplayRefusedError);
      return (err as OutboxReplayRefusedError).code;
    }
  };

  it('accepts a scoped, reasoned, bounded request', () => {
    expect(refusal({})).toBeNull();
    expect(refusal({ scope: { eventIds: ['a', 'b'] } })).toBeNull();
    expect(refusal({ scope: { aggregateType: 'Booking', aggregateId: 'bk_1' } })).toBeNull();
  });

  it('refuses an unscoped "replay everything"', () => {
    expect(refusal({ scope: {} })).toBe('invalid-request');
    expect(refusal({ scope: { eventIds: [] } })).toBe('invalid-request');
  });

  it('refuses a missing or token reason', () => {
    expect(refusal({ reason: '' })).toBe('invalid-request');
    expect(refusal({ reason: '   fix    ' })).toBe('invalid-request');
    expect(refusal({ reason: 'x'.repeat(501) })).toBe('invalid-request');
  });

  it('refuses limits outside 1..max and an implicit dry-run flag', () => {
    expect(refusal({ limit: 0 })).toBe('invalid-request');
    expect(refusal({ limit: REPLAY_MAX_EVENTS_PER_CALL + 1 })).toBe('invalid-request');
    expect(refusal({ limit: 2.5 })).toBe('invalid-request');
    expect(refusal({ dryRun: undefined as unknown as boolean })).toBe('invalid-request');
  });

  it('refuses malformed identifiers instead of passing them to SQL', () => {
    expect(refusal({ operatorUserId: '' })).toBe('invalid-request');
    expect(refusal({ scope: { eventIds: ["x' OR 1=1 --"] } })).toBe('invalid-request');
    expect(refusal({ scope: { eventType: 'a b' } })).toBe('invalid-request');
    expect(refusal({ scope: { aggregateType: 'Booking', aggregateId: '../x' } })).toBe(
      'invalid-request',
    );
    expect(refusal({ scope: { aggregateId: 'bk_1' } })).toBe('invalid-request');
  });
});
