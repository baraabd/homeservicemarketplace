import type { UserProfile } from '@homeservicemarketplace/database';

import { UserProfileRepository } from '../../../infrastructure/persistence/user/user-profile.repository';
import { ProfileService } from './profile.service';

// In-memory repo double. The contract we depend on is just
// findByUserId + upsert; everything else is irrelevant for service-level
// invariant testing. A real Prisma-backed integration lives in the e2e suite.
class FakeProfileRepo {
  rows = new Map<string, UserProfile>();

  async findByUserId(userId: string): Promise<UserProfile | null> {
    return this.rows.get(userId) ?? null;
  }

  async upsert(
    userId: string,
    input: { avatarUrl?: string | null; phoneNumber?: string | null; bio?: string | null },
  ): Promise<UserProfile> {
    const existing = this.rows.get(userId);
    const next: UserProfile = {
      id: existing?.id ?? `prof_${userId}`,
      userId,
      avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : (existing?.avatarUrl ?? null),
      phoneNumber:
        input.phoneNumber !== undefined ? input.phoneNumber : (existing?.phoneNumber ?? null),
      bio: input.bio !== undefined ? input.bio : (existing?.bio ?? null),
      createdAt: existing?.createdAt ?? new Date('2026-04-19T00:00:00Z'),
      updatedAt: new Date('2026-04-19T00:00:00Z'),
    };
    this.rows.set(userId, next);
    return next;
  }
}

describe('ProfileService', () => {
  let repo: FakeProfileRepo;
  let svc: ProfileService;

  beforeEach(() => {
    repo = new FakeProfileRepo();
    svc = new ProfileService(repo as unknown as UserProfileRepository);
  });

  describe('getOrCreate', () => {
    it('lazily creates an empty profile on the first call', async () => {
      const p = await svc.getOrCreate('u1');
      expect(p.userId).toBe('u1');
      expect(p.avatarUrl).toBeNull();
      expect(p.phoneNumber).toBeNull();
      expect(p.bio).toBeNull();
      expect(repo.rows.size).toBe(1);
    });

    it('returns the existing profile on subsequent calls (no duplicate row)', async () => {
      const first = await svc.getOrCreate('u1');
      const second = await svc.getOrCreate('u1');
      expect(second.id).toBe(first.id);
      expect(repo.rows.size).toBe(1);
    });
  });

  describe('update', () => {
    it('upserts fields and leaves untouched fields alone (PATCH semantics)', async () => {
      await svc.getOrCreate('u1');
      await svc.update('u1', { bio: 'hello' });
      const row = await svc.getOrCreate('u1');
      expect(row.bio).toBe('hello');
      expect(row.avatarUrl).toBeNull();
    });

    it('null explicitly clears a field', async () => {
      await svc.update('u1', { bio: 'old' });
      await svc.update('u1', { bio: null });
      const row = await svc.getOrCreate('u1');
      expect(row.bio).toBeNull();
    });

    it('works even if the user has not GET /me yet (upsert, not update)', async () => {
      const row = await svc.update('u1', { phoneNumber: '+1 555 123 4567' });
      expect(row.phoneNumber).toBe('+1 555 123 4567');
    });
  });
});
