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
    /** Sprint 9B.7 — what the settings row says a grant lasts, in days. */
    validityDays?: number;
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
      updateMany: jest.fn(
        async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          writes.push('grant-close');
          grantUpdates.push(a.data);
          return { count: 1 };
        },
      ),
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

  const settings = {
    requiredConsentVersion: jest.fn(async () => null),
    // Sprint 9B.7 — the approval reads its grant length from settings rather
    // than a constant. Pinned to the ADR 0013 default here so these tests keep
    // asserting the transaction, not the number.
    workGrantValidityDays: jest.fn(async () => options.validityDays ?? 365),
  };

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

// ── Sprint 9B.7 — the grant window is configured, not compiled in ─────────
//
// ADR 0013: `endsAt = decidedAt + VERIFICATION_GRANT_DAYS` (default 365,
// configurable). These prove the "configurable" half, which is the half a
// hard-coded constant would silently satisfy in every other test.
describe('the grant window', () => {
  const MS_PER_DAY = 86_400_000;

  it('reads the duration from settings rather than a constant', async () => {
    const h = harness({ validityDays: 30 });
    await h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON });

    const grant = h.grants[0];
    const granted = grant.grantedAt as Date;
    const expires = grant.expiresAt as Date;
    expect(expires.getTime() - granted.getTime()).toBe(30 * MS_PER_DAY);
  });

  it('a different setting produces a different window — same code path', async () => {
    // The pair is the point: one value alone cannot distinguish "read the
    // setting" from "happens to equal the constant".
    const a = harness({ validityDays: 7 });
    await a.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON });
    const b = harness({ validityDays: 900 });
    await b.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON });

    const span = (h: typeof a) =>
      (h.grants[0].expiresAt as Date).getTime() - (h.grants[0].grantedAt as Date).getTime();
    expect(span(a)).toBe(7 * MS_PER_DAY);
    expect(span(b)).toBe(900 * MS_PER_DAY);
  });

  it('never issues an open-ended grant', async () => {
    // The regression that matters most: before this sprint `expiresAt` was
    // never written at all, so every approval granted access that no expiry,
    // no sweep and no policy change could ever end.
    const h = harness();
    await h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON });
    expect(h.grants[0].expiresAt).toBeInstanceOf(Date);
    expect(h.grants[0].expiresAt).not.toBeNull();
  });

  it('anchors the grant to the SAME instant as the decision', async () => {
    // One clock read for the whole approval. If these ever diverge, the
    // decision and the access it created disagree about when it happened.
    const h = harness();
    await h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON });
    const decidedAt = h.decisions[0].decidedAt as Date | undefined;
    if (decidedAt) {
      expect((h.grants[0].grantedAt as Date).getTime()).toBe(decidedAt.getTime());
    }
    expect(h.grants[0].grantedAt).toBeInstanceOf(Date);
  });

  it.each([0, -1, 1.5])(
    'refuses the whole approval when the configured validity is %p',
    async (days) => {
      // Fail closed and fail LOUD. A misconfigured validity must not quietly
      // become "some other length" — and nothing may be written on the way out.
      const h = harness({ validityDays: days });
      await failure(h.service.approve(REVIEWER, { caseId: CASE_ID, reasonCode: APPROVE_REASON }));
      expect(h.writes).toEqual([]);
      expect(h.grants).toEqual([]);
      expect(h.decisions).toEqual([]);
    },
  );
});

// ── Sprint 9B.7 — revoking one case's grant must not touch the others ────
//
// A verification decision judges the evidence in ONE case. Closing every
// ACTIVE grant the provider holds — which is what this did before — would let
// a documents revocation destroy a MANUAL_OVERRIDE somebody granted
// deliberately for an unrelated reason, with no decision naming it and no way
// to tell afterwards it had existed. ADR 0013 requires the sources to stay
// distinguishable forever; erasing one as a side effect is that same harm.
describe('grant closure is scoped to the case that issued it', () => {
  it('revocation closes only grants carrying THIS case id', async () => {
    const h = harness({ row: caseRow({ state: 'VERIFIED' }) });
    await h.service.revoke(REVIEWER, { caseId: CASE_ID, reasonCode: 'TRUST_AND_SAFETY_ACTION' });

    expect(h.client.providerWorkAccessGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ caseId: CASE_ID, status: 'ACTIVE' }),
      }),
    );
  });

  it('re-verification is scoped the same way', async () => {
    const h = harness({ row: caseRow({ state: 'VERIFIED' }) });
    await h.service.reverify(REVIEWER, { caseId: CASE_ID, reasonCode: 'TRUST_AND_SAFETY_ACTION' });

    expect(h.client.providerWorkAccessGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ caseId: CASE_ID, status: 'ACTIVE' }),
      }),
    );
  });

  it('never issues a provider-wide close with no case scope', async () => {
    // The precise regression. A `where` naming only the provider is what
    // swept up MANUAL_OVERRIDE and LEGACY_BACKFILL rows.
    const h = harness({ row: caseRow({ state: 'VERIFIED' }) });
    await h.service.revoke(REVIEWER, { caseId: CASE_ID, reasonCode: 'TRUST_AND_SAFETY_ACTION' });

    for (const call of h.client.providerWorkAccessGrant.updateMany.mock.calls) {
      const where = call[0].where;
      expect(where).toHaveProperty('caseId');
    }
  });

  it('still records REVOKED for a revocation and EXPIRED for a re-verify', async () => {
    // Non-vacuity: scoping the WHERE must not have changed what is written.
    const r = harness({ row: caseRow({ state: 'VERIFIED' }) });
    await r.service.revoke(REVIEWER, { caseId: CASE_ID, reasonCode: 'TRUST_AND_SAFETY_ACTION' });
    expect(r.grantUpdates[0]).toMatchObject({ status: 'REVOKED' });

    const v = harness({ row: caseRow({ state: 'VERIFIED' }) });
    await v.service.reverify(REVIEWER, { caseId: CASE_ID, reasonCode: 'TRUST_AND_SAFETY_ACTION' });
    expect(v.grantUpdates[0]).toMatchObject({ status: 'EXPIRED' });
  });
});
