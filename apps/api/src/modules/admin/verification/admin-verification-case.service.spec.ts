import { AdminVerificationCaseService } from './admin-verification-case.service';

const owner = 'owner-1';
const reviewer = 'reviewer-1';
const now = new Date('2026-09-15T12:00:00Z');
const allPermissions = ['verification:decide', 'verification:evidence:view'];

function caseRow() {
  return {
    id: 'case-1',
    providerProfileId: 'provider-1',
    state: 'SUBMITTED' as const,
    policyVersion: 'policy-v1',
    country: 'ZZ',
    providerType: 'INDIVIDUAL' as const,
    submittedAt: now,
    assignedToUserId: null,
    assignedAt: null,
    decidedAt: null,
    requirementsSnapshot: {
      policyVersion: 'policy-v1',
      verificationRequired: true,
      requirements: [{ kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null }],
    },
    documents: [
      {
        id: 'document-1',
        kind: 'INDIVIDUAL_IDENTITY' as const,
        serviceCategoryId: null,
        category: null,
        supersededAt: null as Date | null,
        expiresOn: null as Date | null,
        uploadedAt: now,
        mediaAsset: {
          detectedMimeType: 'image/png',
          originalFilename: null,
          sizeBytes: 2048,
          scanState: 'CLEAN',
          visibility: 'RESTRICTED',
          uploadCompletedAt: now as Date | null,
          deletedAt: null as Date | null,
          erasureStartedAt: null as Date | null,
          retainUntil: null as Date | null,
        },
      },
    ],
    decisions: [],
    providerProfile: { workAccessGrants: [] },
  };
}

function harness(row = caseRow(), permissionKeys = allPermissions) {
  const client = {
    providerProfile: {
      findFirst: jest.fn().mockResolvedValue({ id: 'provider-1', userId: owner }),
    },
    verificationCase: {
      findFirst: jest.fn().mockResolvedValue(row),
      findUnique: jest.fn().mockResolvedValue({
        providerProfile: { id: 'provider-1', userId: owner, deletedAt: null },
      }),
    },
  };
  const resolveFreshForUser = jest.fn().mockResolvedValue(new Set(permissionKeys));
  const service = new AdminVerificationCaseService(
    { client } as never,
    { resolveFreshForUser } as never,
  );
  return { service, client, resolveFreshForUser };
}

describe('admin identity case projection', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());

  it('offers a scanned current document and approval to a permitted reviewer', async () => {
    const h = harness();
    const view = await h.service.forProvider('provider-1', reviewer);
    expect(view?.documents[0].viewable).toBe(true);
    expect(view?.availableActions).toContain('approve');
    expect(h.resolveFreshForUser).toHaveBeenCalledWith(reviewer, undefined);
    const select = h.client.verificationCase.findFirst.mock.calls[0][0].select;
    expect(select.documents.select.mediaAsset.select).not.toHaveProperty('storageKey');
    expect(JSON.stringify(view)).not.toMatch(/storageKey|signedUrl|sha256/);
  });

  it('uses fresh permissions for specific-case reads as well as provider reads', async () => {
    const h = harness();
    const first = await h.service.forCase('case-1', reviewer);
    expect(first?.documents[0].viewable).toBe(true);
    h.resolveFreshForUser.mockResolvedValue(new Set(['verification:decide']));
    const afterRevocation = await h.service.forCase('case-1', reviewer);
    expect(afterRevocation?.documents[0].viewable).toBe(false);
    expect(afterRevocation?.availableActions).not.toContain('approve');
    // The reviewer can still send unreadable evidence back for replacement.
    expect(afterRevocation?.availableActions).toContain('requestAction');
    expect(afterRevocation?.availableActions).toContain('reject');
  });

  it('permits evidence-only reviewers to read without granting decision authority', async () => {
    const h = harness(caseRow(), ['verification:evidence:view']);
    const view = await h.service.forProvider('provider-1', reviewer);
    expect(view?.documents[0].viewable).toBe(true);
    expect(view?.availableActions).toEqual([]);
  });

  it('lets the subject read their own evidence but never self-review', async () => {
    const h = harness();
    const view = await h.service.forProvider('provider-1', owner);
    expect(view?.documents[0].viewable).toBe(true);
    expect(view?.availableActions).toEqual([]);
    expect(view?.blockedReason).toBe('SELF_REVIEW');
  });

  it.each(['PENDING', 'SCAN_FAILED', 'QUARANTINED', 'REJECTED'])(
    'withholds %s evidence and approval while still offering corrections',
    async (scanState) => {
      const row = caseRow();
      row.documents[0].mediaAsset.scanState = scanState;
      const view = await harness(row).service.forProvider('provider-1', reviewer);
      expect(view?.documents[0].viewable).toBe(false);
      expect(view?.availableActions).not.toContain('approve');
      expect(view?.availableActions).toContain('requestAction');
    },
  );

  it.each(['PUBLIC', 'PRIVATE'])(
    'does not mark %s assets as identity-readable',
    async (visibility) => {
      const row = caseRow();
      row.documents[0].mediaAsset.visibility = visibility;
      const view = await harness(row).service.forProvider('provider-1', reviewer);
      expect(view?.documents[0].viewable).toBe(false);
      expect(view?.availableActions).not.toContain('approve');
    },
  );

  it.each(['EXPIRED', 'ERASING', 'ERASED'] as const)(
    'reports %s retention as unavailable rather than an actionable clean upload',
    async (retentionState) => {
      const row = caseRow();
      const asset = row.documents[0].mediaAsset;
      if (retentionState === 'EXPIRED') asset.retainUntil = now;
      if (retentionState === 'ERASING') asset.erasureStartedAt = now;
      if (retentionState === 'ERASED') asset.deletedAt = now;
      const view = await harness(row).service.forProvider('provider-1', reviewer);
      expect(view?.documents[0]).toMatchObject({
        scanState: 'CLEAN',
        retentionState,
        viewable: false,
      });
      expect(view?.availableActions).not.toContain('approve');
    },
  );

  it.each(['replaced', 'expired', 'incomplete'])(
    'does not count %s evidence toward approval even while clean bytes remain readable',
    async (condition) => {
      const row = caseRow();
      if (condition === 'replaced') row.documents[0].supersededAt = now;
      if (condition === 'expired') row.documents[0].expiresOn = now;
      if (condition === 'incomplete') row.documents[0].mediaAsset.uploadCompletedAt = null;
      const view = await harness(row).service.forProvider('provider-1', reviewer);
      expect(view?.availableActions).not.toContain('approve');
    },
  );

  it('uses the read transaction when resolving sensitive permissions', async () => {
    const h = harness();
    await h.service.forProvider('provider-1', reviewer, h.client as never);
    expect(h.resolveFreshForUser).toHaveBeenCalledWith(reviewer, h.client);
  });

  it('fails approval closed on a missing or mismatched pinned policy snapshot', async () => {
    const row = caseRow();
    row.requirementsSnapshot.policyVersion = 'different-policy';
    expect(
      (await harness(row).service.forProvider('provider-1', reviewer))?.availableActions,
    ).not.toContain('approve');
  });
});
