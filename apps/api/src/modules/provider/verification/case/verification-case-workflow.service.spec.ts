import { VerificationCaseWorkflowService } from './verification-case-workflow.service';
import { AppError } from '../../../../shared/errors/app-error';

// Sprint 9B.5 — the three commands that move a case: submit, assign,
// requestAction.
//
// docs/adr/0013 §1. The transition table is the authority; this class is the
// only thing allowed to act on it, and what it is tested for is the behaviour
// around the transition rather than the transition itself:
//
//   - a provider acts only on their OWN case, and a case they do not own is
//     answered exactly as one that does not exist
//   - a reviewer never reviews themselves
//   - every command is idempotent: a replay reports success without writing
//     twice
//   - a stale caller is refused rather than allowed to overwrite
//   - the state change, the decision row, the audit entry, the outbox event and
//     the notification are one transaction or none of them
//
// Doubles, because all of that is control flow. The transactional and
// concurrency claims are re-proved against a real database in the integration
// suite.

const CASE_ID = 'case-1';
const PROVIDER_USER = 'user-provider';
const REVIEWER = 'user-reviewer';

const READY_REQS = {
  policyVersion: 'p1',
  verificationRequired: true,
  requirements: [
    { kind: 'INDIVIDUAL_IDENTITY' as const, serviceCategoryId: null, fromVersion: 'p1' },
  ],
};

const COMPLETE_PROFILE = {
  id: 'pp-1',
  userId: PROVIDER_USER,
  displayName: 'Ahmad Plumbing Services',
  headline: 'Experienced plumber serving Aleppo and surrounds',
  bio: 'Fifteen years of residential and commercial plumbing across Aleppo, including emergency callouts and full bathroom installations.',
  phoneNumber: '+963900000000',
  serviceAreaCity: 'Aleppo',
  serviceAreaCountry: 'SY',
  serviceAreaRadiusKm: 25,
  acceptedConsentVersion: null,
  user: { emailVerifiedAt: new Date('2026-01-01T00:00:00Z') },
  _count: { serviceCategories: 2 },
};

interface CaseRow {
  id: string;
  state: string;
  providerProfileId: string;
  policyVersion: string;
  requirementsSnapshot: unknown;
  assignedToUserId: string | null;
  submittedAt: Date | null;
  providerProfile: typeof COMPLETE_PROFILE;
  documents: Array<{
    kind: string;
    serviceCategoryId: string | null;
    mediaAsset: { scanState: string } | null;
  }>;
}

function caseRow(over: Partial<CaseRow> = {}): CaseRow {
  return {
    id: CASE_ID,
    state: 'DRAFT',
    providerProfileId: 'pp-1',
    policyVersion: 'p1',
    requirementsSnapshot: READY_REQS,
    assignedToUserId: null,
    submittedAt: null,
    providerProfile: COMPLETE_PROFILE,
    documents: [
      {
        kind: 'INDIVIDUAL_IDENTITY',
        serviceCategoryId: null,
        mediaAsset: { scanState: 'CLEAN' },
      },
    ],
    ...over,
  };
}

