import type { Address, AddressType } from '@homeservicemarketplace/database';

import type { AddressRepository } from '../../infrastructure/persistence/addresses/address.repository';
import type { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';
import { AddressesService } from './addresses.service';

// In-memory tx that just calls the supplied callback with `undefined` —
// no real Prisma transaction is required for these unit tests because
// the repository methods are mocked.
function makeTx(): TransactionRunner {
  return {
    run: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
  } as unknown as TransactionRunner;
}

function makeRow(overrides: Partial<Address> = {}): Address {
  return {
    id: 'addr-1',
    userId: 'user-1',
    label: 'Home',
    type: 'HOME' as AddressType,
    line1: '4 Main St',
    city: 'Riyadh',
    country: 'SA',
    lat: null,
    lng: null,
    isDefault: true,
    createdAt: new Date('2026-04-27T00:00:00.000Z'),
    updatedAt: new Date('2026-04-27T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

interface MockRepo {
  listForUser: jest.Mock;
  findOwned: jest.Mock;
  findCurrentDefault: jest.Mock;
  countForUser: jest.Mock;
  create: jest.Mock;
  updateOwned: jest.Mock;
  clearDefaultExcept: jest.Mock;
  setDefaultOwned: jest.Mock;
  softDeleteOwned: jest.Mock;
}

function makeRepo(overrides: Partial<MockRepo> = {}): MockRepo {
  return {
    listForUser: jest.fn().mockResolvedValue([]),
    findOwned: jest.fn().mockResolvedValue(null),
    findCurrentDefault: jest.fn().mockResolvedValue(null),
    countForUser: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue(makeRow()),
    updateOwned: jest.fn().mockResolvedValue({ count: 0 }),
    clearDefaultExcept: jest.fn().mockResolvedValue({ count: 0 }),
    setDefaultOwned: jest.fn().mockResolvedValue({ count: 0 }),
    softDeleteOwned: jest.fn().mockResolvedValue({ count: 0 }),
    ...overrides,
  };
}

function makeService(repo: MockRepo) {
  return new AddressesService(repo as unknown as AddressRepository, makeTx());
}

describe('AddressesService', () => {
  // ─── list ────────────────────────────────────────────────────────────
  describe('list', () => {
    it("returns the user's addresses mapped to AddressSummary (drops persistence fields)", async () => {
      const repo = makeRepo({
        listForUser: jest
          .fn()
          .mockResolvedValue([makeRow(), makeRow({ id: 'addr-2', isDefault: false })]),
      });
      const out = await makeService(repo).list('user-1');
      expect(out).toHaveLength(2);
      expect(out[0]).toEqual({
        id: 'addr-1',
        label: 'Home',
        type: 'HOME',
        line1: '4 Main St',
        city: 'Riyadh',
        country: 'SA',
        lat: null,
        lng: null,
        isDefault: true,
      });
      // Persistence-only fields must not leak.
      for (const dto of out) {
        expect(dto).not.toHaveProperty('userId');
        expect(dto).not.toHaveProperty('createdAt');
        expect(dto).not.toHaveProperty('updatedAt');
        expect(dto).not.toHaveProperty('deletedAt');
      }
      expect(repo.listForUser).toHaveBeenCalledWith('user-1');
    });

    it('returns an empty array when the user has no addresses', async () => {
      const repo = makeRepo({ listForUser: jest.fn().mockResolvedValue([]) });
      expect(await makeService(repo).list('user-1')).toEqual([]);
    });
  });

  // ─── create ──────────────────────────────────────────────────────────
  describe('create', () => {
    it('inserts the address and forces userId from the session, never the wire', async () => {
      const repo = makeRepo({
        countForUser: jest.fn().mockResolvedValue(2),
        create: jest.fn().mockResolvedValue(makeRow({ isDefault: false })),
      });
      const svc = makeService(repo);
      await svc.create('user-from-session', {
        label: 'Office',
        type: 'WORK' as AddressType,
        line1: 'King Fahd Rd',
        city: 'Riyadh',
        country: 'SA',
      });
      const passed = repo.create.mock.calls[0]?.[0];
      // userId must be the session id even if the input never carried one.
      expect(passed.userId).toBe('user-from-session');
      // Not the user's first address and isDefault not requested → not promoted.
      expect(passed.isDefault).toBe(false);
      expect(repo.clearDefaultExcept).not.toHaveBeenCalled();
    });

    it('promotes the first-ever address to default (UX: first address is your default)', async () => {
      const repo = makeRepo({
        countForUser: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(makeRow({ isDefault: true })),
      });
      await makeService(repo).create('user-1', {
        label: 'Home',
        type: 'HOME' as AddressType,
        line1: '4 Main St',
        city: 'Riyadh',
        country: 'SA',
      });
      expect(repo.create.mock.calls[0]?.[0].isDefault).toBe(true);
      // Demotion sweep happens before insert so the new default is the
      // sole row carrying the flag at commit time.
      expect(repo.clearDefaultExcept).toHaveBeenCalledWith('user-1', null, undefined);
    });

    it('demotes the previous default when isDefault: true is requested explicitly', async () => {
      const repo = makeRepo({
        countForUser: jest.fn().mockResolvedValue(3),
        create: jest.fn().mockResolvedValue(makeRow({ isDefault: true })),
      });
      await makeService(repo).create('user-1', {
        label: 'New Place',
        type: 'CUSTOM' as AddressType,
        line1: 'Some St',
        city: 'Riyadh',
        country: 'SA',
        isDefault: true,
      });
      expect(repo.clearDefaultExcept).toHaveBeenCalledWith('user-1', null, undefined);
      expect(repo.create.mock.calls[0]?.[0].isDefault).toBe(true);
    });
  });

  // ─── update ──────────────────────────────────────────────────────────
  describe('update', () => {
    it('updates the row when owned by the user', async () => {
      const repo = makeRepo({
        updateOwned: jest.fn().mockResolvedValue({ count: 1 }),
        findOwned: jest.fn().mockResolvedValue(makeRow({ label: 'Home (renamed)' })),
      });
      const out = await makeService(repo).update('user-1', 'addr-1', { label: 'Home (renamed)' });
      expect(out.label).toBe('Home (renamed)');
      expect(repo.updateOwned).toHaveBeenCalledWith('addr-1', 'user-1', {
        label: 'Home (renamed)',
      });
    });

    it('rejects with NOT_FOUND when the row is not owned (cross-user attempt)', async () => {
      // Cross-user: updateOwned matches { id, userId, deletedAt: null }; a
      // foreign userId yields zero rows updated. We MUST NOT distinguish
      // "not found" from "not yours" in the response — that would leak
      // the existence of another user's row.
      const repo = makeRepo({ updateOwned: jest.fn().mockResolvedValue({ count: 0 }) });
      await expect(
        makeService(repo).update('user-attacker', 'addr-victim', { label: 'pwn' }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });
  });

  // ─── setDefault ──────────────────────────────────────────────────────
  describe('setDefault', () => {
    it('demotes others first then promotes the target — atomic flip', async () => {
      const order: string[] = [];
      const repo = makeRepo({
        findOwned: jest
          .fn()
          .mockResolvedValueOnce(makeRow({ isDefault: false }))
          .mockResolvedValueOnce(makeRow({ isDefault: true })),
        clearDefaultExcept: jest.fn().mockImplementation(() => {
          order.push('clear');
          return Promise.resolve({ count: 1 });
        }),
        setDefaultOwned: jest.fn().mockImplementation(() => {
          order.push('promote');
          return Promise.resolve({ count: 1 });
        }),
      });
      await makeService(repo).setDefault('user-1', 'addr-1');
      // Order must be clear-then-promote — flipping it would leave a
      // brief window where two rows are simultaneously default.
      expect(order).toEqual(['clear', 'promote']);
      expect(repo.clearDefaultExcept).toHaveBeenCalledWith('user-1', 'addr-1', undefined);
    });

    it('rejects with NOT_FOUND when the target is not owned', async () => {
      const repo = makeRepo({ findOwned: jest.fn().mockResolvedValue(null) });
      await expect(makeService(repo).setDefault('user-1', 'foreign')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(repo.clearDefaultExcept).not.toHaveBeenCalled();
      expect(repo.setDefaultOwned).not.toHaveBeenCalled();
    });
  });

  // ─── remove ──────────────────────────────────────────────────────────
  describe('remove', () => {
    it('soft-deletes a non-default address owned by the user', async () => {
      const repo = makeRepo({
        findOwned: jest.fn().mockResolvedValue(makeRow({ isDefault: false })),
        countForUser: jest.fn().mockResolvedValue(2),
        softDeleteOwned: jest.fn().mockResolvedValue({ count: 1 }),
      });
      await makeService(repo).remove('user-1', 'addr-1');
      expect(repo.softDeleteOwned).toHaveBeenCalledWith('addr-1', 'user-1', undefined);
    });

    it('rejects deleting the default while other addresses exist (CONFLICT)', async () => {
      // Documented rule: deleting the default is rejected when the user
      // still has other addresses. The user must explicitly promote
      // another address first; we never silently promote a replacement.
      const repo = makeRepo({
        findOwned: jest.fn().mockResolvedValue(makeRow({ isDefault: true })),
        countForUser: jest.fn().mockResolvedValue(3),
      });
      await expect(makeService(repo).remove('user-1', 'addr-1')).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
      expect(repo.softDeleteOwned).not.toHaveBeenCalled();
    });

    it('allows deleting the default when it is the only remaining address', async () => {
      const repo = makeRepo({
        findOwned: jest.fn().mockResolvedValue(makeRow({ isDefault: true })),
        countForUser: jest.fn().mockResolvedValue(1),
        softDeleteOwned: jest.fn().mockResolvedValue({ count: 1 }),
      });
      await makeService(repo).remove('user-1', 'addr-1');
      expect(repo.softDeleteOwned).toHaveBeenCalled();
    });

    it('rejects with NOT_FOUND when the address is not owned (cross-user attempt)', async () => {
      const repo = makeRepo({ findOwned: jest.fn().mockResolvedValue(null) });
      await expect(makeService(repo).remove('user-attacker', 'addr-victim')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(repo.softDeleteOwned).not.toHaveBeenCalled();
    });
  });

  // ─── error contract ──────────────────────────────────────────────────
  it('throws AppError instances (never raw Prisma errors) on every error path', async () => {
    const repo = makeRepo({ findOwned: jest.fn().mockResolvedValue(null) });
    const svc = makeService(repo);
    await Promise.all([
      expect(svc.update('u', 'a', { label: 'x' })).rejects.toBeInstanceOf(AppError),
      expect(svc.setDefault('u', 'a')).rejects.toBeInstanceOf(AppError),
      expect(svc.remove('u', 'a')).rejects.toBeInstanceOf(AppError),
    ]);
  });
});
