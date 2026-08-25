import { ProviderVerificationCaseService } from './provider-verification-case.service';

// Sprint 9B.2 — the provider asks to start verification.
//
// docs/adr/0010 · docs/adr/0013
//
// The service owns orchestration only. Which case a request refers to is
// decided by case-creation-policy.ts, what must be proven is resolved by
// requirement-resolver.ts, and both are tested without a database. What only
// this layer can get wrong is ownership, the transaction boundary, and turning
// a database constraint violation into a stable API error.
//
// The ownership tests are the load-bearing ones: every method takes a USER id
// and must derive the provider profile itself. A method that accepted a
// providerProfileId from the caller would be an IDOR by construction.

const USER = 'user-1';
const PROFILE = 'pp-1';

const LIVE_POLICY = {
  version: '2026.09-zz-v1',
  country: 'ZZ',
  providerType: null,
  categoryId: null,
  requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
  publishedAt: new Date('2026-01-01T00:00:00Z'),
  retiredAt: null,
};

interface Overrides {
  profile?: unknown;
  cases?: unknown[];
  policies?: unknown[];
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  createImpl?: (args?: any) => Promise<unknown>;
}

function build(over: Overrides = {}) {
  const profileFindFirst = jest
    .fn()
    .mockResolvedValue(
      over.profile === undefined
        ? { id: PROFILE, serviceAreaCountry: 'ZZ', providerType: null, serviceCategories: [] }
        : over.profile,
    );
  // The double emulates the ORDER BY the service asks for. The service
  // delegates ordering to Postgres, which is right — so a double that returned
  // insertion order would be testing a query the service never issues.
  const sorted = [...(over.cases ?? [])].sort(
    (a, b) =>
      (b as { createdAt: Date }).createdAt.getTime() -
      (a as { createdAt: Date }).createdAt.getTime(),
  );
  const caseFindMany = jest.fn().mockResolvedValue(sorted);
  const caseFindFirst = jest.fn(
    async (args: { where: { id: string; providerProfileId: string } }) =>
      sorted.find(
        (c) =>
          (c as { id: string }).id === args.where.id && args.where.providerProfileId === PROFILE,
      ) ?? null,
  );
  const caseCreate = jest.fn(
    over.createImpl ??
      (async (args: { data: Record<string, unknown> }) => ({
        id: 'case-new',
        state: 'DRAFT',
        policyVersion: LIVE_POLICY.version,
        createdAt: new Date(),
        updatedAt: new Date(),
        submittedAt: null,
        ...args.data,
      })),
  );
  const policyFindMany = jest.fn().mockResolvedValue(over.policies ?? [LIVE_POLICY]);

  const client = {
    providerProfile: { findFirst: profileFindFirst },
    verificationCase: { findMany: caseFindMany, findFirst: caseFindFirst, create: caseCreate },
    verificationRequirementPolicy: { findMany: policyFindMany },
  };

  const txRun = jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(client));
  const auditRecord = jest.fn().mockResolvedValue(undefined);

  const service = new ProviderVerificationCaseService(
    { client } as never,
    { run: txRun } as never,
    { record: auditRecord } as never,
  );

  // Typed handles for assertions: the constructor arguments are cast to
  //  because these doubles implement only what the service touches.
  return {
    service,
    profileFindFirst: profileFindFirst as jest.Mock,
    caseFindMany: caseFindMany as jest.Mock,
    caseFindFirst: caseFindFirst as unknown as jest.Mock,
    caseCreate: caseCreate as unknown as jest.Mock,
    policyFindMany: policyFindMany as jest.Mock,
    txRun: txRun as unknown as jest.Mock,
    auditRecord: auditRecord as jest.Mock,
  };
}

