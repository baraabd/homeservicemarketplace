// Unit test for seedWithTx(): proves idempotency at the logic level by driving
// the transactional callback against a fake TransactionClient, with no live
// Postgres required. Complements the integration test in
// test/integration/seed-idempotency.spec.ts which exercises the real DB.

import { seedWithTx } from '@homeservicemarketplace/database';

interface UpsertCall {
  where: Record<string, unknown>;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

function makeFakeTx() {
  const rolesByName = new Map<string, { id: string; name: string }>();
  const permsByKey = new Map<string, { id: string; key: string }>();
  const rolePermPairs = new Set<string>();

  const roleCalls: UpsertCall[] = [];
  const permCalls: UpsertCall[] = [];
  const rolePermCalls: UpsertCall[] = [];

  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  return {
    role: {
      upsert: jest.fn(async (args: UpsertCall) => {
        roleCalls.push(args);
        const name = (args.where as { name: string }).name;
        let row = rolesByName.get(name);
        if (!row) {
          row = { id: nextId('role'), name };
          rolesByName.set(name, row);
        }
        return row;
      }),
    },
    permission: {
      upsert: jest.fn(async (args: UpsertCall) => {
        permCalls.push(args);
        const key = (args.where as { key: string }).key;
        let row = permsByKey.get(key);
        if (!row) {
          row = { id: nextId('perm'), key };
          permsByKey.set(key, row);
        }
        return row;
      }),
    },
    rolePermission: {
      upsert: jest.fn(async (args: UpsertCall) => {
        rolePermCalls.push(args);
        const keyPair = JSON.stringify(args.where);
        rolePermPairs.add(keyPair);
        return {};
      }),
    },
    // Observability for assertions
    _rolesByName: rolesByName,
    _permsByKey: permsByKey,
    _rolePermPairs: rolePermPairs,
    _calls: { role: roleCalls, perm: permCalls, rolePerm: rolePermCalls },
  };
}

describe('seedWithTx (unit)', () => {
  it('creates the three system roles on first run', async () => {
    const tx = makeFakeTx();
    await seedWithTx(tx as never);
    expect([...tx._rolesByName.keys()].sort()).toEqual(['admin', 'customer', 'provider']);
  });

  it('creates the baseline permissions on first run', async () => {
    const tx = makeFakeTx();
    await seedWithTx(tx as never);
    const keys = [...tx._permsByKey.keys()].sort();
    expect(keys).toContain('user:read:self');
    expect(keys).toContain('user:write:self');
    expect(keys).toContain('permission:read');
    expect(keys.length).toBeGreaterThanOrEqual(8);
  });

  it('wires admin to every permission and end-users to self-only', async () => {
    const tx = makeFakeTx();
    await seedWithTx(tx as never);
    const adminId = tx._rolesByName.get('admin')!.id;
    const customerId = tx._rolesByName.get('customer')!.id;
    const providerId = tx._rolesByName.get('provider')!.id;

    const adminPairs = [...tx._rolePermPairs].filter((p) => p.includes(`"roleId":"${adminId}"`));
    const customerPairs = [...tx._rolePermPairs].filter((p) =>
      p.includes(`"roleId":"${customerId}"`),
    );
    const providerPairs = [...tx._rolePermPairs].filter((p) =>
      p.includes(`"roleId":"${providerId}"`),
    );

    expect(adminPairs.length).toBe(tx._permsByKey.size);
    expect(customerPairs.length).toBe(2);
    expect(providerPairs.length).toBe(2);
  });

  it('is idempotent — a second run produces no new rows', async () => {
    const tx = makeFakeTx();
    await seedWithTx(tx as never);
    const roleCountAfter1 = tx._rolesByName.size;
    const permCountAfter1 = tx._permsByKey.size;
    const pairCountAfter1 = tx._rolePermPairs.size;

    await seedWithTx(tx as never);

    expect(tx._rolesByName.size).toBe(roleCountAfter1);
    expect(tx._permsByKey.size).toBe(permCountAfter1);
    expect(tx._rolePermPairs.size).toBe(pairCountAfter1);
  });

  it('uses upsert (never plain create) for every row — idempotency guarantee', async () => {
    const tx = makeFakeTx();
    await seedWithTx(tx as never);
    // Every call in our fake is recorded as an upsert. A regression that
    // switched to create() would throw here because .create is not mocked.
    expect(tx._calls.role.length).toBeGreaterThan(0);
    expect(tx._calls.perm.length).toBeGreaterThan(0);
    expect(tx._calls.rolePerm.length).toBeGreaterThan(0);
    for (const call of [...tx._calls.role, ...tx._calls.perm, ...tx._calls.rolePerm]) {
      expect(call).toHaveProperty('where');
      expect(call).toHaveProperty('create');
      expect(call).toHaveProperty('update');
    }
  });

  it('marks system roles with isSystem: true on both create and update paths', async () => {
    const tx = makeFakeTx();
    await seedWithTx(tx as never);
    for (const call of tx._calls.role) {
      expect((call.create as { isSystem: boolean }).isSystem).toBe(true);
      expect((call.update as { isSystem: boolean }).isSystem).toBe(true);
    }
  });

  it('propagates errors from the underlying tx rather than swallowing them', async () => {
    const tx = makeFakeTx();
    tx.role.upsert.mockRejectedValueOnce(new Error('pg unavailable'));
    await expect(seedWithTx(tx as never)).rejects.toThrow('pg unavailable');
  });
});
