import type { Address } from '@homeservicemarketplace/database';

import { AddressRepository } from '../../../infrastructure/persistence/user/address.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AddressService } from './address.service';

// In-memory fake repo. Accepts a `tx` arg but ignores it (our fake tx
// is a plain object). The FakeTxRunner below runs the callback immediately;
// for service-level invariants this is faithful — ordering and atomic
// visibility are what we assert, not DB transaction isolation (which is
// a Prisma concern tested elsewhere).
class FakeAddressRepo {
  rows = new Map<string, Address>();
  private seq = 1;

  async listForUser(userId: string): Promise<Address[]> {
    return [...this.rows.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }

  async findById(id: string): Promise<Address | null> {
    return this.rows.get(id) ?? null;
  }

  async countForUser(userId: string): Promise<number> {
    return [...this.rows.values()].filter((r) => r.userId === userId).length;
  }

  async create(input: {
    userId: string;
    label?: string | null;
    street: string;
    city: string;
    state?: string | null;
    zipCode?: string | null;
    country: string;
    latitude?: number | null;
    longitude?: number | null;
    isDefault?: boolean;
  }): Promise<Address> {
    const id = `a${this.seq++}`;
    const now = new Date();
    const row: Address = {
      id,
      userId: input.userId,
      label: input.label ?? null,
      street: input.street,
      city: input.city,
      state: input.state ?? null,
      zipCode: input.zipCode ?? null,
      country: input.country,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      isDefault: input.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(id, row);
    return row;
  }

  async update(id: string, input: Partial<Address>): Promise<Address> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error('not found');
    const next: Address = { ...existing, ...input, updatedAt: new Date() };
    this.rows.set(id, next);
    return next;
  }

  async delete(id: string): Promise<Address> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error('not found');
    this.rows.delete(id);
    return existing;
  }

  async clearDefaultForUserExcept(userId: string, exceptId: string): Promise<{ count: number }> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.userId === userId && row.id !== exceptId && row.isDefault) {
        row.isDefault = false;
        count++;
      }
    }
    return { count };
  }

  async findOldestForUser(userId: string): Promise<Address | null> {
    const mine = [...this.rows.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return mine[0] ?? null;
  }
}

class FakeTxRunner {
  async run<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn({});
  }
}

