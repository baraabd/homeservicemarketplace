import { DeprecatedRouteMiddleware } from './deprecated-route.middleware';
import { DEPRECATED_ROUTES, findDeprecatedRoute } from './deprecated-routes';

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    res: {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      getHeader: (k: string) => headers[k],
    },
  };
}

function makeReq(originalUrl: string, method = 'GET') {
  return { originalUrl, url: originalUrl, method, header: () => undefined };
}

function makeMetrics() {
  return { deprecatedRouteRequestsTotal: { inc: jest.fn() } };
}

function run(url: string, method = 'GET') {
  const { res, headers } = makeRes();
  const metrics = makeMetrics();
  const next = jest.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new DeprecatedRouteMiddleware(metrics as any).use(makeReq(url, method) as any, res as any, next);
  return { headers, metrics, next };
}

describe('findDeprecatedRoute', () => {
  it('matches the family prefix and its children', () => {
    expect(findDeprecatedRoute('/v1/me/provider/bids')?.canonical).toBe('/v1/provider/bids');
    expect(findDeprecatedRoute('/v1/me/provider/bids/abc123')?.canonical).toBe('/v1/provider/bids');
  });

  it('does not match a merely similar prefix', () => {
    // `/v1/me/provider/bidsomething` must NOT match `/v1/me/provider/bids`,
    // or an unrelated future route would inherit a sunset date.
    expect(findDeprecatedRoute('/v1/me/provider/bidsomething')).toBeUndefined();
  });

  it('leaves the canonical family alone', () => {
    expect(findDeprecatedRoute('/v1/provider/bids')).toBeUndefined();
    expect(findDeprecatedRoute('/v1/provider/available-requests')).toBeUndefined();
  });

  it('leaves the provider PROFILE surfaces alone', () => {
    // `/v1/me/provider` and its categories surface have no canonical twin —
    // "me" is the right noun for a resource the caller owns. Marking them
    // deprecated would promise a migration target that does not exist.
    expect(findDeprecatedRoute('/v1/me/provider')).toBeUndefined();
    expect(findDeprecatedRoute('/v1/me/provider/categories/applications')).toBeUndefined();
  });
});

describe('DEPRECATED_ROUTES registry', () => {
  it('gives every entry a parseable sunset date', () => {
    // A malformed date silently drops the strongest signal a client gets.
    for (const route of DEPRECATED_ROUTES) {
      expect(Number.isNaN(new Date(route.sunset).getTime())).toBe(false);
    }
  });

  it('never points an entry at itself', () => {
    for (const route of DEPRECATED_ROUTES) {
      expect(route.canonical).not.toBe(route.prefix);
    }
  });

  it('never names a canonical target that is itself deprecated', () => {
    // Otherwise clients are told to migrate onto a route that is also going
    // away, which is worse than saying nothing.
    for (const route of DEPRECATED_ROUTES) {
      expect(findDeprecatedRoute(route.canonical)).toBeUndefined();
    }
  });
});

describe('DeprecatedRouteMiddleware', () => {
  it('is a no-op for a route that is not deprecated', () => {
    const { headers, metrics, next } = run('/v1/provider/bids');
    expect(headers).toEqual({});
    expect(metrics.deprecatedRouteRequestsTotal.inc).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('sets Deprecation, Sunset, Link, and the reason', () => {
    const { headers } = run('/v1/me/provider/bids');
    expect(headers.Deprecation).toBe('true');
    // RFC 8594 requires an HTTP-date; an ISO string is silently ignored by
    // tooling.
    expect(headers.Sunset).toBe(new Date('2027-02-01').toUTCString());
    expect(headers.Link).toBe('</v1/provider/bids>; rel="successor-version"');
    expect(headers['X-Deprecation-Reason']).toContain('/v1/provider/bids');
  });

  it('always calls next — deprecation must never change behaviour', () => {
    const { next } = run('/v1/me/provider/bids');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('counts by route FAMILY, not by concrete path', () => {
    // One label per family. Labelling by URL would put every bid id into the
    // metric and take /metrics down on cardinality.
    const { metrics } = run('/v1/me/provider/bids/clh3k2j1x0000qwer1234asdf', 'DELETE');
    expect(metrics.deprecatedRouteRequestsTotal.inc).toHaveBeenCalledWith({
      route: '/v1/me/provider/bids',
      canonical: '/v1/provider/bids',
      method: 'DELETE',
    });
  });

  it('ignores the query string when matching and labelling', () => {
    const { headers, metrics } = run('/v1/me/provider/jobs/available?limit=20&cursor=abc');
    expect(headers.Deprecation).toBe('true');
    expect(metrics.deprecatedRouteRequestsTotal.inc).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/v1/me/provider/jobs' }),
    );
  });

  it('appends to an existing Link header rather than clobbering it', () => {
    const { res, headers } = makeRes();
    headers.Link = '<https://docs.example/api>; rel="describedby"';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new DeprecatedRouteMiddleware(makeMetrics() as any).use(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeReq('/v1/me/provider/bids') as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res as any,
      jest.fn(),
    );
    expect(headers.Link).toBe(
      '<https://docs.example/api>; rel="describedby", </v1/provider/bids>; rel="successor-version"',
    );
  });

  it('covers every deprecated family in the registry', () => {
    // Guards against an entry being added to the registry with a prefix the
    // matcher cannot actually reach.
    for (const route of DEPRECATED_ROUTES) {
      const { headers } = run(route.prefix);
      expect(headers.Deprecation).toBe('true');
      expect(headers.Link).toContain(route.canonical);
    }
  });
});
