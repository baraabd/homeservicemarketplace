import { VerificationCaseWorkflowService } from './verification-case-workflow.service';
import { AppError } from '../../../../shared/errors/app-error';

// Sprint 9B.7 — the transaction that turns checked evidence into work access.
//
// docs/adr/0013-evidence-to-work-access-capability-transition.md
//
// Approval is the only place in this system where a decision about documents
// becomes a decision about whether somebody may earn money. Eight things have to
// happen and they have to happen TOGETHER:
//
//   case state, decision row, provider verification state, work-access grant,
//   audit, notification, outbox event — under one conditional claim.
//
// A partial success here is the worst outcome available: a case that says
// VERIFIED with no grant behind it lies about what the provider can do, and a
// grant with no decision behind it is access nobody authorised. So the tests
// below care less about the happy path than about what survives a failure.

const CASE_ID = 'case-1';
const PROVIDER_USER = 'user-provider';
const PROFILE = 'pp-1';
const REVIEWER = 'user-reviewer';

interface CaseRow {
  id: string;
  state: string;
  providerProfileId: string;
  policyVersion: string;
  requirementsSnapshot: unknown;
  assignedToUserId: string | null;
  providerProfile: { id: string; userId: string | null };
  documents: unknown[];
}

function caseRow(over: Partial<CaseRow> = {}): CaseRow {
  return {
    id: CASE_ID,
    state: 'IN_REVIEW',
    providerProfileId: PROFILE,
    policyVersion: 'p1',
    requirementsSnapshot: { policyVersion: 'p1', verificationRequired: true, requirements: [] },
    assignedToUserId: REVIEWER,
    providerProfile: { id: PROFILE, userId: PROVIDER_USER },
    documents: [],
    ...over,
  };
}

/** Records every write, and can be told to explode at a chosen step. */
function harness(
  options: {
    row?: CaseRow | null;
    updateCount?: number;
    /** Which table's write should throw, to prove the rollback. */
    failAt?: 'decision' | 'profile' | 'grant' | 'audit' | 'notification' | 'outbox';
    existingGrant?: { id: string; status: string } | null;
  } = {},
) {
  const writes: string[] = [];
  const decisions: Array<Record<string, unknown>> = [];
  const profileUpdates: Array<Record<string, unknown>> = [];
  const grants: Array<Record<string, unknown>> = [];
  const grantUpdates: Array<Record<string, unknown>> = [];
  const audits: Array<{ type: string; metadata: Record<string, unknown> }> = [];
  const outbox: Array<{ eventType: string }> = [];
  const notifications: Array<Record<string, unknown>> = [];
  const logged: unknown[] = [];

  const boom = (step: string) => {
    if (options.failAt === step) throw new Error(`forced failure at ${step}`);
  };

  const client = {
    verificationCase: {
      findUnique: jest.fn(async () => options.row ?? caseRow()),
      findFirst: jest.fn(async () => (options.row === null ? null : { id: CASE_ID })),
      updateMany: jest.fn(async () => {
        writes.push('case');
        return { count: options.updateCount ?? 1 };
      }),
    },
    verificationDecision: {
      create: jest.fn(async (a: { data: Record<string, unknown> }) => {
        boom('decision');
        writes.push('decision');
        decisions.push(a.data);
        return { id: 'dec' };
      }),
    },
    providerProfile: {
      update: jest.fn(async (a: { data: Record<string, unknown> }) => {
        boom('profile');
        writes.push('profile');
        profileUpdates.push(a.data);
        return { id: PROFILE };
      }),
    },
    providerWorkAccessGrant: {
      findFirst: jest.fn(async () => options.existingGrant ?? null),
      create: jest.fn(async (a: { data: Record<string, unknown> }) => {
        boom('grant');
        writes.push('grant');
        grants.push(a.data);
        return { id: 'grant-1' };
      }),
      updateMany: jest.fn(async (a: { data: Record<string, unknown> }) => {
        writes.push('grant-close');
        grantUpdates.push(a.data);
        return { count: 1 };
      }),
    },
    notification: {
      create: jest.fn(async (a: { data: Record<string, unknown> }) => {
        boom('notification');
        writes.push('notification');
        notifications.push(a.data);
        return { id: 'n' };
      }),
    },
  };

  const audit = {
    record: jest.fn(async (i: { type: string; metadata?: Record<string, unknown> }) => {
      boom('audit');
      writes.push('audit');
      audits.push({ type: i.type, metadata: i.metadata ?? {} });
    }),
  };
  const outboxRepo = {
    enqueue: jest.fn(async (i: { eventType: string }) => {
      boom('outbox');
      writes.push('outbox');
      outbox.push({ eventType: i.eventType });
      return { id: 'e' };
    }),
  };

  // A real transaction rolls everything back on throw. The double models that
  // by discarding the recorded writes, which is what "atomic" means here.
  const tx = {
    run: async <T>(fn: (t: unknown) => Promise<T>): Promise<T> => {
      const mark = writes.length;
      try {
        return await fn(client);
      } catch (e) {
        writes.length = mark;
        decisions.length = 0;
        profileUpdates.length = 0;
        grants.length = 0;
        audits.length = 0;
        notifications.length = 0;
        outbox.length = 0;
        throw e;
      }
    },
  };

  const settings = { requiredConsentVersion: jest.fn(async () => null) };

  const service = new VerificationCaseWorkflowService(
    { client } as never,
    tx as never,
    audit as never,
    outboxRepo as never,
    settings as never,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).log = {
    log: (o: unknown) => logged.push(o),
    warn: (o: unknown) => logged.push(o),
  };

  return {
    service,
    client,
    writes,
    decisions,
    profileUpdates,
    grants,
    grantUpdates,
    audits,
    outbox,
    notifications,
    logged,
  };
}

