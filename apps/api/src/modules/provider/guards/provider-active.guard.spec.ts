import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ProviderProfile } from '@homeservicemarketplace/database';

import type { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { ProviderActiveGuard } from './provider-active.guard';

function makeCtx(user: { id: string } | null): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

function makeProfile(over: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'pp-1',
    userId: 'user-1',
    displayName: 'Ada',
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
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...over,
  } as ProviderProfile;
}

function makeRepo(profile: ProviderProfile | null): ProviderProfileRepository {
  return {
    findByUserId: jest.fn().mockResolvedValue(profile),
  } as unknown as ProviderProfileRepository;
}

describe('ProviderActiveGuard', () => {
  it('allows a request when the provider profile status is ACTIVE', async () => {
    const guard = new ProviderActiveGuard(makeRepo(makeProfile({ status: 'ACTIVE' })));
    await expect(guard.canActivate(makeCtx({ id: 'user-1' }))).resolves.toBe(true);
  });

  it.each(['DRAFT', 'PENDING_REVIEW', 'SUSPENDED', 'REJECTED'] as const)(
    'rejects status %s with FORBIDDEN',
    async (status) => {
      const guard = new ProviderActiveGuard(makeRepo(makeProfile({ status })));
      await expect(guard.canActivate(makeCtx({ id: 'user-1' }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );

  it('rejects when the user has the provider role but no profile row', async () => {
    const guard = new ProviderActiveGuard(makeRepo(null));
    await expect(guard.canActivate(makeCtx({ id: 'user-1' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects unauthenticated requests (defensive — JwtAuthGuard should have run first)', async () => {
    const guard = new ProviderActiveGuard(makeRepo(makeProfile()));
    await expect(guard.canActivate(makeCtx(null))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns the FORBIDDEN code envelope (no raw status leak)', async () => {
    const guard = new ProviderActiveGuard(makeRepo(makeProfile({ status: 'SUSPENDED' })));
    try {
      await guard.canActivate(makeCtx({ id: 'user-1' }));
      throw new Error('expected guard to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as { code?: string };
      expect(response.code).toBe('FORBIDDEN');
    }
  });
});
