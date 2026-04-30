import type { User, UserProfile } from '@homeservicemarketplace/database';

import type { UserRepository } from '../../infrastructure/persistence/iam/user.repository';
import type { UserProfileRepository } from '../../infrastructure/persistence/profiles/user-profile.repository';
import type { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';
import { ProfileService } from './profile.service';

function makeTx(): TransactionRunner {
  return {
    run: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
  } as unknown as TransactionRunner;
}

function makeUser(over: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'ada@example.com',
    passwordHash: null,
    firstName: 'Ada',
    lastName: 'Lovelace',
    isActive: true,
    status: 'ACTIVE',
    emailVerifiedAt: new Date('2026-04-29T00:00:00.000Z'),
    passwordUpdatedAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    mfaEnabled: false,
    mfaSecret: null,
    mfaEnrolledAt: null,
    createdAt: new Date('2026-04-29T00:00:00.000Z'),
    updatedAt: new Date('2026-04-29T00:00:00.000Z'),
    deletedAt: null,
    ...over,
  } as User;
}

function makeProfile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'up-1',
    userId: 'user-1',
    avatarUrl: null,
    phoneNumber: null,
    city: null,
    bio: null,
    createdAt: new Date('2026-04-29T00:00:00.000Z'),
    updatedAt: new Date('2026-04-29T00:00:00.000Z'),
    ...over,
  } as UserProfile;
}

interface Mocks {
  users: { findById: jest.Mock; update: jest.Mock };
  profiles: { findByUserId: jest.Mock; upsertByUserId: jest.Mock };
}

type MocksOverride = { [K in keyof Mocks]?: Partial<Mocks[K]> };

function makeMocks(over: MocksOverride = {}): Mocks {
  return {
    users: {
      findById: jest.fn().mockResolvedValue(makeUser()),
      update: jest.fn().mockImplementation((_id, input) => Promise.resolve(makeUser({ ...input }))),
      ...(over.users ?? {}),
    },
    profiles: {
      findByUserId: jest.fn().mockResolvedValue(makeProfile()),
      upsertByUserId: jest.fn().mockImplementation((input) => Promise.resolve(makeProfile(input))),
      ...(over.profiles ?? {}),
    },
  };
}

function makeService(m: Mocks) {
  return new ProfileService(
    m.users as unknown as UserRepository,
    m.profiles as unknown as UserProfileRepository,
    makeTx(),
  );
}

describe('ProfileService', () => {
  // ─── get ───────────────────────────────────────────────────────────────
  describe('get', () => {
    it('maps User + UserProfile to ProfileSummary (drops infra fields)', async () => {
      const m = makeMocks();
      const out = await makeService(m).get('user-1');
      expect(out.profile.firstName).toBe('Ada');
      expect(out.profile.lastName).toBe('Lovelace');
      expect(out.profile.displayName).toBe('Ada Lovelace');
      expect(out.profile.initials).toBe('AL');
      expect(out.profile.email).toBe('ada@example.com');
      // Wire fields are ISO strings.
      expect(typeof out.profile.updatedAt).toBe('string');
      // Internal fields never leak.
      expect(out.profile).not.toHaveProperty('id');
      expect(out.profile).not.toHaveProperty('userId');
      expect(out.profile).not.toHaveProperty('passwordHash');
    });

    it('returns the profile with all-null editable fields when no UserProfile row exists', async () => {
      const m = makeMocks({
        profiles: { findByUserId: jest.fn().mockResolvedValue(null) },
      });
      const out = await makeService(m).get('user-1');
      expect(out.profile.phoneNumber).toBeNull();
      expect(out.profile.city).toBeNull();
      expect(out.profile.bio).toBeNull();
      expect(out.profile.avatarUrl).toBeNull();
    });

    it('rejects with NOT_FOUND when the user is missing (defence vs. concurrent soft-delete)', async () => {
      const m = makeMocks({ users: { findById: jest.fn().mockResolvedValue(null) } });
      await expect(makeService(m).get('user-bogus')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });
  });

  // ─── update ────────────────────────────────────────────────────────────
  describe('update', () => {
    it('persists firstName/lastName via UserRepository.update', async () => {
      const m = makeMocks();
      await makeService(m).update('user-1', { firstName: 'Grace', lastName: 'Hopper' });
      expect(m.users.update).toHaveBeenCalledWith(
        'user-1',
        { firstName: 'Grace', lastName: 'Hopper' },
        undefined,
      );
    });

    it('persists phoneNumber/city/bio via UserProfileRepository.upsert', async () => {
      const m = makeMocks();
      await makeService(m).update('user-1', {
        phoneNumber: '+1 555 0100',
        city: 'Palo Alto',
        bio: 'Hello',
      });
      expect(m.profiles.upsertByUserId).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          phoneNumber: '+1 555 0100',
          city: 'Palo Alto',
          bio: 'Hello',
        }),
        undefined,
      );
    });

    it('skips the user update when no name fields are sent', async () => {
      const m = makeMocks();
      await makeService(m).update('user-1', { city: 'Palo Alto' });
      expect(m.users.update).not.toHaveBeenCalled();
      expect(m.profiles.upsertByUserId).toHaveBeenCalled();
    });

    it('skips the profile upsert when only name fields are sent', async () => {
      const m = makeMocks();
      await makeService(m).update('user-1', { firstName: 'Grace' });
      expect(m.users.update).toHaveBeenCalled();
      expect(m.profiles.upsertByUserId).not.toHaveBeenCalled();
      // The findByUserId call below is required to hydrate the
      // post-update response without writing.
      expect(m.profiles.findByUserId).toHaveBeenCalled();
    });

    it('returns the post-update ProfileSummary (server-side reconciliation)', async () => {
      const m = makeMocks();
      const out = await makeService(m).update('user-1', {
        firstName: 'Grace',
        lastName: 'Hopper',
        city: 'New York',
      });
      expect(out.profile.firstName).toBe('Grace');
      expect(out.profile.lastName).toBe('Hopper');
      expect(out.profile.displayName).toBe('Grace Hopper');
      expect(out.profile.initials).toBe('GH');
      expect(out.profile.city).toBe('New York');
    });

    it('rejects with NOT_FOUND if the user disappears mid-transaction', async () => {
      const m = makeMocks({
        users: { findById: jest.fn().mockResolvedValue(null), update: jest.fn() },
      });
      await expect(makeService(m).update('user-1', { firstName: 'Grace' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(m.users.update).not.toHaveBeenCalled();
    });

    it('throws AppError on every error path (no raw Prisma errors leak)', async () => {
      const m = makeMocks({
        users: { findById: jest.fn().mockResolvedValue(null), update: jest.fn() },
      });
      await Promise.all([
        expect(makeService(m).get('u')).rejects.toBeInstanceOf(AppError),
        expect(makeService(m).update('u', {})).rejects.toBeInstanceOf(AppError),
      ]);
    });
  });

  // ─── nullable normalization ────────────────────────────────────────────
  it('passes null through to repo so the caller can clear a field', async () => {
    const m = makeMocks();
    await makeService(m).update('user-1', { phoneNumber: null, bio: null });
    expect(m.profiles.upsertByUserId).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: null, bio: null }),
      undefined,
    );
  });
});
