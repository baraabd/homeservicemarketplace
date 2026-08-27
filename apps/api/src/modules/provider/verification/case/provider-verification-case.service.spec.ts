import type { ProviderVerificationCase } from '@homeservicemarketplace/contracts';

import {
  ProviderVerificationCaseService,
  unwrapSnapshot,
  type ProviderCaseView,
} from './provider-verification-case.service';

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

// ── Sprint 9B.13 — the stored snapshot versus the published response ──────
//
// The case row keeps the resolution VERBATIM:
//
//   { requirements: [...], policyVersion, verificationRequired }
//
// because a reviewer's checklist and any later replay must not depend on the
// policy row still existing, or still saying what it said that day. The
// CONTRACT publishes something else — a flat array plus a boolean — and for
// three sprints the API simply handed the snapshot out under the array's name.
//
// Nothing caught it. The controller cast `as unknown as`, so the compiler was
// told not to look; every API test asserted the shape the API produced; and
// the web tests fed themselves contract-shaped fixtures the API never sent.
// The provider screen calls `requirements.filter(...)`, and an object is
// truthy, so its `?? []` guard never fired: the screen threw for every
// provider who had a case.
//
// These tests are about the MAPPER between the two shapes, and in particular
// about what it does with input it cannot trust — the snapshot is JSON on a
// row that may be older than any shape this code knows.

describe('unwrapSnapshot — stored snapshot to published response', () => {
  const snapshot = (over: Record<string, unknown> = {}) => ({
    policyVersion: 'v1',
    verificationRequired: true,
    requirements: [{ kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null, fromVersion: 'v1' }],
    ...over,
  });

  it('flattens the nested list into the contract array', () => {
    const out = unwrapSnapshot(snapshot());
    expect(Array.isArray(out.requirements)).toBe(true);
    expect(out.requirements).toEqual([{ kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null }]);
  });

  it('lifts verificationRequired to the top level as a boolean', () => {
    expect(unwrapSnapshot(snapshot()).verificationRequired).toBe(true);
    expect(unwrapSnapshot(snapshot({ verificationRequired: false })).verificationRequired).toBe(
      false,
    );
  });

  it('drops the snapshot-only bookkeeping, so no nested shape escapes', () => {
    // `fromVersion` traces a checklist row back to the policy that demanded it,
    // which is a reviewer's concern. The provider is told what to send.
    const [first] = unwrapSnapshot(snapshot()).requirements;
    expect(Object.keys(first).sort()).toEqual(['kind', 'serviceCategoryId']);
  });

  it('keeps each kind with its own category across several requirements', () => {
    const out = unwrapSnapshot(
      snapshot({
        requirements: [
          { kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null },
          { kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-plumbing' },
          { kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-electrical' },
        ],
      }),
    );
    expect(out.requirements).toEqual([
      { kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null },
      { kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-plumbing' },
      { kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-electrical' },
    ]);
  });

  it('an empty requirement list stays an empty ARRAY, never null', () => {
    // The client maps over this. `null` would crash it just as the nested
    // object did, for the same reason and with the same stack.
    expect(unwrapSnapshot(snapshot({ requirements: [] })).requirements).toEqual([]);
  });

  describe('snapshots it cannot trust', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an empty object', {}],
      ['a string', 'not-json-we-know'],
      ['a list where an object belongs', [1, 2, 3]],
      ['requirements as an object', { requirements: { kind: 'INDIVIDUAL_IDENTITY' } }],
    ])('%s yields no requirements rather than throwing', (_label, value) => {
      const out = unwrapSnapshot(value as never);
      expect(out.requirements).toEqual([]);
    });

    it('fails CLOSED on verificationRequired when it cannot be read', () => {
      // "We could not parse this" must never be read as "verification does not
      // apply". Only an explicit `false` turns it off.
      expect(unwrapSnapshot(null).verificationRequired).toBe(true);
      expect(unwrapSnapshot({}).verificationRequired).toBe(true);
      expect(unwrapSnapshot(snapshot({ verificationRequired: 'no' })).verificationRequired).toBe(
        true,
      );
    });

    it('DROPS a requirement whose kind is not a contract code', () => {
      // Not coerced to `{ kind: '' }`. A checklist row the client has no label
      // for is a row the provider cannot satisfy and cannot understand, and
      // emitting one would only have been to satisfy the type checker.
      const out = unwrapSnapshot(
        snapshot({
          requirements: [
            { kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null },
            { kind: 'SOMETHING_FROM_A_FUTURE_CATALOGUE', serviceCategoryId: null },
            { serviceCategoryId: 'orphan' },
            null,
          ],
        }),
      );
      expect(out.requirements).toEqual([{ kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null }]);
    });

    it('normalises a non-string category to null rather than passing it through', () => {
      const out = unwrapSnapshot(
        snapshot({
          requirements: [{ kind: 'CATEGORY_LICENSE', serviceCategoryId: 42 }],
        }),
      );
      expect(out.requirements).toEqual([{ kind: 'CATEGORY_LICENSE', serviceCategoryId: null }]);
    });
  });

  it('is the published contract at the type level, so drift stops compiling', () => {
    // `ProviderCaseView` is an ALIAS of `ProviderVerificationCase`, not a
    // lookalike, and the controller no longer casts. This assignment is the
    // assertion: if the mapper's shape ever diverges again, this file fails to
    // build long before anything reaches a browser.
    const view: ProviderCaseView = {
      id: 'c1',
      state: 'DRAFT',
      policyVersion: 'v1',
      createdAt: new Date().toISOString(),
      submittedAt: null,
      verificationRequired: true,
      requirements: unwrapSnapshot(snapshot()).requirements,
      documents: [],
      latestDecision: null,
    };
    const contract: ProviderVerificationCase = view;
    expect(contract.requirements).toHaveLength(1);
  });
});