function harness(
  options: { row?: CaseRow | null; updateCount?: number; afterRace?: CaseRow } = {},
) {
  let current = options.row === undefined ? caseRow() : options.row;
  const updates: Array<Record<string, unknown>> = [];
  const decisions: Array<Record<string, unknown>> = [];
  const audits: Array<{ type: string; metadata: Record<string, unknown> }> = [];
  const outbox: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const notifications: Array<Record<string, unknown>> = [];
  const ownCaseQueries: Array<Record<string, unknown>> = [];
  let reads = 0;

  const client = {
    verificationCase: {
      findFirst: jest.fn(async (args: { where: Record<string, unknown> }) => {
        ownCaseQueries.push(args.where);
        return current ? { id: current.id } : null;
      }),
      findUnique: jest.fn(async () => {
        reads += 1;
        // A second read models re-reading after losing the conditional update.
        if (reads > 1 && options.afterRace) return options.afterRace;
        return current;
      }),
      updateMany: jest.fn(
        async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          updates.push(args.data);
          const count = options.updateCount ?? 1;
          if (count === 1 && current) current = { ...current, ...(args.data as object) } as CaseRow;
          return { count };
        },
      ),
    },
    verificationDecision: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        decisions.push(args.data);
        return { id: 'dec-1' };
      }),
    },
    notification: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        notifications.push(args.data);
        return { id: 'notif-1' };
      }),
    },
  };

  const audit = {
    record: jest.fn(async (i: { type: string; metadata?: Record<string, unknown> }) => {
      audits.push({ type: i.type, metadata: i.metadata ?? {} });
    }),
  };
  const outboxRepo = {
    enqueue: jest.fn(async (i: { eventType: string; payload: Record<string, unknown> }) => {
      outbox.push({ eventType: i.eventType, payload: i.payload });
      return { id: 'evt' };
    }),
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(client) };
  const settings = { requiredConsentVersion: jest.fn(async () => null) };

  const service = new VerificationCaseWorkflowService(
    { client } as never,
    tx as never,
    audit as never,
    outboxRepo as never,
    settings as never,
  );

  return { service, client, updates, decisions, audits, outbox, notifications, ownCaseQueries };
}

async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
    throw new Error('expected a refusal');
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return e;
  }
}

// ── submit ────────────────────────────────────────────────────────────────

describe('submit', () => {
  it('moves a ready draft to SUBMITTED and stamps the time', async () => {
    const h = harness();
    const out = await h.service.submit(PROVIDER_USER, { caseId: CASE_ID });

    expect(out).toMatchObject({ state: 'SUBMITTED', changed: true });
    expect(h.updates[0]).toMatchObject({ state: 'SUBMITTED' });
    expect(h.updates[0].submittedAt).toBeInstanceOf(Date);
  });

  it('resubmits from ACTION_REQUIRED through the same edge', async () => {
    const h = harness({ row: caseRow({ state: 'ACTION_REQUIRED' }) });
    const out = await h.service.submit(PROVIDER_USER, { caseId: CASE_ID });
    expect(out.state).toBe('SUBMITTED');
  });

  it('pins the update to the state it observed', async () => {
    // Without this two submissions can both write, and the second overwrites a
    // case a reviewer may already have picked up.
    const h = harness();
    await h.service.submit(PROVIDER_USER, { caseId: CASE_ID });
    expect(h.client.verificationCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CASE_ID, state: 'DRAFT' } }),
    );
  });

  it('records NO decision — nobody judged anything', async () => {
    const h = harness();
    await h.service.submit(PROVIDER_USER, { caseId: CASE_ID });
    expect(h.decisions).toEqual([]);
  });

  it('announces the submission and audits it', async () => {
    const h = harness();
    await h.service.submit(PROVIDER_USER, { caseId: CASE_ID });

    expect(h.outbox[0]).toMatchObject({ eventType: 'verification.case.submitted' });
    expect(h.audits[0].type).toBe('VERIFICATION_CASE_SUBMITTED');
  });

  it('refuses a case owned by somebody else exactly as a missing one', async () => {
    // Non-enumerating: "not yours" and "no such case" must be indistinguishable
    // or the endpoint becomes a case-id oracle.
    const foreign = await failure(
      harness({
        row: caseRow({ providerProfile: { ...COMPLETE_PROFILE, userId: 'someone-else' } }),
      }).service.submit(PROVIDER_USER, { caseId: CASE_ID }),
    );
    const missing = await failure(
      harness({ row: null }).service.submit(PROVIDER_USER, { caseId: CASE_ID }),
    );

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.message).toBe(missing.message);
    expect(foreign.code).toBe(missing.code);
  });

  it('refuses an unready case with the blockers attached', async () => {
    const h = harness({ row: caseRow({ documents: [] }) });
    const err = await failure(h.service.submit(PROVIDER_USER, { caseId: CASE_ID }));

    expect(err.status).toBe(422);
    expect(err.details).toMatchObject({
      blockers: [expect.objectContaining({ code: 'MISSING_EVIDENCE' })],
    });
    expect(h.updates).toEqual([]);
  });

  it('is idempotent: submitting an already-submitted case changes nothing', async () => {
    const h = harness({ row: caseRow({ state: 'SUBMITTED' }) });
    const out = await h.service.submit(PROVIDER_USER, { caseId: CASE_ID });

    expect(out).toMatchObject({ state: 'SUBMITTED', changed: false });
    expect(h.updates).toEqual([]);
    expect(h.outbox).toEqual([]);
  });

  it('refuses a caller acting on a stale view of the case', async () => {
    const h = harness({ row: caseRow({ state: 'ACTION_REQUIRED' }) });
    const err = await failure(
      h.service.submit(PROVIDER_USER, { caseId: CASE_ID, expectedState: 'DRAFT' }),
    );
    expect(err.status).toBe(409);
    expect(err.details).toMatchObject({ reason: 'STALE_STATE' });
  });

  it('treats losing the race as an idempotent replay when the winner did the same thing', async () => {
    // Two tabs, one click each. The loser should report the truth — the case IS
    // submitted — rather than an error the provider cannot act on.
    const h = harness({
      row: caseRow(),
      updateCount: 0,
      afterRace: caseRow({ state: 'SUBMITTED' }),
    });
    const out = await h.service.submit(PROVIDER_USER, { caseId: CASE_ID });
    expect(out).toMatchObject({ state: 'SUBMITTED', changed: false });
  });

  it('reports a conflict when losing the race to something ELSE', async () => {
    const h = harness({
      row: caseRow(),
      updateCount: 0,
      afterRace: caseRow({ state: 'REJECTED' }),
    });
    const err = await failure(h.service.submit(PROVIDER_USER, { caseId: CASE_ID }));
    expect(err.status).toBe(409);
  });

  it('refuses to submit a VERIFIED case', async () => {
    const err = await failure(
      harness({ row: caseRow({ state: 'VERIFIED' }) }).service.submit(PROVIDER_USER, {
        caseId: CASE_ID,
      }),
    );
    expect(err.status).toBe(422);
    expect(JSON.stringify(err.details)).toContain('WRONG_STATE');
  });
});

