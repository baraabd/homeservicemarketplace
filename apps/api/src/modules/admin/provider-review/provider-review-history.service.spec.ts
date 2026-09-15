import { AdminProviderReviewHistoryService } from './provider-review-history.service';

function fixture(rights = ['user:read:any', 'verification:decide', 'portfolio:read']) {
  const at = new Date('2026-09-15T12:00:00Z');
  const db = {
    providerProfile: {
      findFirst: jest.fn().mockResolvedValue({ id: 'provider-1', userId: 'owner-1' }),
    },
    auditEvent: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cursor-1', createdAt: at }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    providerOnboardingSubmission: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'submission-1',
          submittedAt: at,
          policyVersion: 'v1',
          reviewedRevision: 'a'.repeat(64),
          decisionNote: 'Internal context',
          reviewFeedback: {
            requestedAt: at.toISOString(),
            items: [
              {
                id: 'f1',
                taskId: 'WORK_AREA',
                field: 'serviceAreaCity',
                reasonCode: 'INFORMATION_INCORRECT',
                providerMessage: 'Confirm the city.',
                secret: 'never-copy',
              },
            ],
          },
        },
      ]),
    },
    serviceCategory: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'category-1', labelEn: 'Cleaning', labelAr: 'تنظيف' }]),
    },
    providerPortfolioItem: {
      findMany: jest.fn().mockResolvedValue([{ id: 'image-1', title: 'Kitchen' }]),
    },
  };
  const permissions = { resolveFreshForUser: jest.fn().mockResolvedValue(new Set(rights)) };
  const service = new AdminProviderReviewHistoryService(
    { client: db } as never,
    permissions as never,
  );
  const event = (id: string, type: string, metadata: Record<string, unknown> = {}) => ({
    id,
    type,
    metadata,
    createdAt: at,
    userId: 'admin-1',
    user: { firstName: 'Admin', lastName: 'Reviewer', deletedAt: null },
  });
  return { db, permissions, service, event, at };
}

describe('provider review history', () => {
  it('distinguishes lifting a suspension from approving an application', async () => {
    const f = fixture();
    f.db.auditEvent.findMany.mockResolvedValue([
      f.event('event-1', 'ADMIN_PROVIDER_APPROVED', {
        reactivate: true,
        previousStatus: 'SUSPENDED',
      }),
    ]);
    const history = await f.service.list('admin', 'provider-1', {});
    expect(history.items[0]).toMatchObject({ kind: 'REACTIVATED', submission: null });
  });
  it('checks fresh read access before any provider or audit query', async () => {
    const f = fixture([]);
    await expect(f.service.list('admin', 'provider-1', {})).rejects.toMatchObject({ status: 403 });
    expect(f.db.providerProfile.findFirst).not.toHaveBeenCalled();
    expect(f.db.auditEvent.findMany).not.toHaveBeenCalled();
  });
  it('rejects a foreign cursor instead of skipping across another provider timeline', async () => {
    const f = fixture();
    f.db.auditEvent.findFirst.mockResolvedValue(null);
    await expect(
      f.service.list('admin', 'provider-1', { cursor: 'foreign' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.db.auditEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            expect.objectContaining({
              OR: expect.arrayContaining([
                { metadata: { path: ['providerProfileId'], equals: 'provider-1' } },
              ]),
            }),
            { id: 'foreign' },
          ],
        },
      }),
    );
    expect(f.db.auditEvent.findMany).not.toHaveBeenCalled();
  });
  it('merges domain events in deterministic pages without inventing submission links', async () => {
    const f = fixture();
    f.db.auditEvent.findMany.mockResolvedValue([
      f.event('event-3', 'ADMIN_PROVIDER_REJECTED', {
        submissionId: 'submission-1',
        reviewAction: 'REQUEST_CHANGES',
        secret: 'must-not-leave',
      }),
      f.event('event-2', 'ADMIN_CATEGORY_APPLICATION_APPROVED', {
        serviceCategoryId: 'category-1',
      }),
      f.event('event-1', 'VERIFICATION_CASE_APPROVED', {
        caseId: 'case-1',
        storageKey: 'must-not-leave',
      }),
    ]);
    const page = await f.service.list('admin', 'provider-1', { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('event-2');
    expect(page.items[0]).toMatchObject({
      kind: 'CHANGES_REQUESTED',
      actor: { displayName: 'Admin Reviewer' },
      submission: { id: 'submission-1', policyVersion: 'v1' },
      privateNote: 'Internal context',
    });
    expect(page.items[1]).toMatchObject({
      kind: 'CATEGORY_APPROVED',
      submission: null,
      subject: { labelAr: 'تنظيف' },
    });
    expect(JSON.stringify(page)).not.toMatch(/must-not-leave|never-copy/);
    expect(f.db.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    );
    expect(f.db.providerOnboardingSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerProfileId: 'provider-1', id: { in: ['submission-1'] } },
      }),
    );
  });
  it('omits private notes and portfolio audit types when permissions are absent', async () => {
    const f = fixture(['user:read:any']);
    f.db.auditEvent.findMany.mockResolvedValue([
      f.event('e1', 'ADMIN_PROVIDER_REJECTED', {
        submissionId: 'submission-1',
        reviewAction: 'REQUEST_CHANGES',
      }),
    ]);
    const page = await f.service.list('admin', 'provider-1', {});
    expect(page.items[0].privateNote).toBeNull();
    const selection = f.db.providerOnboardingSubmission.findMany.mock.calls[0][0];
    expect(selection.select).not.toHaveProperty('decisionNote');
    const query = f.db.auditEvent.findMany.mock.calls[0][0];
    expect(query.where.AND[0].type.in).not.toContain('ADMIN_PORTFOLIO_REJECTED');
  });
  it('uses a strict date/id boundary on later pages and preserves image revisions', async () => {
    const f = fixture();
    f.db.auditEvent.findMany.mockResolvedValue([
      f.event('e1', 'ADMIN_PORTFOLIO_REJECTED', {
        itemId: 'image-1',
        revision: 3,
        reason: 'Please upload your own work.',
      }),
    ]);
    const page = await f.service.list('admin', 'provider-1', { cursor: 'cursor-1' });
    expect(page.items[0]).toMatchObject({
      kind: 'PORTFOLIO_REJECTED',
      contentRevision: 3,
      reason: 'Please upload your own work.',
      submission: null,
    });
    expect(f.db.auditEvent.findMany.mock.calls[0][0].where.AND[1]).toEqual({
      OR: [{ createdAt: { lt: f.at } }, { createdAt: f.at, id: { lt: 'cursor-1' } }],
    });
  });
});
