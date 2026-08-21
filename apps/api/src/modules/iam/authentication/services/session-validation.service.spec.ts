import type { User } from '@homeservicemarketplace/database';

import type { AppConfigService } from '../../../../config/app-config.service';
import type { RedisService } from '../../../../infrastructure/redis/redis.service';
import type { UserRepository } from '../../../../infrastructure/persistence/iam/user.repository';
import { SessionValidationService } from './session-validation.service';

function makeUser(over: Partial<User> = {}): User {
  return {
    id: 'u-1',
    email: 'ada@example.com',
    passwordHash: null,
    firstName: 'Ada',
    lastName: 'Lovelace',
    isActive: true,
    status: 'ACTIVE',
    emailVerifiedAt: new Date('2026-01-02T00:00:00Z'),
    passwordUpdatedAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    mfaEnabled: false,
    mfaEnrolledAt: null,
    mfaSecret: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...over,
  } as User;
}

function mkRedis(state: { store: Map<string, string>; fail?: boolean }) {
  const client = {
    get: jest.fn(async (k: string) => {
      if (state.fail) throw new Error('down');
      return state.store.get(k) ?? null;
    }),
    setex: jest.fn(async (k: string, _ttl: number, v: string) => {
      if (state.fail) throw new Error('down');
      state.store.set(k, v);
      return 'OK';
    }),
    del: jest.fn(async (k: string) => {
      if (state.fail) throw new Error('down');
      state.store.delete(k);
      return 1;
    }),
  };
  return {
    redis: { getClient: () => client } as unknown as RedisService,
    client,
  };
}

function mkUsers(user: User | null) {
  return {
    findById: jest.fn().mockResolvedValue(user),
  } as unknown as UserRepository & { findById: jest.Mock };
}

const config: AppConfigService = {
  get: (k: string) => (k === 'AUTH_SESSION_CACHE_TTL_SECONDS' ? 30 : undefined),
} as unknown as AppConfigService;

const KEY = 'iam:session:standing:u-1';

describe('SessionValidationService', () => {
  it('caches a positive flag on the first DB check and does not hit the DB again', async () => {
    const state = { store: new Map<string, string>() };
    const { redis, client } = mkRedis(state);
    const users = mkUsers(makeUser({ status: 'ACTIVE' }));
    const svc = new SessionValidationService(users, redis, config);

    await expect(svc.assertInGoodStanding('u-1')).resolves.toBeUndefined();
    expect(users.findById).toHaveBeenCalledTimes(1);
    expect(client.setex).toHaveBeenCalledWith(KEY, 30, '1');

    // Second call: cache hit → no further DB read.
    await expect(svc.assertInGoodStanding('u-1')).resolves.toBeUndefined();
    expect(users.findById).toHaveBeenCalledTimes(1);
  });

  it('trusts a cached positive flag without reading the DB', async () => {
    const state = { store: new Map([[KEY, '1']]) };
    const { redis } = mkRedis(state);
    const users = mkUsers(makeUser());
    const svc = new SessionValidationService(users, redis, config);

    await expect(svc.assertInGoodStanding('u-1')).resolves.toBeUndefined();
    expect(users.findById).not.toHaveBeenCalled();
  });

  it.each([
    ['SUSPENDED', makeUser({ status: 'SUSPENDED' })],
    ['LOCKED', makeUser({ status: 'LOCKED' })],
    ['DELETED status', makeUser({ status: 'DELETED' })],
    ['soft-deleted', makeUser({ deletedAt: new Date() })],
    ['inactive', makeUser({ isActive: false })],
    ['missing', null],
  ])('rejects a %s account and does NOT cache it', async (_label, user) => {
    const state = { store: new Map<string, string>() };
    const { redis, client } = mkRedis(state);
    const users = mkUsers(user);
    const svc = new SessionValidationService(users, redis, config);

    await expect(svc.assertInGoodStanding('u-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTH_INVALID_CREDENTIALS' }),
    });
    // Never cached — a bad account is re-checked against the DB every time.
    expect(client.setex).not.toHaveBeenCalled();
    expect(state.store.has(KEY)).toBe(false);
  });

  it('re-checks the DB every request for a bad account (no negative caching)', async () => {
    const state = { store: new Map<string, string>() };
    const { redis } = mkRedis(state);
    const users = mkUsers(makeUser({ status: 'SUSPENDED' }));
    const svc = new SessionValidationService(users, redis, config);

    await expect(svc.assertInGoodStanding('u-1')).rejects.toBeDefined();
    await expect(svc.assertInGoodStanding('u-1')).rejects.toBeDefined();
    expect(users.findById).toHaveBeenCalledTimes(2);
  });

  it('falls through to the DB (enforcing) when Redis is down, never fails open', async () => {
    const state = { store: new Map<string, string>(), fail: true };
    const { redis } = mkRedis(state);
    const good = mkUsers(makeUser({ status: 'ACTIVE' }));
    const svcGood = new SessionValidationService(good, redis, config);
    await expect(svcGood.assertInGoodStanding('u-1')).resolves.toBeUndefined();
    expect(good.findById).toHaveBeenCalledTimes(1);

    const bad = mkUsers(makeUser({ status: 'SUSPENDED' }));
    const svcBad = new SessionValidationService(bad, redis, config);
    await expect(svcBad.assertInGoodStanding('u-1')).rejects.toBeDefined();
  });

  it('invalidate() deletes the cached flag so the next request re-checks', async () => {
    const state = { store: new Map([[KEY, '1']]) };
    const { redis, client } = mkRedis(state);
    const users = mkUsers(makeUser({ status: 'SUSPENDED' }));
    const svc = new SessionValidationService(users, redis, config);

    await svc.invalidate('u-1');
    expect(client.del).toHaveBeenCalledWith(KEY);
    expect(state.store.has(KEY)).toBe(false);

    // With the positive flag gone, the now-suspended user is rejected.
    await expect(svc.assertInGoodStanding('u-1')).rejects.toBeDefined();
  });

  it('invalidate() never throws when Redis is down', async () => {
    const state = { store: new Map<string, string>(), fail: true };
    const { redis } = mkRedis(state);
    const users = mkUsers(makeUser());
    const svc = new SessionValidationService(users, redis, config);
    await expect(svc.invalidate('u-1')).resolves.toBeUndefined();
  });
});