async function failure(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
    throw new Error('expected a refusal');
  } catch (e) {
    return e as Error;
  }
}

const APPROVE_REASON = 'DOCUMENTS_COMPLETE_AND_LEGIBLE' as const;

// ── approve ───────────────────────────────────────────────────────────────

describe('approve', () => {
  it('does all eight things', async () => {
    const h = harness();
    const out = await h.service.approve(REVIEWER, {
      caseId: CASE_ID,
      reasonCode: APPROVE_REASON,
    });

    expect(out).toMatchObject({ state: 'VERIFIED', changed: true });
    expect(h.writes).toEqual(
      expect.arrayContaining([
        'case',
        'decision',
        'profile',
        'grant',
        'audit',
        'notification',
        'outbox',
      ]),
    );
  });

  it('claims the case conditionally, so two reviewers cannot both approve', async () => {
    const h = harness();
    await h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON });
    expect(h.client.verificationCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CASE_ID, state: 'IN_REVIEW' } }),
    );
  });

  it('records the decision as APPROVED with the reviewer and the reason', async () => {
    const h = harness();
    await h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON });

    expect(h.decisions[0]).toMatchObject({
      outcome: 'APPROVED',
      reasonCode: APPROVE_REASON,
      toState: 'VERIFIED',
      decidedByUserId: REVIEWER,
    });
  });

  it('moves the provider onto the VERIFIED evidence axis', async () => {
    const h = harness();
    await h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON });
    expect(h.profileUpdates[0]).toMatchObject({ verificationState: 'VERIFIED', verified: true });
  });

  it('does NOT touch the account standing axis', async () => {
    // Approving documents says nothing about whether the account is in good
    // standing. A suspended provider whose documents check out is still
    // suspended, and conflating the two axes is how a suspension gets lifted by
    // an unrelated review.
    const h = harness();
    await h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON });
    expect(h.profileUpdates[0]).not.toHaveProperty('standingState');
    expect(h.profileUpdates[0]).not.toHaveProperty('status');
  });

  it('creates the grant from the case, marked as earned by documents', async () => {
    const h = harness();
    await h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON });

    expect(h.grants[0]).toMatchObject({
      providerProfileId: PROFILE,
      caseId: CASE_ID,
      status: 'ACTIVE',
      source: 'VERIFIED_DOCUMENTS',
      grantedByUserId: REVIEWER,
    });
  });

  it('refuses a reviewer approving their own case', async () => {
    const h = harness({
      row: caseRow({ providerProfile: { id: PROFILE, userId: REVIEWER } }),
    });
    const err = (await failure(
      h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON }),
    )) as AppError;

    expect(err.status).toBe(403);
    expect(h.writes).toEqual([]);
  });

  it('demands a reason, because approval is a judgement too', async () => {
    // "Why did we trust this?" is exactly the question the permanent record has
    // to answer years later.
    const h = harness();
    const err = (await failure(
      h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: undefined as never }),
    )) as AppError;

    expect(err.status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it('refuses to approve a case nobody submitted', async () => {
    const h = harness({ row: caseRow({ state: 'DRAFT' }) });
    const err = (await failure(
      h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON }),
    )) as AppError;
    expect(err.status).toBe(409);
    expect(h.writes).toEqual([]);
  });

  it('is idempotent on an already-verified case', async () => {
    const h = harness({ row: caseRow({ state: 'VERIFIED' }) });
    const out = await h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON });

    expect(out.changed).toBe(false);
    expect(h.writes).toEqual([]);
  });

  it('reports a conflict rather than a second grant when it loses the race', async () => {
    // The database's one-active-grant index is the real guarantee; this is the
    // application half of it.
    const h = harness({ updateCount: 0, row: caseRow() });
    const err = (await failure(
      h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON }),
    )) as AppError;

    expect(err.status).toBe(409);
    expect(h.grants).toEqual([]);
  });
});

