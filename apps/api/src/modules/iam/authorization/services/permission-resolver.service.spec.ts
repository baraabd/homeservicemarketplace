import type { AppConfigService } from '../../../../config/app-config.service';
import type { RedisService } from '../../../../infrastructure/redis/redis.service';
import type { RoleRepository } from '../../../../infrastructure/persistence/iam/role.repository';
import { PermissionResolverService } from './permission-resolver.service';

function mkRedis(state: { store: Map<string, string>; fail?: boolean }) {
  const client = {
    mget: jest.fn(async (...keys: string[]) => {
      if (state.fail) throw new Error('down');
      return keys.map((k) => state.store.get(k) ?? null);
    }),
    setex: jest.fn(async (k: string, _ttl: number, v: string) => {
      state.store.set(k, v);
      return 'OK';
    }),
    del: jest.fn(),
    scanStream: jest.fn(() => []),
  };
  return { getClient: () => client, _client: client } as unknown as RedisService & {
    _client: typeof client;
  };
}

function mkRoles(perMs: Record<string, string[]>) {
  return {
    findByName: jest.fn(async (name: string) => (perMs[name] ? { id: `role-${name}` } : null)),
    listPermissions: jest.fn(async (roleId: string) => {
      const name = roleId.replace('role-', '');
      return (perMs[name] ?? []).map((key) => ({ permission: { key } }));
    }),
  } as unknown as RoleRepository;
}

const config: AppConfigService = {
  get: (k: string) => (k === 'PERMISSION_CACHE_TTL_SECONDS' ? 60 : undefined),
} as unknown as AppConfigService;

describe('PermissionResolverService', () => {
  it('loads permissions from DB on cache miss and sets cache', async () => {
    const state = { store: new Map<string, string>() };
    const redis = mkRedis(state);
    const roles = mkRoles({ admin: ['user:read:any', 'user:write:any'] });
    const svc = new PermissionResolverService(roles, redis, config);

    const granted = await svc.resolveForRoles(['admin']);
    expect(granted.has('user:read:any')).toBe(true);
    expect(granted.has('user:write:any')).toBe(true);
    expect(redis._client.setex).toHaveBeenCalledTimes(1);
  });

  it('unions permissions across multiple roles', async () => {
    const state = { store: new Map<string, string>() };
    const redis = mkRedis(state);
    const roles = mkRoles({
      customer: ['user:read:self'],
      provider: ['user:write:self'],
    });
    const svc = new PermissionResolverService(roles, redis, config);

    const granted = await svc.resolveForRoles(['customer', 'provider']);
    expect([...granted].sort()).toEqual(['user:read:self', 'user:write:self']);
  });

  it('degrades open to DB when Redis MGET throws', async () => {
    const state = { store: new Map<string, string>(), fail: true };
    const redis = mkRedis(state);
    const roles = mkRoles({ admin: ['user:read:any'] });
    const svc = new PermissionResolverService(roles, redis, config);

    const granted = await svc.resolveForRoles(['admin']);
    expect(granted.has('user:read:any')).toBe(true);
  });

  it('returns empty for unknown roles without throwing', async () => {
    const state = { store: new Map<string, string>() };
    const redis = mkRedis(state);
    const roles = mkRoles({});
    const svc = new PermissionResolverService(roles, redis, config);
    const granted = await svc.resolveForRoles(['nope']);
    expect(granted.size).toBe(0);
  });
});
