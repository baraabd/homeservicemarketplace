import { ProviderCapability } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';

import { ALL_CAPABILITIES, ProviderCapabilityService } from './provider-capability.service';
import type { AppConfigService } from '../../../config/app-config.service';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';

// R17-E — `canInTransaction` is the same precedence table as `can`, read in the
// caller's transaction after locking the rows its facts live on. It must not
// become a second rule: every state below is decided by both and compared.

type Facts = {
  account: { status: string; isActive: boolean; deletedAt: Date | null } | null;
  profile: { status: string; standingState: string | null; verificationState: string | null };
  liveGrant: boolean;
};

const ok = { status: 'ACTIVE', isActive: true, deletedAt: null };
const good = { status: 'ACTIVE', standingState: 'GOOD', verificationState: 'VERIFIED' };
const STATES: Array<[string, Facts]> = [
  ['working', { account: ok, profile: good, liveGrant: true }],
  [
    'restricted',
    { account: ok, profile: { ...good, standingState: 'RESTRICTED' }, liveGrant: true },
  ],
  [
    'suspended (legacy)',
    { account: ok, profile: { ...good, status: 'SUSPENDED' }, liveGrant: true },
  ],
  [
    'terminated',
    { account: ok, profile: { ...good, standingState: 'TERMINATED' }, liveGrant: true },
  ],
  ['grant revoked', { account: ok, profile: good, liveGrant: false }],
  [
    'verification lapsed',
    { account: ok, profile: { ...good, verificationState: 'EXPIRED' }, liveGrant: true },
  ],
  [
    'account suspended',
    { account: { ...ok, status: 'SUSPENDED' }, profile: good, liveGrant: true },
  ],
  ['account missing', { account: null, profile: good, liveGrant: true }],
];

function reader(f: Facts, order: string[]) {
  return {
    user: {
      findUnique: jest.fn(async () => {
        order.push('read:user');
        return f.account;
      }),
    },
    providerProfile: {
      findFirst: jest.fn(async () => {
        order.push('read:profile');
        return { id: 'pp-1', onboardingState: 'ACCEPTED', ...f.profile };
      }),
    },
    providerWorkAccessGrant: {
      findFirst: jest.fn(async () => {
        order.push('read:grant');
        return f.liveGrant ? { id: 'g-1' } : null;
      }),
    },
  };
}

function setup(f: Facts) {
  const order: string[] = [];
  const pool = reader(f, []);
  const tx = {
    ...reader(f, order),
    $queryRaw: jest.fn(async (sql: TemplateStringsArray) => {
      order.push(/"ProviderProfile"/.test(sql.join('?')) ? 'lock:profile' : 'lock:user');
      return [];
    }),
  };
  const config = {
    get: (key: string) => key === 'WORK_ACCESS_ENFORCED' || key === 'VERIFICATION_ENFORCED',
  } as unknown as AppConfigService;
  const service = new ProviderCapabilityService(
    { client: pool } as unknown as PrismaService,
    config,
  );
  return { service, tx, pool, order };
}

describe('ProviderCapabilityService.canInTransaction', () => {
  it.each(STATES)('%s: identical to can() for every capability', async (_name, facts) => {
    for (const capability of ALL_CAPABILITIES) {
      const { service, tx } = setup(facts);
      const inTx = await service.canInTransaction('user-1', capability, tx as unknown as PrismaTx);
      expect(inTx).toBe(await setup(facts).service.can('user-1', capability));
    }
  });

  it('locks the account then the profile row FOR SHARE before reading any fact', async () => {
    const { service, tx, order } = setup(STATES[0]![1]);
    await service.canInTransaction(
      'user-1',
      ProviderCapability.SubmitBid,
      tx as unknown as PrismaTx,
    );
    expect(order.slice(0, 2)).toEqual(['lock:user', 'lock:profile']);
    expect(order.slice(2)).toEqual(['read:user', 'read:profile', 'read:grant']);
    const statements = tx.$queryRaw.mock.calls.map(([sql]) => sql.join('?'));
    for (const sql of statements) expect(sql).toMatch(/FOR SHARE/);
  });

  it('reads through the transaction, never the pool', async () => {
    const { service, tx, pool } = setup(STATES[0]![1]);
    await service.canInTransaction(
      'user-1',
      ProviderCapability.SubmitBid,
      tx as unknown as PrismaTx,
    );
    expect(tx.user.findUnique).toHaveBeenCalled();
    expect(pool.user.findUnique).not.toHaveBeenCalled();
    expect(pool.providerProfile.findFirst).not.toHaveBeenCalled();
    expect(pool.providerWorkAccessGrant.findFirst).not.toHaveBeenCalled();
  });

  it('only a working provider may take new work', async () => {
    const results = await Promise.all(
      STATES.map(async ([name, facts]) => {
        const { service, tx } = setup(facts);
        return [
          name,
          await service.canInTransaction(
            'user-1',
            ProviderCapability.SubmitBid,
            tx as unknown as PrismaTx,
          ),
        ];
      }),
    );
    expect(results.filter(([, allowed]) => allowed).map(([name]) => name)).toEqual(['working']);
  });
});