// ── assign ────────────────────────────────────────────────────────────────

describe('assign', () => {
  it('claims a submitted case for the reviewer', async () => {
    const h = harness({ row: caseRow({ state: 'SUBMITTED' }) });
    const out = await h.service.assign(REVIEWER, { caseId: CASE_ID });

    expect(out).toMatchObject({ state: 'IN_REVIEW', changed: true });
    expect(h.updates[0]).toMatchObject({ state: 'IN_REVIEW', assignedToUserId: REVIEWER });
  });

  it('records no decision — assignment is workflow, not judgement', async () => {
    const h = harness({ row: caseRow({ state: 'SUBMITTED' }) });
    await h.service.assign(REVIEWER, { caseId: CASE_ID });
    expect(h.decisions).toEqual([]);
  });

  it('refuses a reviewer reviewing their own case', async () => {
    const h = harness({
      row: caseRow({
        state: 'SUBMITTED',
        providerProfile: { ...COMPLETE_PROFILE, userId: REVIEWER },
      }),
    });
    const err = await failure(h.service.assign(REVIEWER, { caseId: CASE_ID }));

    expect(err.status).toBe(403);
    expect(err.details).toMatchObject({ reason: 'SELF_REVIEW' });
    expect(h.updates).toEqual([]);
  });

  it('is idempotent when the same reviewer claims twice', async () => {
    const h = harness({
      row: caseRow({ state: 'IN_REVIEW', assignedToUserId: REVIEWER }),
    });
    const out = await h.service.assign(REVIEWER, { caseId: CASE_ID });

    expect(out.changed).toBe(false);
    expect(h.updates).toEqual([]);
  });

  it('lets a second reviewer take over, and records the handover', async () => {
    // Assignment is workflow, not authorization: someone has to be able to
    // pick up a case whose reviewer went on holiday.
    const h = harness({
      row: caseRow({ state: 'IN_REVIEW', assignedToUserId: 'other-reviewer' }),
    });
    const out = await h.service.assign(REVIEWER, { caseId: CASE_ID });

    expect(out.changed).toBe(true);
    expect(h.updates[0]).toMatchObject({ assignedToUserId: REVIEWER });
    expect(h.audits[0].metadata).toMatchObject({ previousAssignee: 'other-reviewer' });
  });

  it('refuses to assign a draft nobody has submitted', async () => {
    const err = await failure(
      harness({ row: caseRow({ state: 'DRAFT' }) }).service.assign(REVIEWER, { caseId: CASE_ID }),
    );
    expect(err.status).toBe(409);
  });
});

