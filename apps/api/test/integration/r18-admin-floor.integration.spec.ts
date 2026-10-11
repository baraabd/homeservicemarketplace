/* eslint-disable @typescript-eslint/no-require-imports -- Database dependencies load only inside the integration gate. */
import type { PrismaClient, PrismaTx } from '@homeservicemarketplace/database';

import { AdminUsersService } from '../../src/modules/admin/users/admin-users.service';
import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';

const dbDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(120_000);

// R18 (D-8 safety floor) — the last-active-admin refusal and its platform-wide
// lock, against real PostgreSQL. Taking every other administrator out of good
// standing is only safe inside a transaction that is never committed, so each
// case runs in one and rolls it back: no other suite ever sees the change.
// The HTTP route, guards and audit are covered by the R17-D suites; the
// refusal itself is pinned in admin-users.service.spec.ts.
class Rollback extends Error {}

type FloorInternals = {
  lockAdminFloor(tx: PrismaTx): Promise<void>;
  assertNotLastActiveAdmin(targetUserId: string, tx: PrismaTx): Promise<void>;
};

dbDescribe('R18 last active administrator floor (real PostgreSQL)', () => {
  const prefix = fixturePrefix('r18-admin-floor');
  let prisma: PrismaClient;
  let lock: HeldLock | undefined;
  let adminRoleId: string;
  // Only the two floor methods are exercised; they use nothing but the tx.
  const floor = new (AdminUsersService as unknown as new (...args: unknown[]) => FloorInternals)();

  beforeAll(async () => {
    lock = await acquireAdvisoryLocks([{ resource: 'seed', mode: 'shared' }]);
    prisma = (
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database')
    ).prisma;
    adminRoleId = (await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } })).id;
  });
  afterAll(async () => {
    await lock?.release();
  });

  async function rolledBack(work: (tx: PrismaTx) => Promise<void>): Promise<void> {
    await expect(
      prisma.$transaction(
        async (tx) => {
          await work(tx as PrismaTx);
          throw new Rollback();
        },
        { timeout: 60_000 },
      ),
    ).rejects.toBeInstanceOf(Rollback);
  }

  async function admin(tx: PrismaTx, tag: string, data: Record<string, unknown> = {}) {
    const id = `${prefix}${tag}`;
    await tx.user.create({
      data: {
        id,
        email: `${id}@example.test`,
        firstName: 'Floor',
        lastName: tag,
        status: 'ACTIVE',
        ...data,
      },
    });
    await tx.userRole.create({ data: { userId: id, roleId: adminRoleId } });
    return id;
  }

  /** Uncommitted: every administrator except `keep` leaves good standing. */
  async function onlyAdmin(tx: PrismaTx, keep: string) {
    await tx.user.updateMany({
      where: { id: { not: keep }, userRoles: { some: { roleId: adminRoleId } } },
      data: { status: 'SUSPENDED', isActive: false },
    });
  }

  it('refuses the last active admin, and allows it once a second one is in good standing', async () => {
    await rolledBack(async (tx) => {
      const last = await admin(tx, 'last');
      await onlyAdmin(tx, last);
      await expect(floor.assertNotLastActiveAdmin(last, tx)).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });
      const second = await admin(tx, 'second');
      await expect(floor.assertNotLastActiveAdmin(last, tx)).resolves.toBeUndefined();
      await expect(floor.assertNotLastActiveAdmin(second, tx)).resolves.toBeUndefined();
    });
  });

  it('counts only good standing on a live admin role', async () => {
    await rolledBack(async (tx) => {
      const last = await admin(tx, 'standing');
      await onlyAdmin(tx, last);
      // None of these is an administrator in good standing.
      await admin(tx, 'locked', { status: 'LOCKED' });
      await admin(tx, 'inactive', { isActive: false });
      await admin(tx, 'deleted', { deletedAt: new Date() });
      await admin(tx, 'unverified', { status: 'PENDING_VERIFICATION' });
      await expect(floor.assertNotLastActiveAdmin(last, tx)).rejects.toMatchObject({ status: 409 });

      // A soft-deleted admin role grants nothing, so nobody holds it.
      const other = await admin(tx, 'other');
      await expect(floor.assertNotLastActiveAdmin(last, tx)).resolves.toBeUndefined();
      await tx.role.update({ where: { id: adminRoleId }, data: { deletedAt: new Date() } });
      await expect(floor.assertNotLastActiveAdmin(other, tx)).resolves.toBeUndefined();
    });
  });

  it('a non-admin target is never refused', async () => {
    await rolledBack(async (tx) => {
      const last = await admin(tx, 'keeper');
      await onlyAdmin(tx, last);
      const id = `${prefix}customer`;
      await tx.user.create({
        data: {
          id,
          email: `${id}@example.test`,
          firstName: 'Floor',
          lastName: 'customer',
          status: 'ACTIVE',
        },
      });
      await expect(floor.assertNotLastActiveAdmin(id, tx)).resolves.toBeUndefined();
    });
  });

  it('the floor lock is platform-wide: a second change waits until the first commits', async () => {
    const probe = () =>
      prisma.$queryRaw<Array<{ got: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext('admin_users:active_admin_floor')) AS "got"`;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const first = prisma.$transaction(
      async (tx) => {
        await floor.lockAdminFloor(tx as PrismaTx);
        locked();
        await held;
      },
      { timeout: 60_000 },
    );
    await isLocked;
    // Two admins suspending each other at once take this lock in turn, so the
    // second one counts the first one's committed suspension.
    expect((await probe())[0].got).toBe(false);
    release();
    await first;
    expect((await probe())[0].got).toBe(true);
  });
});
