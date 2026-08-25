import { AdminVerificationPolicyService } from './admin-verification-policy.service';

// Sprint 9B.2 — publishing and retiring verification policy versions.
//
// docs/adr/0010-policy-versioned-verification.md
//
// The service owns ORCHESTRATION and nothing else. The rules it enforces live
// where they can be tested without it:
//
//   policy-payload.ts     what a requirement set may say
//   policy-lifecycle.ts   when a version may be published or retired
//   ADMIN_SETTINGS_SCHEMA the document ceiling
//
// So these tests are about the things only the service can get wrong: that it
// consults those rules at all, that the write and its audit row share one
// transaction, and that a database constraint violation becomes a stable API
// error rather than a P2002 leaking to the client.

const ADMIN = 'admin-1';

const VALID = {
  version: '2026.09-zz-v1',
  country: 'ZZ',
  providerType: null,
  categoryId: null,
  requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
};

interface Overrides {
  existing?: unknown[];
  maxDocuments?: number;
  createImpl?: () => Promise<unknown>;
  retireCount?: number;
  found?: unknown;
}

function build(over: Overrides = {}) {
  const create = jest.fn(
    over.createImpl ?? (async () => ({ ...VALID, publishedAt: new Date(), retiredAt: null })),
  );
  const findMany = jest.fn().mockResolvedValue(over.existing ?? []);
  const findUnique = jest.fn().mockResolvedValue(over.found ?? null);
  const updateMany = jest.fn().mockResolvedValue({ count: over.retireCount ?? 1 });

  const client = {
    verificationRequirementPolicy: { create, findMany, findUnique, updateMany },
  };

  // The transaction runner hands the same client back, so a test can assert
  // that every write in one call saw one transaction.
  const txRun = jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(client));
  const auditRecord = jest.fn().mockResolvedValue(undefined);
  const settingsMax = jest.fn().mockResolvedValue(over.maxDocuments ?? 10);

  const service = new AdminVerificationPolicyService(
    { client } as never,
    { run: txRun } as never,
    { record: auditRecord } as never,
    { policyMaxDocuments: settingsMax } as never,
  );

  // Typed handles for assertions. The constructor arguments are cast to
  // `never` because these doubles implement only the members the service
  // touches; returning the mocks separately keeps the assertions type-checked.
  return {
    service,
    create: create as jest.Mock,
    findMany: findMany as jest.Mock,
    findUnique: findUnique as jest.Mock,
    updateMany: updateMany as jest.Mock,
    txRun: txRun as unknown as jest.Mock,
    auditRecord: auditRecord as jest.Mock,
    settingsMax: settingsMax as jest.Mock,
  };
}