// ── requestAction ─────────────────────────────────────────────────────────

describe('requestAction', () => {
  const REASON = 'DOCUMENT_ILLEGIBLE' as const;

  it('returns the case to the provider and records the decision', async () => {
    const h = harness({ row: caseRow({ state: 'IN_REVIEW', assignedToUserId: REVIEWER }) });
    const out = await h.service.requestAction(REVIEWER, { caseId: CASE_ID, reasonCode: REASON });

    expect(out).toMatchObject({ state: 'ACTION_REQUIRED', changed: true });
    expect(h.decisions[0]).toMatchObject({
      outcome: 'ACTION_REQUIRED',
      reasonCode: REASON,
      fromState: 'IN_REVIEW',
      toState: 'ACTION_REQUIRED',
      decidedByUserId: REVIEWER,
    });
  });

  it('demands a reason, because the transition table says so', async () => {
    const h = harness({ row: caseRow({ state: 'IN_REVIEW' }) });
    const err = await failure(
      h.service.requestAction(REVIEWER, {
        caseId: CASE_ID,
        reasonCode: undefined as never,
      }),
    );
    expect(err.status).toBe(400);
    expect(h.updates).toEqual([]);
  });

  it('tells the provider, because they cannot discover this by looking', async () => {
    const h = harness({ row: caseRow({ state: 'IN_REVIEW' }) });
    await h.service.requestAction(REVIEWER, { caseId: CASE_ID, reasonCode: REASON });

    expect(h.notifications[0]).toMatchObject({
      userId: PROVIDER_USER,
      type: 'VERIFICATION_ACTION_REQUIRED',
      resourceType: 'VERIFICATION_CASE',
      resourceId: CASE_ID,
    });
  });

  it('puts no reviewer prose into the notification body', async () => {
    // The note is for the case, which is access-controlled. A notification is
    // listed, cached and pushed to a device.
    const h = harness({ row: caseRow({ state: 'IN_REVIEW' }) });
    await h.service.requestAction(REVIEWER, {
      caseId: CASE_ID,
      reasonCode: REASON,
      note: 'SENTINEL-the passport photo is blurry and the name is unreadable',
    });

    expect(JSON.stringify(h.notifications[0])).not.toContain('SENTINEL');
  });

  it('refuses a reviewer acting on their own case', async () => {
    const h = harness({
      row: caseRow({
        state: 'IN_REVIEW',
        providerProfile: { ...COMPLETE_PROFILE, userId: REVIEWER },
      }),
    });
    const err = await failure(
      h.service.requestAction(REVIEWER, { caseId: CASE_ID, reasonCode: REASON }),
    );
    expect(err.status).toBe(403);
  });

  it('is idempotent when the same reviewer repeats the same request', async () => {
    const h = harness({ row: caseRow({ state: 'ACTION_REQUIRED' }) });
    const out = await h.service.requestAction(REVIEWER, { caseId: CASE_ID, reasonCode: REASON });

    expect(out.changed).toBe(false);
    expect(h.decisions).toEqual([]);
    expect(h.notifications).toEqual([]);
  });

  it('refuses on a case nobody submitted', async () => {
    const err = await failure(
      harness({ row: caseRow({ state: 'DRAFT' }) }).service.requestAction(REVIEWER, {
        caseId: CASE_ID,
        reasonCode: REASON,
      }),
    );
    expect(err.status).toBe(409);
  });

  it('announces it on the outbox', async () => {
    const h = harness({ row: caseRow({ state: 'IN_REVIEW' }) });
    await h.service.requestAction(REVIEWER, { caseId: CASE_ID, reasonCode: REASON });
    expect(h.outbox[0]).toMatchObject({ eventType: 'verification.case.action_required' });
  });
});

