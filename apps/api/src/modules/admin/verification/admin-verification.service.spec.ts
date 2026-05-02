import type { ProviderProfile, ProviderProfileStatus } from '@homeservicemarketplace/database';

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
}

function makeMocks(profile: ReturnType<typeof makeProfile> | null): Mocks {
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
    } as unknown as ProviderProfileRepository,
    notifications: {
      createForUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService,
    audit: {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AdminAuditService,
  };
}

function makeService(m: Mocks): AdminVerificationService {
  return new AdminVerificationService(m.providers, m.notifications, m.audit, tx);
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
});
