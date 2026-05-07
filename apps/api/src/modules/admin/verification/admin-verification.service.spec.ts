import type {
  AuditEvent,
  ProviderProfile,
  ProviderProfileStatus,
} from '@homeservicemarketplace/database';

import type { AuditEventRepository } from '../../../infrastructure/persistence/iam/audit-event.repository';
import type { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { AdminAuditService } from '../admin-audit.service';
import { AdminVerificationService } from './admin-verification.service';

const tx: TransactionRunner = {
  run: <T>(fn: (t: undefined) => Promise<T>) => fn(undefined),
} as unknown as TransactionRunner;

function makeProfile(over: Partial<ProviderProfile> = {}): ProviderProfile & {
  user: { id: string; email: string } | null;
} {
  return {
    id: 'pp-1',
    userId: 'user-prov-1',
    displayName: 'Ada L.',
    initials: 'AL',
    avatarUrl: null,
    ratingAvg: 0,
    reviewCount: 0,
    completedJobs: 0,
    verified: false,
    topPro: false,
    bio: null,
    headline: null,
    phoneNumber: null,
    serviceAreaCity: null,
    serviceAreaCountry: null,
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: null,
    availability: 'OFFLINE',
    status: 'PENDING_REVIEW',
    createdAt: new Date('2026-04-30T00:00:00Z'),
    updatedAt: new Date('2026-04-30T00:00:00Z'),
    deletedAt: null,
    ...over,
    user: { id: 'user-prov-1', email: 'p@example.com' },
  } as unknown as ProviderProfile & { user: { id: string; email: string } | null };
}

interface Mocks {
  providers: ProviderProfileRepository;
  notifications: NotificationsService;
  audit: AdminAuditService;
  auditEvents: AuditEventRepository;
}

function makeMocks(
  profile: ReturnType<typeof makeProfile> | null,
  auditRows: AuditEvent[] = [],
): Mocks {
  const reloaded = profile ? { ...profile, status: 'ACTIVE' as ProviderProfileStatus } : null;
  let call = 0;
  return {
    providers: {
      findByIdForAdmin: jest.fn().mockImplementation(() => {
        call += 1;
        return Promise.resolve(call === 1 ? profile : reloaded);
      }),
      listForAdmin: jest.fn().mockResolvedValue(profile ? [profile] : []),
      updateStatusById: jest.fn().mockResolvedValue(profile),
      updateReviewNotesById: jest
        .fn()
        .mockImplementation((_id, notes) =>
          Promise.resolve(profile ? { ...profile, reviewNotes: notes } : null),
        ),
    } as unknown as ProviderProfileRepository,
    notifications: {
      createForUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService,
    audit: {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AdminAuditService,
    auditEvents: {
      listForProviderProfile: jest.fn().mockResolvedValue(auditRows),
    } as unknown as AuditEventRepository,
  };
}

function makeService(m: Mocks): AdminVerificationService {
  return new AdminVerificationService(m.providers, m.notifications, m.audit, m.auditEvents, tx);
}

describe('AdminVerificationService', () => {
  it('approve: PENDING_REVIEW → ACTIVE writes audit + notifies provider', async () => {
    const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
    await makeService(m).approve('admin-1', 'pp-1', 'looks good');
    expect(m.providers.updateStatusById).toHaveBeenCalledWith('pp-1', 'ACTIVE', undefined);
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ADMIN_PROVIDER_APPROVED' }),
      undefined,
    );
    expect(m.notifications.createForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-prov-1' }),
      undefined,
    );
  });

  it('approve: 409 if already ACTIVE', async () => {
    const m = makeMocks(makeProfile({ status: 'ACTIVE' }));
    await expect(makeService(m).approve('admin-1', 'pp-1', null)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('reject: writes ADMIN_PROVIDER_REJECTED audit', async () => {
    const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
    await makeService(m).reject('admin-1', 'pp-1', 'incomplete docs');
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADMIN_PROVIDER_REJECTED',
        metadata: expect.objectContaining({ reason: 'incomplete docs' }),
      }),
      undefined,
    );
  });

  it('reject: 409 if already REJECTED', async () => {
    const m = makeMocks(makeProfile({ status: 'REJECTED' }));
    await expect(makeService(m).reject('admin-1', 'pp-1', 'x')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('suspend: only ACTIVE providers may be suspended', async () => {
    const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
    await expect(makeService(m).suspend('admin-1', 'pp-1', 'misuse')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('suspend: ACTIVE → SUSPENDED writes audit', async () => {
    const m = makeMocks(makeProfile({ status: 'ACTIVE' }));
    await makeService(m).suspend('admin-1', 'pp-1', 'misuse');
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADMIN_PROVIDER_SUSPENDED',
        metadata: expect.objectContaining({ reason: 'misuse' }),
      }),
      undefined,
    );
  });

  it('suspend: empty reason omits metadata.reason and uses generic notification (Sprint 5.1.4)', async () => {
    const m = makeMocks(makeProfile({ status: 'ACTIVE' }));
    await makeService(m).suspend('admin-1', 'pp-1', undefined);
    const auditCall = (m.audit.record as jest.Mock).mock.calls[0][0];
    expect(auditCall.metadata).not.toHaveProperty('reason');
    const notifyCall = (m.notifications.createForUser as jest.Mock).mock.calls[0][0];
    expect(notifyCall.body).toBe('Your provider account was suspended.');
  });

  it('reject: empty reason omits metadata.reason and uses generic notification (Sprint 5.1.4)', async () => {
    const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
    await makeService(m).reject('admin-1', 'pp-1', undefined);
    const auditCall = (m.audit.record as jest.Mock).mock.calls[0][0];
    expect(auditCall.metadata).not.toHaveProperty('reason');
    const notifyCall = (m.notifications.createForUser as jest.Mock).mock.calls[0][0];
    expect(notifyCall.body).toBe('Your provider application was rejected.');
  });

  it('reactivate: SUSPENDED → ACTIVE writes audit + notifies (Sprint 5.1.4)', async () => {
    const m = makeMocks(makeProfile({ status: 'SUSPENDED' }));
    await makeService(m).reactivate('admin-1', 'pp-1');
    expect(m.providers.updateStatusById).toHaveBeenCalledWith('pp-1', 'ACTIVE', undefined);
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADMIN_PROVIDER_APPROVED',
        metadata: expect.objectContaining({
          reactivate: true,
          previousStatus: 'SUSPENDED',
          newStatus: 'ACTIVE',
        }),
      }),
      undefined,
    );
    expect(m.notifications.createForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-prov-1',
        title: 'Provider account reactivated',
      }),
      undefined,
    );
  });

  it('reactivate: 409 if not currently SUSPENDED', async () => {
    const m = makeMocks(makeProfile({ status: 'ACTIVE' }));
    await expect(makeService(m).reactivate('admin-1', 'pp-1')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('reactivate: 404 if profile is missing', async () => {
    const m = makeMocks(null);
    await expect(makeService(m).reactivate('admin-1', 'pp-missing')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('list returns admin summary including userId + email', async () => {
    const m = makeMocks(makeProfile());
    const out = await makeService(m).list({});
    expect(out.items[0]).toMatchObject({
      id: 'pp-1',
      userId: 'user-prov-1',
      email: 'p@example.com',
    });
  });

  it('detail returns 404 when missing', async () => {
    const m = makeMocks(null);
    await expect(makeService(m).detail('pp-missing')).rejects.toMatchObject({ status: 404 });
  });

  // ── Sprint 6.2 — review notes ──────────────────────────────────

  describe('updateReviewNotes', () => {
    it('persists notes + writes ADMIN_PROVIDER_NOTES_UPDATED audit', async () => {
      const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
      await makeService(m).updateReviewNotes('admin-1', 'pp-1', 'Suspicious documents');
      expect(m.providers.updateReviewNotesById).toHaveBeenCalledWith(
        'pp-1',
        'Suspicious documents',
        undefined,
      );
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          adminUserId: 'admin-1',
          type: 'ADMIN_PROVIDER_NOTES_UPDATED',
          metadata: expect.objectContaining({
            providerProfileId: 'pp-1',
            previousNotesLength: 0,
            newNotesLength: 20,
          }),
        }),
        undefined,
      );
    });

    it('does NOT fan out a user-facing notification (admin-private)', async () => {
      const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
      await makeService(m).updateReviewNotes('admin-1', 'pp-1', 'note');
      expect(m.notifications.createForUser).not.toHaveBeenCalled();
    });

    it('skips the DB write when notes are unchanged (idempotent), still audits', async () => {
      const m = makeMocks(
        makeProfile({ status: 'PENDING_REVIEW' }) as unknown as ProviderProfile & {
          user: { id: string; email: string } | null;
          reviewNotes: string;
        },
      );
      // Patch the makeProfile result to have an existing note string
      // by intercepting findByIdForAdmin's first return.
      (m.providers.findByIdForAdmin as jest.Mock).mockReset();
      (m.providers.findByIdForAdmin as jest.Mock).mockResolvedValue({
        ...makeProfile({ status: 'PENDING_REVIEW' }),
        reviewNotes: 'same',
      });
      await makeService(m).updateReviewNotes('admin-1', 'pp-1', 'same');
      expect(m.providers.updateReviewNotesById).not.toHaveBeenCalled();
      expect(m.audit.record).toHaveBeenCalled();
    });

    it('returns 404 when the provider profile is missing', async () => {
      const m = makeMocks(null);
      await expect(
        makeService(m).updateReviewNotes('admin-1', 'pp-missing', 'x'),
      ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });
  });

  describe('getAuditHistory', () => {
    it('queries the repo with the providerProfileId + cursor pagination', async () => {
      const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
      await makeService(m).getAuditHistory('pp-1', { limit: 25 });
      expect(m.auditEvents.listForProviderProfile).toHaveBeenCalledWith(
        expect.objectContaining({ providerProfileId: 'pp-1', take: 26 }),
      );
    });

    it('projects audit rows to the contract shape', async () => {
      const auditRow = {
        id: 'ae-1',
        userId: 'admin-1',
        type: 'ADMIN_PROVIDER_APPROVED',
        metadata: { providerProfileId: 'pp-1', previousStatus: 'PENDING_REVIEW' },
        ipAddress: null,
        userAgent: null,
        requestId: null,
        createdAt: new Date('2026-05-02T00:00:00Z'),
      } as unknown as AuditEvent;
      const m = makeMocks(makeProfile({ status: 'ACTIVE' }), [auditRow]);
      const out = await makeService(m).getAuditHistory('pp-1', {});
      expect(out.items).toHaveLength(1);
      expect(out.items[0]).toMatchObject({
        id: 'ae-1',
        type: 'ADMIN_PROVIDER_APPROVED',
        adminUserId: 'admin-1',
      });
    });

    it('emits nextCursor when the page overflows', async () => {
      const rows = ['a', 'b', 'c'].map(
        (id) =>
          ({
            id,
            userId: 'admin-1',
            type: 'ADMIN_PROVIDER_APPROVED',
            metadata: {},
            ipAddress: null,
            userAgent: null,
            requestId: null,
            createdAt: new Date('2026-05-02T00:00:00Z'),
          }) as unknown as AuditEvent,
      );
      const m = makeMocks(makeProfile(), rows);
      const out = await makeService(m).getAuditHistory('pp-1', { limit: 2 });
      expect(out.items.map((i) => i.id)).toEqual(['a', 'b']);
      expect(out.nextCursor).toBe('b');
    });

    it('returns 404 when the provider profile is missing (no IDOR cover)', async () => {
      const m = makeMocks(null);
      await expect(makeService(m).getAuditHistory('pp-missing', {})).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});