// ── what every command has in common ──────────────────────────────────────

describe('every command', () => {
  it('reports the actions available AFTER the change, computed by the server', async () => {
    const h = harness();
    const out = await h.service.submit(PROVIDER_USER, { caseId: CASE_ID });
    // A submitted case offers the provider nothing — they wait.
    expect(out.availableActions).toEqual([]);
  });

  it('offers approve on a live case, now that the transaction exists', async () => {
    const h = harness({ row: caseRow({ state: 'SUBMITTED' }) });
    const out = await h.service.assign(REVIEWER, { caseId: CASE_ID });
    expect(out.availableActions).toContain('approve');
    expect(out.availableActions).not.toContain('expire');
  });

  it('writes nothing identifying into the audit metadata', async () => {
    const h = harness({ row: caseRow({ state: 'IN_REVIEW' }) });
    await h.service.requestAction(REVIEWER, {
      caseId: CASE_ID,
      reasonCode: 'DOCUMENT_ILLEGIBLE',
      note: 'SENTINEL-prose',
    });
    const text = JSON.stringify(h.audits);
    expect(text).not.toContain('SENTINEL');
  });
});

// ── resolving the caller's own case ───────────────────────────────────────

describe('submitOwnCase', () => {
  it('resolves the LIVE case rather than only a submittable one', async () => {
    // Filtering to the states submission is legal from makes the idempotent
    // replay unreachable: once the case is SUBMITTED there is nothing to find,
    // and a provider double-clicking gets a 404 about a case that plainly
    // exists. This shipped, and an integration test caught it — hence the unit
    // test, which is cheaper to run and names the mistake.
    const h = harness({ row: caseRow({ state: 'SUBMITTED' }) });
    const out = await h.service.submitOwnCase(PROVIDER_USER);

    expect(out).toMatchObject({ state: 'SUBMITTED', changed: false });

    const where = h.ownCaseQueries[0] as { state?: { notIn?: string[]; in?: string[] } };
    expect(where.state?.notIn).toEqual(expect.arrayContaining(['REJECTED', 'EXPIRED']));
    expect(where.state?.in).toBeUndefined();
  });

  it('scopes the lookup to the caller, so no case id can be supplied at all', async () => {
    const h = harness();
    await h.service.submitOwnCase(PROVIDER_USER);
    expect(h.ownCaseQueries[0]).toMatchObject({ providerProfile: { userId: PROVIDER_USER } });
  });

  it('answers a provider with no live case exactly as a missing one', async () => {
    const h = harness({ row: null });
    const err = await failure(h.service.submitOwnCase(PROVIDER_USER));
    expect(err.status).toBe(404);
  });
});

// ── reject ────────────────────────────────────────────────────────────────