describe('ownership', () => {
  it('derives the provider profile from the authenticated user', async () => {
    // Never from a caller-supplied id. The whole method signature is the
    // IDOR defence.
    const h = build();
    await h.service.createOrResume(USER, {});
    expect(h.profileFindFirst).toHaveBeenCalledTimes(1);
    expect(h.profileFindFirst.mock.calls[0][0].where).toMatchObject({
      userId: USER,
      deletedAt: null,
    });
  });

  it('404s a user with no provider profile', async () => {
    const h = build({ profile: null });
    await expect(h.service.createOrResume(USER, {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    expect(h.caseCreate).not.toHaveBeenCalled();
  });

  it('scopes the case lookup to that profile', async () => {
    const h = build();
    await h.service.createOrResume(USER, {});
    expect(h.caseFindMany.mock.calls[0][0].where).toMatchObject({ providerProfileId: PROFILE });
  });

  it('scopes the current-case read to that profile too', async () => {
    const h = build({
      cases: [{ id: 'c-1', state: 'DRAFT', createdAt: new Date(), idempotencyKey: null }],
    });
    await h.service.current(USER);
    expect(h.caseFindMany.mock.calls[0][0].where).toMatchObject({ providerProfileId: PROFILE });
  });
});

describe('creating', () => {
  it('creates a case stamped with the resolved policy version', async () => {
    const h = build();
    const out = await h.service.createOrResume(USER, {});
    expect(h.caseCreate).toHaveBeenCalledTimes(1);
    expect(h.caseCreate.mock.calls[0][0].data).toMatchObject({
      providerProfileId: PROFILE,
      policyVersion: LIVE_POLICY.version,
      state: 'DRAFT',
    });
    expect(out.created).toBe(true);
  });

  it('snapshots the requirements onto the case', async () => {
    // The case must stand alone: a reviewer checklist and any later replay
    // must not depend on the policy row still existing or still saying this.
    const h = build();
    await h.service.createOrResume(USER, {});
    const data = h.caseCreate.mock.calls[0][0].data;
    expect(data.requirementsSnapshot).toMatchObject({
      policyVersion: LIVE_POLICY.version,
      verificationRequired: true,
    });
  });

  it('captures the country and provider type the requirements were resolved for', async () => {
    const h = build();
    await h.service.createOrResume(USER, {});
    expect(h.caseCreate.mock.calls[0][0].data).toMatchObject({ country: 'ZZ' });
  });

  it('stores the idempotency key when one is supplied', async () => {
    const h = build();
    await h.service.createOrResume(USER, { idempotencyKey: 'k-1' });
    expect(h.caseCreate.mock.calls[0][0].data.idempotencyKey).toBe('k-1');
  });

  it('audits creation inside the same transaction', async () => {
    const h = build();
    await h.service.createOrResume(USER, {});
    expect(h.txRun).toHaveBeenCalledTimes(1);
    expect(h.auditRecord.mock.calls[0][0].type).toBe('VERIFICATION_CASE_CREATED');
    expect(h.auditRecord.mock.calls[0][1]).toBeDefined();
  });

  it('fails closed when no policy is in force', async () => {
    // The single most dangerous silent success available here would be
    // resolving to an empty requirement set and calling the provider verified
    // with no evidence. resolveRequirements throws; this must not swallow it.
    const h = build({ policies: [] });
    await expect(h.service.createOrResume(USER, {})).rejects.toMatchObject({ status: 503 });
    expect(h.caseCreate).not.toHaveBeenCalled();
  });

  it('does not select a retired policy', async () => {
    const h = build({
      policies: [{ ...LIVE_POLICY, retiredAt: new Date('2026-02-01T00:00:00Z') }],
    });
    await expect(h.service.createOrResume(USER, {})).rejects.toMatchObject({ status: 503 });
  });

  it('does not select a policy that has not started yet', async () => {
    const h = build({
      policies: [{ ...LIVE_POLICY, publishedAt: new Date('2999-01-01T00:00:00Z') }],
    });
    await expect(h.service.createOrResume(USER, {})).rejects.toMatchObject({ status: 503 });
  });
});

describe('resuming', () => {
  const open = { id: 'case-open', state: 'DRAFT', createdAt: new Date(), idempotencyKey: null };

  it('returns the open case instead of creating a second one', async () => {
    const h = build({ cases: [open] });
    const out = await h.service.createOrResume(USER, {});
    expect(h.caseCreate).not.toHaveBeenCalled();
    expect(out.created).toBe(false);
    expect(out.case.id).toBe('case-open');
  });

  it('records a resume as its own audit event, not a creation', async () => {
    // Six CREATED rows for one case would misrepresent a flaky connection as
    // six attempts to be verified.
    const h = build({ cases: [open] });
    await h.service.createOrResume(USER, {});
    expect(h.auditRecord.mock.calls[0][0].type).toBe('VERIFICATION_CASE_RESUMED');
  });

  it('refuses to reopen a verified provider', async () => {
    const h = build({
      cases: [{ id: 'c-v', state: 'VERIFIED', createdAt: new Date(), idempotencyKey: null }],
    });
    await expect(h.service.createOrResume(USER, {})).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    expect(h.caseCreate).not.toHaveBeenCalled();
  });

  it('fails closed on corrupt history rather than picking a case', async () => {
    const h = build({
      cases: [
        { id: 'a', state: 'SUBMITTED', createdAt: new Date(), idempotencyKey: null },
        { id: 'b', state: 'IN_REVIEW', createdAt: new Date(), idempotencyKey: null },
      ],
    });
    await expect(h.service.createOrResume(USER, {})).rejects.toMatchObject({ status: 409 });
  });
});

describe('concurrency', () => {
  it('translates the one-open-case violation into a CONFLICT', async () => {
    // decideCaseCreation loses the race — both requests read "no open case".
    // The partial unique index arbitrates, and its P2002 must surface as the
    // same stable error a sequential duplicate would produce.
    const h = build({
      createImpl: async () => {
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['verification_case_one_active_per_provider_uniq'] },
        });
      },
    });
    const err = await h.service.createOrResume(USER, {}).catch((e) => e);
    expect(err).toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(String(err.message)).not.toContain('P2002');
  });

  it('translates an idempotency-key collision into a CONFLICT too', async () => {
    const h = build({
      createImpl: async () => {
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['providerProfileId', 'idempotencyKey'] },
        });
      },
    });
    await expect(h.service.createOrResume(USER, { idempotencyKey: 'k-1' })).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
  });
});

describe('current', () => {
  it('returns null when the provider has never started', async () => {
    const h = build({ cases: [] });
    await expect(h.service.current(USER)).resolves.toMatchObject({ case: null });
  });

  it('returns the open case when there is one', async () => {
    const h = build({
      cases: [{ id: 'c-1', state: 'ACTION_REQUIRED', createdAt: new Date(), idempotencyKey: null }],
    });
    const out = await h.service.current(USER);
    expect(out.case).toMatchObject({ id: 'c-1', state: 'ACTION_REQUIRED' });
  });

  it('returns the most recent closed case when none is open', async () => {
    const older = {
      id: 'old',
      state: 'REJECTED',
      createdAt: new Date('2026-01-01'),
      idempotencyKey: null,
    };
    const newer = {
      id: 'new',
      state: 'EXPIRED',
      createdAt: new Date('2026-06-01'),
      idempotencyKey: null,
    };
    const h = build({ cases: [older, newer] });
    const out = await h.service.current(USER);
    expect(out.case?.id).toBe('new');
  });
});
