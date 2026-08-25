import { ACTIVE_CASE_STATES, decideCaseCreation } from './case-creation-policy';

// Sprint 9B.2 — "the provider asked to start verification". What happens?
//
// docs/adr/0010 · docs/adr/0013 · the transition table in
// ../policy/case-transitions.ts
//
// Almost every call is a RETRY. A provider taps the button twice, a flaky
// connection replays the POST, a resumed session re-enters the flow. So the
// interesting question is not "can we create a case" but "which existing case
// is this really asking about", and the default answer must never be a second
// case: two open cases for one provider means two reviewers, two decisions,
// and no defined answer about which one governs access.
//
// Pure, so the whole state cross-product is testable without a database. The
// database enforces the same rule independently with a partial unique index —
// this decides, that guarantees.

const NOW = new Date('2026-08-25T12:00:00Z');
const earlier = (mins: number) => new Date(NOW.getTime() - mins * 60_000);

const kase = (over: Partial<Parameters<typeof decideCaseCreation>[0]['cases'][number]> = {}) => ({
  id: 'case-1',
  state: 'DRAFT' as const,
  createdAt: earlier(60),
  idempotencyKey: null as string | null,
  ...over,
});

const decide = (
  cases: Array<ReturnType<typeof kase>>,
  idempotencyKey: string | null = null,
): ReturnType<typeof decideCaseCreation> => decideCaseCreation({ cases, idempotencyKey, now: NOW });

describe('with no history', () => {
  it('creates the first case', () => {
    expect(decide([])).toEqual({ action: 'CREATE' });
  });
});

describe('an open case is resumed, never duplicated', () => {
  it.each(ACTIVE_CASE_STATES)('resumes a %s case', (state) => {
    expect(decide([kase({ state })])).toEqual({ action: 'RESUME', caseId: 'case-1' });
  });

  it('resumes rather than creating even when the provider has been asked for more', () => {
    // ACTION_REQUIRED is the state a provider is most likely to re-enter the
    // flow from, and the one where a second case would be most destructive:
    // the evidence already supplied is attached to the FIRST one.
    expect(decide([kase({ state: 'ACTION_REQUIRED' })])).toEqual({
      action: 'RESUME',
      caseId: 'case-1',
    });
  });
});

describe('terminal cases do not block a fresh attempt', () => {
  it.each(['REJECTED', 'EXPIRED'] as const)('creates a new case after %s', (state) => {
    expect(decide([kase({ state })])).toEqual({ action: 'CREATE' });
  });

  it('creates a new case when every past case is terminal', () => {
    expect(
      decide([
        kase({ id: 'old-1', state: 'REJECTED', createdAt: earlier(600) }),
        kase({ id: 'old-2', state: 'EXPIRED', createdAt: earlier(300) }),
      ]),
    ).toEqual({ action: 'CREATE' });
  });
});

describe('a verified provider is not quietly re-opened', () => {
  it('refuses, naming the verified case', () => {
    // Re-verification is a REVIEWER action (`reverify` opens a fresh case). A
    // provider-initiated new case here would let anyone drop their own
    // verified status by starting over.
    expect(decide([kase({ state: 'VERIFIED' })])).toEqual({
      action: 'REFUSE',
      code: 'ALREADY_VERIFIED',
      caseId: 'case-1',
    });
  });

  it('still refuses when an older terminal case sits alongside', () => {
    expect(
      decide([
        kase({ id: 'old', state: 'REJECTED', createdAt: earlier(600) }),
        kase({ id: 'current', state: 'VERIFIED', createdAt: earlier(60) }),
      ]),
    ).toMatchObject({ action: 'REFUSE', code: 'ALREADY_VERIFIED', caseId: 'current' });
  });
});

describe('idempotency key', () => {
  it('returns the case a previous call with the same key created', () => {
    expect(
      decide([kase({ id: 'from-key', state: 'REJECTED', idempotencyKey: 'k-1' })], 'k-1'),
    ).toEqual({ action: 'RESUME', caseId: 'from-key' });
  });

  it('wins over the terminal-state rule', () => {
    // Without the key this REJECTED case would mean CREATE. The whole point of
    // the key is that a replayed request returns what the first one did rather
    // than starting a second attempt the caller never asked for.
    expect(decide([kase({ state: 'REJECTED', idempotencyKey: 'k-1' })], 'k-1')).toEqual({
      action: 'RESUME',
      caseId: 'case-1',
    });
  });

  it('wins over the already-verified refusal', () => {
    expect(decide([kase({ state: 'VERIFIED', idempotencyKey: 'k-1' })], 'k-1')).toEqual({
      action: 'RESUME',
      caseId: 'case-1',
    });
  });

  it('ignores a key that matches nothing', () => {
    expect(decide([kase({ state: 'REJECTED', idempotencyKey: 'k-1' })], 'k-2')).toEqual({
      action: 'CREATE',
    });
  });

  it('does not match a null key against a null key', () => {
    // Two independent calls that both omitted the key are not the same call.
    expect(decide([kase({ state: 'REJECTED', idempotencyKey: null })], null)).toEqual({
      action: 'CREATE',
    });
  });
});

describe('corrupt history fails closed', () => {
  it('refuses when two active cases somehow exist', () => {
    // The partial unique index makes this unreachable. If it is ever reached,
    // the data is wrong in a way that decides who reviews this provider, and
    // picking one would hide it.
    expect(
      decide([kase({ id: 'a', state: 'SUBMITTED' }), kase({ id: 'b', state: 'IN_REVIEW' })]),
    ).toMatchObject({ action: 'REFUSE', code: 'MULTIPLE_ACTIVE_CASES' });
  });

  it('names both offending cases so the row can be found', () => {
    const decision = decide([
      kase({ id: 'a', state: 'SUBMITTED' }),
      kase({ id: 'b', state: 'IN_REVIEW' }),
    ]);
    expect(decision).toMatchObject({ action: 'REFUSE' });
    if (decision.action !== 'REFUSE') throw new Error('unreachable');
    expect(decision.conflictingCaseIds?.sort()).toEqual(['a', 'b']);
  });
});

describe('the active set is stated once', () => {
  it('holds exactly the states a provider or reviewer can still act on', () => {
    expect([...ACTIVE_CASE_STATES].sort()).toEqual([
      'ACTION_REQUIRED',
      'DRAFT',
      'IN_REVIEW',
      'SUBMITTED',
    ]);
  });

  it('excludes VERIFIED, which is finished rather than open', () => {
    expect(ACTIVE_CASE_STATES as readonly string[]).not.toContain('VERIFIED');
  });
});