describe('reject', () => {
  const REASON = 'SUSPECTED_FORGERY' as const;

  it('closes the case and records the decision', async () => {
    const h = harness({ row: caseRow({ state: 'IN_REVIEW', assignedToUserId: REVIEWER }) });
    const out = await h.service.reject(REVIEWER, { caseId: CASE_ID, reasonCode: REASON });

    expect(out).toMatchObject({ state: 'REJECTED', changed: true });
    expect(h.decisions[0]).toMatchObject({
      outcome: 'REJECTED',
      reasonCode: REASON,
      fromState: 'IN_REVIEW',
      toState: 'REJECTED',
      decidedByUserId: REVIEWER,
    });
  });

  it('is reachable from ACTION_REQUIRED as well', async () => {
    // A provider who was asked for something and never came back still has to
    // be closable, or the queue fills with cases nobody can finish.
    const h = harness({ row: caseRow({ state: 'ACTION_REQUIRED' }) });
    expect((await h.service.reject(REVIEWER, { caseId: CASE_ID, reasonCode: REASON })).state).toBe(
      'REJECTED',
    );
  });

  it('demands a reason, because the transition table says so', async () => {
    const h = harness({ row: caseRow({ state: 'IN_REVIEW' }) });
    const err = await failure(
      h.service.reject(REVIEWER, { caseId: CASE_ID, reasonCode: undefined as never }),
    );
    expect(err.status).toBe(400);
    expect(h.updates).toEqual([]);
    expect(h.decisions).toEqual([]);
  });

  it('refuses a reviewer rejecting their own case', async () => {
    const h = harness({
      row: caseRow({
        state: 'IN_REVIEW',
        providerProfile: { ...COMPLETE_PROFILE, userId: REVIEWER },
      }),
    });
    const err = await failure(h.service.reject(REVIEWER, { caseId: CASE_ID, reasonCode: REASON }));
    expect(err.status).toBe(403);
  });

  it('tells the provider', async () => {
    const h = harness({ row: caseRow({ state: 'IN_REVIEW' }) });
    await h.service.reject(REVIEWER, { caseId: CASE_ID, reasonCode: REASON });
    expect(h.notifications[0]).toMatchObject({
      userId: PROVIDER_USER,
      resourceType: 'VERIFICATION_CASE',
      resourceId: CASE_ID,
    });
  });

  it('puts neither the reviewer note nor the reason into the notification body', async () => {
    // A rejection reason is a judgement about a person. It belongs behind the
    // access-controlled case, not in a row that is listed, cached and pushed to
    // a device.
    const h = harness({ row: caseRow({ state: 'IN_REVIEW' }) });
    await h.service.reject(REVIEWER, {
      caseId: CASE_ID,
      reasonCode: REASON,
      note: 'SENTINELREJECT the document appears altered',
    });
    const text = JSON.stringify(h.notifications[0]);
    expect(text).not.toContain('SENTINELREJECT');
    expect(text).not.toContain('SUSPECTED_FORGERY');
  });

  it('is idempotent when the case is already rejected', async () => {
    const h = harness({ row: caseRow({ state: 'REJECTED' }) });
    const out = await h.service.reject(REVIEWER, { caseId: CASE_ID, reasonCode: REASON });

    expect(out.changed).toBe(false);
    expect(h.decisions).toEqual([]);
    expect(h.notifications).toEqual([]);
  });

  it('refuses on a case nobody submitted', async () => {
    const err = await failure(
      harness({ row: caseRow({ state: 'DRAFT' }) }).service.reject(REVIEWER, {
        caseId: CASE_ID,
        reasonCode: REASON,
      }),
    );
    expect(err.status).toBe(409);
  });

  it('refuses to reopen a VERIFIED case by rejecting it', async () => {
    // reject is not a correction tool. Undoing a grant is `revoke`, which is a
    // different edge with a different record.
    const err = await failure(
      harness({ row: caseRow({ state: 'VERIFIED' }) }).service.reject(REVIEWER, {
        caseId: CASE_ID,
        reasonCode: REASON,
      }),
    );
    expect(err.status).toBe(409);
  });

  it('offers nothing afterwards, to anyone', async () => {
    const h = harness({ row: caseRow({ state: 'IN_REVIEW' }) });
    const out = await h.service.reject(REVIEWER, { caseId: CASE_ID, reasonCode: REASON });
    expect(out.availableActions).toEqual([]);
  });
});

// ── approval is PREPARED, not exposed ─────────────────────────────────────

describe('approval is now real', () => {
  it('exposes the command', () => {
    // Until Sprint 9B.7 this asserted the METHOD DID NOT EXIST, because the
    // boundary was its absence rather than a flag. The transaction is built,
    // so the boundary is gone and the assertion inverts.
    const h = harness();
    expect(typeof (h.service as unknown as Record<string, unknown>).approve).toBe('function');
  });
});
