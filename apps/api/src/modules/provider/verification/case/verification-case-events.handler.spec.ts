import { VerificationCaseEventsHandler } from './verification-case-events.handler';
import { OutboxEventType } from '../../../../infrastructure/outbox/outbox.tokens';

// Sprint 9B.5 — the consumer that keeps the case events from dead-lettering.
//
// The first test is the important one: this handler must claim exactly the
// event types the workflow service emits. If those drift apart, every
// submission becomes a dead outbox row and a logged error, and nothing else in
// the suite would notice.

function harness() {
  const incs: Array<Record<string, string>> = [];
  const logged: unknown[] = [];
  const metrics = {
    verificationCaseTransitionsTotal: {
      inc: (labels: Record<string, string>) => incs.push(labels),
    },
  };
  const handler = new VerificationCaseEventsHandler(metrics as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (handler as any).log = { warn: (o: unknown) => logged.push(o) };
  return { handler, incs, logged };
}

const event = (eventType: string, payload: Record<string, unknown>) =>
  ({ id: 'evt-1', eventType, payload }) as never;

describe('VerificationCaseEventsHandler', () => {
  it('claims exactly the event types the workflow service emits', () => {
    const { handler } = harness();
    expect([...handler.eventTypes].sort()).toEqual(
      [
        OutboxEventType.VERIFICATION_CASE_SUBMITTED,
        OutboxEventType.VERIFICATION_CASE_ACTION_REQUIRED,
        OutboxEventType.VERIFICATION_CASE_REJECTED,
      ].sort(),
    );
    expect(OutboxEventType.VERIFICATION_CASE_SUBMITTED).toBe('verification.case.submitted');
    expect(OutboxEventType.VERIFICATION_CASE_ACTION_REQUIRED).toBe(
      'verification.case.action_required',
    );
    expect(OutboxEventType.VERIFICATION_CASE_REJECTED).toBe('verification.case.rejected');
  });

  it('has a stable name, because it is persisted', () => {
    expect(harness().handler.name).toBe('verification-case.metrics');
  });

  it.each(['SUBMITTED', 'ACTION_REQUIRED', 'IN_REVIEW', 'REJECTED'])(
    'counts a transition to %s under its own label',
    async (toState) => {
      const { handler, incs } = harness();
      await handler.handle(
        event('verification.case.submitted', { caseId: 'c1', toState }),
        {} as never,
      );
      expect(incs).toEqual([{ to_state: toState }]);
    },
  );

  it('buckets an unrecognised state instead of using it as a label', async () => {
    const { handler, incs, logged } = harness();
    await handler.handle(
      event('verification.case.submitted', { toState: 'WHATEVER-I-LIKE' }),
      {} as never,
    );
    expect(incs).toEqual([{ to_state: 'unknown' }]);
    expect(JSON.stringify(logged)).not.toContain('WHATEVER-I-LIKE');
  });

  it('does not throw on a malformed payload', async () => {
    // Throwing means "retry me", and a retry cannot make a payload valid.
    const { handler } = harness();
    await expect(
      handler.handle(
        { id: 'e', eventType: 'verification.case.submitted', payload: null } as never,
        {} as never,
      ),
    ).resolves.toBeUndefined();
  });

  it('records nothing identifying', async () => {
    const { handler, incs } = harness();
    await handler.handle(
      event('verification.case.submitted', {
        caseId: 'case-secret',
        providerProfileId: 'pp-secret',
        toState: 'SUBMITTED',
      }),
      {} as never,
    );
    const text = JSON.stringify(incs);
    expect(text).not.toContain('case-secret');
    expect(text).not.toContain('pp-secret');
  });
});