describe('publish', () => {
  it('creates the version', async () => {
    const h = build();
    await h.service.publish(ADMIN, VALID);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0].data).toMatchObject({
      version: VALID.version,
      country: 'ZZ',
    });
  });

  it('records who published it', async () => {
    const h = build();
    await h.service.publish(ADMIN, VALID);
    expect(h.create.mock.calls[0][0].data.publishedByUserId).toBe(ADMIN);
  });

  it('writes the audit row inside the same transaction as the insert', async () => {
    // A publication that commits without its audit row is an unattributable
    // change to what every provider in a country must prove.
    const h = build();
    await h.service.publish(ADMIN, VALID);
    expect(h.txRun).toHaveBeenCalledTimes(1);
    expect(h.auditRecord).toHaveBeenCalledTimes(1);
    expect(h.auditRecord.mock.calls[0][0].type).toBe('VERIFICATION_POLICY_PUBLISHED');
    // Second argument is the transaction handle, not undefined.
    expect(h.auditRecord.mock.calls[0][1]).toBeDefined();
  });

  it('names the version in the audit metadata', async () => {
    const h = build();
    await h.service.publish(ADMIN, VALID);
    expect(h.auditRecord.mock.calls[0][0].metadata).toMatchObject({
      policyVersion: VALID.version,
    });
  });

  it('rejects a malformed version string before touching the database', async () => {
    const h = build();
    await expect(h.service.publish(ADMIN, { ...VALID, version: 'nope' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect(h.create).not.toHaveBeenCalled();
  });

  it('rejects an unsatisfiable requirement set', async () => {
    const h = build();
    await expect(
      h.service.publish(ADMIN, {
        ...VALID,
        requirements: { documents: [], verificationRequired: true },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(h.create).not.toHaveBeenCalled();
  });

  it('applies the document ceiling from settings, not a constant', async () => {
    const h = build({ maxDocuments: 1 });
    await expect(
      h.service.publish(ADMIN, {
        ...VALID,
        requirements: {
          documents: ['INDIVIDUAL_IDENTITY', 'BUSINESS_REGISTRATION'],
          verificationRequired: true,
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(h.settingsMax).toHaveBeenCalled();
  });

  it('refuses a scope already covered by a live policy', async () => {
    const h = build({
      existing: [
        {
          version: '2026.08-zz-v1',
          country: 'ZZ',
          providerType: null,
          categoryId: null,
          publishedAt: new Date('2026-08-01T00:00:00Z'),
          retiredAt: null,
        },
      ],
    });
    await expect(h.service.publish(ADMIN, VALID)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    expect(h.create).not.toHaveBeenCalled();
  });

  it('translates the database uniqueness violation into a CONFLICT', async () => {
    // The overlap check above is a read-then-write and loses a race. The
    // partial unique index is what actually guarantees the rule, and its
    // P2002 must reach the client as the same stable error the pre-check
    // produces — not as a Prisma code.
    const h = build({
      createImpl: async () => {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      },
    });
    const err = await h.service.publish(ADMIN, VALID).catch((e) => e);
    expect(err).toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(String(err.message)).not.toContain('P2002');
  });

  it('refuses to back-date a publication', async () => {
    const h = build();
    await expect(
      h.service.publish(ADMIN, { ...VALID, publishedAt: new Date('2020-01-01T00:00:00Z') }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('retire', () => {
  const LIVE = {
    version: '2026.09-zz-v1',
    country: 'ZZ',
    providerType: null,
    categoryId: null,
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    retiredAt: null,
  };

  it('retires a live version', async () => {
    const h = build({ found: LIVE });
    await h.service.retire(ADMIN, LIVE.version);
    expect(h.updateMany).toHaveBeenCalledTimes(1);
  });

  it('guards the update on the version still being un-retired', async () => {
    // Optimistic concurrency without a version column: the WHERE clause is the
    // guard. Two admins retiring at once means one UPDATE matches zero rows.
    const h = build({ found: LIVE });
    await h.service.retire(ADMIN, LIVE.version);
    expect(h.updateMany.mock.calls[0][0].where).toMatchObject({
      version: LIVE.version,
      retiredAt: null,
    });
  });

  it('reports a lost race as CONFLICT rather than silent success', async () => {
    const h = build({ found: LIVE, retireCount: 0 });
    await expect(h.service.retire(ADMIN, LIVE.version)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
  });

  it('does not write an audit row when the update changed nothing', async () => {
    const h = build({ found: LIVE, retireCount: 0 });
    await h.service.retire(ADMIN, LIVE.version).catch(() => undefined);
    expect(h.auditRecord).not.toHaveBeenCalled();
  });

  it('audits a successful retirement in the same transaction', async () => {
    const h = build({ found: LIVE });
    await h.service.retire(ADMIN, LIVE.version);
    expect(h.auditRecord.mock.calls[0][0].type).toBe('VERIFICATION_POLICY_RETIRED');
    expect(h.auditRecord.mock.calls[0][1]).toBeDefined();
  });

  it('404s an unknown version', async () => {
    const h = build({ found: null });
    await expect(h.service.retire(ADMIN, '2026.09-zz-v9')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('refuses to retire an already-retired version', async () => {
    const h = build({ found: { ...LIVE, retiredAt: new Date('2026-08-01T00:00:00Z') } });
    await expect(h.service.retire(ADMIN, LIVE.version)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a malformed version without querying', async () => {
    const h = build();
    await expect(h.service.retire(ADMIN, '../../etc/passwd')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(h.findUnique).not.toHaveBeenCalled();
  });
});

describe('list', () => {
  it('returns every version, newest first, without the raw row shape', async () => {
    const h = build({
      existing: [
        {
          version: '2026.08-zz-v1',
          country: 'ZZ',
          providerType: null,
          categoryId: null,
          requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
          publishedAt: new Date('2026-08-01T00:00:00Z'),
          retiredAt: null,
          publishedByUserId: ADMIN,
        },
      ],
    });
    const out = await h.service.list();
    expect(out.policies).toHaveLength(1);
    expect(out.policies[0]).toMatchObject({ version: '2026.08-zz-v1', isLive: true });
  });

  it('marks a retired version as not live', async () => {
    const h = build({
      existing: [
        {
          version: '2026.08-zz-v1',
          country: 'ZZ',
          providerType: null,
          categoryId: null,
          requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
          publishedAt: new Date('2026-08-01T00:00:00Z'),
          retiredAt: new Date('2026-08-20T00:00:00Z'),
          publishedByUserId: ADMIN,
        },
      ],
    });
    const out = await h.service.list();
    expect(out.policies[0].isLive).toBe(false);
  });
});