describe('AddressService — domain invariants', () => {
  let repo: FakeAddressRepo;
  let tx: FakeTxRunner;
  let svc: AddressService;

  beforeEach(() => {
    repo = new FakeAddressRepo();
    tx = new FakeTxRunner();
    svc = new AddressService(
      repo as unknown as AddressRepository,
      tx as unknown as TransactionRunner,
    );
  });

  describe('create', () => {
    const base = {
      street: '1 Main',
      city: 'Cairo',
      country: 'EG',
    };

    it('first address is auto-default regardless of input.isDefault', async () => {
      const row = await svc.create('u1', { ...base, isDefault: false });
      expect(row.isDefault).toBe(true);
    });

    it('second non-default create keeps the first default', async () => {
      const a = await svc.create('u1', { ...base, street: '1 A' });
      const b = await svc.create('u1', { ...base, street: '2 B' });
      expect(a.isDefault).toBe(true);
      expect(b.isDefault).toBe(false);
    });

    it('creating with isDefault=true atomically flips previous default to false', async () => {
      const a = await svc.create('u1', { ...base, street: '1 A' });
      const b = await svc.create('u1', { ...base, street: '2 B', isDefault: true });
      const reloaded = await repo.findById(a.id);
      expect(reloaded!.isDefault).toBe(false);
      expect(b.isDefault).toBe(true);
    });

    it('scopes defaults per user — one user cannot clear another user default', async () => {
      await svc.create('u1', { ...base });
      await svc.create('u2', { ...base });
      const list1 = await svc.list('u1');
      const list2 = await svc.list('u2');
      expect(list1.every((r) => r.userId === 'u1')).toBe(true);
      expect(list2.every((r) => r.userId === 'u2')).toBe(true);
      expect(list1[0]!.isDefault).toBe(true);
      expect(list2[0]!.isDefault).toBe(true);
    });
  });

  describe('update', () => {
    const base = { street: '1 Main', city: 'Cairo', country: 'EG' };

    it('promoting a non-default to default demotes the previous default atomically', async () => {
      const a = await svc.create('u1', { ...base, street: '1 A' });
      const b = await svc.create('u1', { ...base, street: '2 B' });
      await svc.update('u1', b.id, { isDefault: true });
      const reloaded = await repo.findById(a.id);
      expect(reloaded!.isDefault).toBe(false);
      const bReloaded = await repo.findById(b.id);
      expect(bReloaded!.isDefault).toBe(true);
    });

    it('other users cannot update another user address (treated as 404)', async () => {
      const a = await svc.create('u1', { ...base });
      await expect(svc.update('u2', a.id, { city: 'Alexandria' })).rejects.toMatchObject({
        status: 404,
      });
    });

    it('refuses to unset isDefault on the last default (ADDRESS_DEFAULT_MUST_EXIST)', async () => {
      const a = await svc.create('u1', { ...base });
      await expect(svc.update('u1', a.id, { isDefault: false })).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({ code: 'ADDRESS_DEFAULT_MUST_EXIST' }),
      });
    });

    it('allows isDefault=false on a non-default row (no-op for the default invariant)', async () => {
      await svc.create('u1', { ...base, street: '1 A' });
      const b = await svc.create('u1', { ...base, street: '2 B' });
      // b is currently NOT default. Setting isDefault=false on it is a no-op,
      // not a rule violation.
      const out = await svc.update('u1', b.id, { isDefault: false });
      expect(out.isDefault).toBe(false);
    });
  });

  describe('setDefault', () => {
    const base = { street: '1 Main', city: 'Cairo', country: 'EG' };

    it('flips exactly one default across the user rows', async () => {
      const a = await svc.create('u1', { ...base, street: '1 A' });
      const b = await svc.create('u1', { ...base, street: '2 B' });
      const c = await svc.create('u1', { ...base, street: '3 C' });
      await svc.setDefault('u1', c.id);
      const all = await svc.list('u1');
      const defaults = all.filter((r) => r.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]!.id).toBe(c.id);
      expect((await repo.findById(a.id))!.isDefault).toBe(false);
      expect((await repo.findById(b.id))!.isDefault).toBe(false);
    });

    it('rejects setting-default on another user address (404, no existence leak)', async () => {
      const a = await svc.create('u1', { ...base });
      await expect(svc.setDefault('u2', a.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('remove', () => {
    const base = { street: '1 Main', city: 'Cairo', country: 'EG' };

    it('deleting a non-default address does not re-promote anything', async () => {
      const a = await svc.create('u1', { ...base, street: '1 A' });
      const b = await svc.create('u1', { ...base, street: '2 B' });
      await svc.remove('u1', b.id);
      expect((await repo.findById(a.id))!.isDefault).toBe(true);
      expect(await repo.findById(b.id)).toBeNull();
    });

    it('deleting the default WHEN another row exists promotes the oldest remaining', async () => {
      const a = await svc.create('u1', { ...base, street: '1 A' });
      // Force a later createdAt for b so "oldest remaining" is deterministic.
      const b = await svc.create('u1', { ...base, street: '2 B' });
      const aRow = await repo.findById(a.id);
      const bRow = await repo.findById(b.id);
      bRow!.createdAt = new Date(aRow!.createdAt.getTime() + 1000);
      await svc.remove('u1', a.id);
      // b is now the only row; it MUST be default.
      expect((await repo.findById(b.id))!.isDefault).toBe(true);
    });

    it('deleting the last address leaves the user with no addresses (no ghost rows)', async () => {
      const a = await svc.create('u1', { ...base });
      await svc.remove('u1', a.id);
      expect(await svc.list('u1')).toEqual([]);
    });

    it('other users cannot delete another user address (404)', async () => {
      const a = await svc.create('u1', { ...base });
      await expect(svc.remove('u2', a.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('list', () => {
    const base = { street: '1 Main', city: 'Cairo', country: 'EG' };

    it('returns only the caller own addresses', async () => {
      await svc.create('u1', { ...base, street: '1 A' });
      await svc.create('u2', { ...base, street: '2 B' });
      const list = await svc.list('u1');
      expect(list).toHaveLength(1);
      expect(list[0]!.userId).toBe('u1');
    });

    it('puts the default first in the list', async () => {
      const a = await svc.create('u1', { ...base, street: '1 A' });
      const b = await svc.create('u1', { ...base, street: '2 B' });
      await svc.setDefault('u1', b.id);
      const list = await svc.list('u1');
      expect(list[0]!.id).toBe(b.id);
      expect(list[1]!.id).toBe(a.id);
    });
  });
});
