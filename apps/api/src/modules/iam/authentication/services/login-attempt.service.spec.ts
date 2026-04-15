// Unit tests for LoginAttemptService — the lockout primitive. Mocks Prisma at
// the client boundary (user.update) since this service mutates the User row
// directly for atomicity with other login operations inside a shared tx.

import type { AppConfigService } from '../../../../config/app-config.service';
import type { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { LoginAttemptService } from './login-attempt.service';

function makeConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  const values: Record<string, unknown> = {
    AUTH_LOCKOUT_THRESHOLD: 5,
    AUTH_LOCKOUT_MINUTES: 15,
    ...overrides,
  };
  return { get: (k: string) => values[k] } as unknown as AppConfigService;
}

function makeHarness() {
  const update = jest.fn();
  const prisma = { client: { user: { update } } } as unknown as PrismaService;
  const svc = new LoginAttemptService(prisma, makeConfig());
  return { svc, update };
}

describe('LoginAttemptService', () => {
  describe('isLocked', () => {
    it('returns false when lockedUntil is null', () => {
      const h = makeHarness();
      expect(h.svc.isLocked({ lockedUntil: null })).toBe(false);
    });
    it('returns true when lockedUntil is in the future', () => {
      const h = makeHarness();
      expect(h.svc.isLocked({ lockedUntil: new Date(Date.now() + 60_000) })).toBe(true);
    });
    it('returns false when lockedUntil is in the past — lock has elapsed', () => {
      const h = makeHarness();
      expect(h.svc.isLocked({ lockedUntil: new Date(Date.now() - 60_000) })).toBe(false);
    });
  });

  describe('recordSuccess', () => {
    it('zeroes failedLoginCount and clears lockedUntil', async () => {
      const h = makeHarness();
      await h.svc.recordSuccess('user-1');
      expect(h.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    });
  });

  describe('recordFailure', () => {
    it('increments the counter and returns locked=false below the threshold', async () => {
      const h = makeHarness();
      h.update.mockResolvedValueOnce({ failedLoginCount: 3 });
      await expect(h.svc.recordFailure('user-1')).resolves.toEqual({ locked: false });
      expect(h.update).toHaveBeenCalledTimes(1);
    });

    it('flips lockedUntil once the counter reaches the threshold', async () => {
      const h = makeHarness();
      h.update.mockResolvedValueOnce({ failedLoginCount: 5 });
      const before = Date.now();
      await expect(h.svc.recordFailure('user-1')).resolves.toEqual({ locked: true });
      expect(h.update).toHaveBeenCalledTimes(2);
      const lockCall = h.update.mock.calls[1]![0] as {
        data: { lockedUntil: Date };
      };
      const elapsed = lockCall.data.lockedUntil.getTime() - before;
      expect(elapsed).toBeGreaterThan(15 * 60 * 1000 - 2_000);
      expect(elapsed).toBeLessThan(15 * 60 * 1000 + 2_000);
    });

    it('lockout threshold is driven by config, not hardcoded', async () => {
      const { svc, update } = (() => {
        const u = jest.fn();
        const prisma = { client: { user: { update: u } } } as unknown as PrismaService;
        return {
          svc: new LoginAttemptService(prisma, makeConfig({ AUTH_LOCKOUT_THRESHOLD: 3 })),
          update: u,
        };
      })();
      update.mockResolvedValueOnce({ failedLoginCount: 3 });
      await expect(svc.recordFailure('u')).resolves.toEqual({ locked: true });
    });
  });
});
