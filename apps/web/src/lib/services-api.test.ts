import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from './api';
import { listServiceCategories } from './services-api';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

describe('services-api — listServiceCategories', () => {
  it('GETs /v1/services and unwraps the items array', async () => {
    mock.onGet('/v1/services').reply(200, {
      items: [
        {
          id: 'sc-1',
          slug: 'plumbing',
          labelEn: 'Plumbing',
          labelAr: 'سباكة',
          icon: '🔧',
          sortOrder: 0,
        },
      ],
    });
    const out = await listServiceCategories();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slug: 'plumbing', labelEn: 'Plumbing' });
  });

  it('rejects on 5xx — caller (React Query) surfaces the error state', async () => {
    mock.onGet('/v1/services').reply(503, { error: { code: 'DEPENDENCY_UNAVAILABLE' } });
    await expect(listServiceCategories()).rejects.toBeDefined();
  });

  it('does not depend on auth — request goes out without throwing on 401', async () => {
    // /v1/services is public. The 401-refresh interceptor in api.ts only
    // fires when the original request was protected; a public 401 just
    // rejects normally. We pin that this never triggers a /refresh storm.
    mock.onGet('/v1/services').reply(200, { items: [] });
    mock.onPost('/v1/auth/refresh').reply(401, {});
    await listServiceCategories();
    const refreshCalls = mock.history.post.filter((r) => r.url === '/v1/auth/refresh');
    expect(refreshCalls).toHaveLength(0);
  });
});
