import { intakeEligibility, intakeIntentId, intakeRequestHash, parseIntakePolicy } from './dispute-intake.policy';
const config = { version: 'pilot-v1', enabled: true, pilotUserIds: ['owner'], allowedBookingStates: ['SCHEDULED', 'COMPLETED'], terminalWindowHours: 24 };
const now = new Date('2026-09-17T12:00:00Z');
const base = { actorUserId: 'owner', bookingState: 'SCHEDULED', terminalAt: null, now };
describe('Dispute intake policy — fail closed and versioned', () => {
  it.each([null, {}, { ...config, enabled: 'true' }, { ...config, terminalWindowHours: 0 }, { ...config, pilotUserIds: [] }, { ...config, unexpected: true }])('rejects an invalid policy %#', (value) => {
    expect(parseIntakePolicy(value)).toBeNull();
    expect(intakeEligibility({ ...base, policy: parseIntakePolicy(value) }).blocker).toBe('NOT_ENABLED');
  });
  it('requires both enabled and the actual principal in the cohort', () => {
    expect(intakeEligibility({ ...base, policy: parseIntakePolicy({ ...config, enabled: false }) }).blocker).toBe('NOT_ENABLED');
    expect(intakeEligibility({ ...base, actorUserId: 'other', policy: parseIntakePolicy(config) }).blocker).toBe('NOT_ENABLED');
    expect(intakeEligibility({ ...base, policy: parseIntakePolicy(config) }).blocker).toBeNull();
  });
  it('refuses unsupported booking states', () => {
    expect(intakeEligibility({ ...base, bookingState: 'CANCELLED', policy: parseIntakePolicy(config) }).blocker).toBe('BOOKING_STATE');
  });
  it('uses the terminal event clock and closes exactly at the deadline', () => {
    const input = { ...base, bookingState: 'COMPLETED', terminalAt: new Date('2026-09-16T12:00:00Z'), policy: parseIntakePolicy(config) };
    expect(intakeEligibility({ ...input, now: new Date(now.getTime() - 1) }).blocker).toBeNull();
    expect(intakeEligibility(input).blocker).toBe('WINDOW_ELAPSED');
    expect(intakeEligibility(input).deadline?.toISOString()).toBe(now.toISOString());
  });
  it.each([null, new Date('invalid'), new Date('2027-01-01')])('does not invent a terminal timestamp %#', (terminalAt) => {
    expect(intakeEligibility({ ...base, bookingState: 'COMPLETED', terminalAt, policy: parseIntakePolicy(config) }).blocker).toBe('TIMESTAMP_UNAVAILABLE');
  });
  it('normalizes sets but detects changes made under a reused policy label', () => {
    const first = parseIntakePolicy({ ...config, pilotUserIds: ['b', 'a'] });
    expect(parseIntakePolicy({ ...config, pilotUserIds: ['a', 'b', 'a'] })?.revision).toBe(first?.revision);
    expect(parseIntakePolicy({ ...config, terminalWindowHours: 25 })?.revision).not.toBe(parseIntakePolicy(config)?.revision);
  });
  it('scopes deterministic intent ids to the principal and never contains the raw key', () => {
    expect(intakeIntentId('owner', 'client-key')).toBe(intakeIntentId('owner', 'client-key'));
    expect(intakeIntentId('other', 'client-key')).not.toBe(intakeIntentId('owner', 'client-key'));
    expect(intakeIntentId('owner', 'client-key')).toMatch(/^di_[a-f0-9]{40}$/);
  });
  it('binds retry content to the booking, policy and normalized statement', () => {
    const body = { bookingId: 'booking', policyVersion: 'v1', issueCode: 'OTHER', requestedOutcome: 'REVIEW', statement: 'one statement' };
    expect(intakeRequestHash({ ...body, statement: ' one statement ' })).toBe(intakeRequestHash(body));
    for (const key of Object.keys(body) as Array<keyof typeof body>)
      expect(intakeRequestHash({ ...body, [key]: 'different' })).not.toBe(intakeRequestHash(body));
  });
});