// ── the rollback, step by step ────────────────────────────────────────────

describe('a failure anywhere rolls back everything', () => {
  it.each(['decision', 'profile', 'grant', 'audit', 'notification', 'outbox'] as const)(
    'a failure at the %s step leaves no trace',
    async (step) => {
      const h = harness({ failAt: step });

      await failure(h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON }));

      // Nothing survives: not the decision, not the grant, not the audit row,
      // not the notification, not the event. A case that says VERIFIED with no
      // grant behind it is the failure this whole design exists to prevent.
      expect(h.decisions).toEqual([]);
      expect(h.profileUpdates).toEqual([]);
      expect(h.grants).toEqual([]);
      expect(h.audits).toEqual([]);
      expect(h.notifications).toEqual([]);
      expect(h.outbox).toEqual([]);
    },
  );
});

// ── closing access ────────────────────────────────────────────────────────

describe('revoke', () => {
  it('closes the grant as REVOKED and records the decision', async () => {
    const h = harness({ row: caseRow({ state: 'VERIFIED' }) });
    const out = await h.service.revoke(REVIEWER, {
      caseId: CASE_ID,
      reasonCode: 'TRUST_AND_SAFETY_ACTION',
    });

    expect(out.state).toBe('EXPIRED');
    expect(h.grantUpdates[0]).toMatchObject({ status: 'REVOKED' });
    expect(h.decisions[0]).toMatchObject({ outcome: 'REVOKED' });
  });

  it('only closes grants that are still ACTIVE', async () => {
    // Re-closing an already-revoked grant would move its revokedAt forward and
    // rewrite when access actually ended.
    const h = harness({ row: caseRow({ state: 'VERIFIED' }) });
    await h.service.revoke(REVIEWER, { caseId: CASE_ID, reasonCode: 'TRUST_AND_SAFETY_ACTION' });

    const call = (h.client.providerWorkAccessGrant.updateMany.mock.calls[0] as unknown[])[0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toMatchObject({ providerProfileId: PROFILE, status: 'ACTIVE' });
  });
});

describe('reverify', () => {
  it('closes the grant as EXPIRED, not REVOKED', async () => {
    // Asking for fresh evidence is not a sanction.
    const h = harness({ row: caseRow({ state: 'VERIFIED' }) });
    await h.service.reverify(REVIEWER, {
      caseId: CASE_ID,
      reasonCode: 'POLICY_PERIOD_ELAPSED',
    });

    expect(h.grantUpdates[0]).toMatchObject({ status: 'EXPIRED' });
    expect(h.decisions[0]).toMatchObject({ outcome: 'REVERIFY_REQUIRED' });
  });
});

describe('what gets written down', () => {
  it('keeps the reviewer note and reason out of the notification', async () => {
    const h = harness();
    await h.service.approve(REVIEWER, {
      caseId: CASE_ID,
      reasonCode: APPROVE_REASON,
      note: 'SENTINELAPPROVE checked against the register',
    });

    const text = JSON.stringify(h.notifications);
    expect(text).not.toContain('SENTINELAPPROVE');
  });

  it('logs no note, reason or provider identity', async () => {
    const h = harness();
    await h.service.approve(REVIEWER, {
      caseId: CASE_ID,
      reasonCode: APPROVE_REASON,
      note: 'SENTINELAPPROVE',
    });

    const text = JSON.stringify(h.logged);
    expect(text).not.toContain('SENTINELAPPROVE');
    expect(text).not.toContain(PROVIDER_USER);
  });
});
