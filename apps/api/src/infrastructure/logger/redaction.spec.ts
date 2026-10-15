import {
  REDACTED,
  classifyKey,
  pathOnly,
  scrubLogArgument,
  scrubText,
  serializeRequest,
  serializeResponse,
} from './redaction';

describe('scrubText', () => {
  it.each([
    ['a JWT', 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln here', 'eyJhbGci'],
    ['a bearer credential', 'Authorization: Bearer abcDEF123456', 'abcDEF123456'],
    ['basic auth', 'Proxy: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['URL userinfo', 'postgres://user:hunter22@db:5432/x', 'hunter22'],
    ['a query token', '/reset?token=t0k3nvalue&x=1', 't0k3nvalue'],
    ['an AWS signature', '?X-Amz-Signature=abcdef0123&X-Amz-Credential=AKIAXX', 'abcdef0123'],
    ['an AWS credential', '?X-Amz-Signature=a&X-Amz-Credential=AKIAXXSECRET', 'AKIAXXSECRET'],
    ['a key: value secret', 'password: s3cr3t!', 's3cr3t!'],
    ['a JSON-quoted secret', '{"refresh_token":"rt-123456"}', 'rt-123456'],
    ['an email', 'user Jane.Doe+x@example.org failed', 'Jane.Doe+x@example.org'],
    ['a PEM key', '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----', 'MIIE'],
  ])('removes %s', (_label, input, secret) => {
    expect(scrubText(input)).not.toContain(secret);
  });

  it('keeps the non-secret part of a message readable', () => {
    expect(scrubText('connect ECONNREFUSED postgres://u:p4ss@db:5432/x')).toBe(
      `connect ECONNREFUSED postgres://${REDACTED}@db:5432/x`,
    );
    expect(scrubText('/reset?token=abc&lang=ar')).toBe(`/reset?token=${REDACTED}&lang=ar`);
  });

  it('coarsens precise coordinate pairs to two decimals', () => {
    expect(scrubText('at 33.513847, 36.276528 now')).toBe('at 33.51, 36.27 now');
  });

  it('does not touch Prisma error codes or ordinary words', () => {
    expect(scrubText('P2002 unique constraint on email field')).toBe(
      'P2002 unique constraint on email field',
    );
  });

  it('truncates very long strings', () => {
    const out = scrubText('x'.repeat(10_000));
    expect(out.length).toBeLessThan(2_100);
    expect(out).toContain('[truncated]');
  });
});

describe('scrubLogArgument', () => {
  it('redacts secret keys, drops personal data and omits content', () => {
    const out = scrubLogArgument({
      password: 'p',
      apiKey: 'k',
      'x-csrf-token': 'c',
      email: 'a@b.co',
      firstName: 'Ann',
      body: { anything: 1 },
      receipt: 'long receipt text '.repeat(10),
      status: 'ok',
    }) as Record<string, unknown>;
    expect(out.password).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out['x-csrf-token']).toBe(REDACTED);
    expect(out.email).toBe('[REDACTED:personal]');
    expect(out.firstName).toBe('[REDACTED:personal]');
    expect(out.body).toBe('[OMITTED:content]');
    expect(out.receipt).toBe('[OMITTED:content]');
    expect(out.status).toBe('ok');
  });

  it("keeps the original error class for pino's error serializer", () => {
    class S3ServiceException extends Error {
      override name = 'S3ServiceException';
    }
    const out = scrubLogArgument(new S3ServiceException('x')) as {
      constructor: { name: string };
      type: string;
    };
    expect(out.type).toBe('S3ServiceException');
    expect(out.constructor.name).toBe('S3ServiceException');
    expect(Object.keys(out)).not.toContain('constructor');
  });

  it('coarsens coordinate fields', () => {
    expect(scrubLogArgument({ lat: 33.513847, lng: '36.276528' })).toEqual({
      lat: 33.51,
      lng: '36.28',
    });
  });

  it('walks exception causes and scrubs each message', () => {
    const root = new Error('db at postgres://u:rootpass@h/x');
    const err = new Error('outer', { cause: new Error('Bearer midtoken123', { cause: root }) });
    const json = JSON.stringify(scrubLogArgument(err));
    expect(json).not.toContain('rootpass');
    expect(json).not.toContain('midtoken123');
    expect(json).toContain('outer');
  });

  it('omits binary payloads and bounds depth, breadth and cycles', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const deep = { l1: { l2: { l3: { l4: { l5: { l6: { l7: 'x' } } } } } } };
    const wide = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, i]));
    expect(scrubLogArgument({ buf: Buffer.from('identity-bytes') })).toEqual({
      buf: '[OMITTED:binary 14 bytes]',
    });
    expect(JSON.stringify(scrubLogArgument(cyclic))).toContain('[Circular]');
    expect(JSON.stringify(scrubLogArgument(deep))).toContain('[Truncated]');
    expect(Object.keys(scrubLogArgument(wide) as object)).toHaveLength(51);
  });

  it('never throws, even on hostile getters', () => {
    const hostile = {};
    Object.defineProperty(hostile, 'x', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(scrubLogArgument(hostile)).toBe('[Unserializable]');
  });

  it('leaves framework objects for pino serializers', () => {
    const d = new Date(0);
    expect(scrubLogArgument(d)).toBe(d);
  });

  it('classifies keys case- and separator-insensitively', () => {
    expect(classifyKey('API_KEY')).toBe('secret');
    expect(classifyKey('Set-Cookie')).toBe('secret');
    expect(classifyKey('requestId')).toBe('plain');
  });
});

describe('request/response allowlists', () => {
  it('keeps only allowlisted headers and strips the query string', () => {
    const out = serializeRequest({
      id: 'r1',
      method: 'POST',
      url: '/v1/auth/reset?token=SECRET',
      headers: {
        host: 'api.test',
        'user-agent': 'ua',
        authorization: 'Bearer SECRET',
        cookie: 'sid=SECRET',
        'x-forwarded-for': '203.0.113.9',
      },
    });
    expect(out).toEqual({
      id: 'r1',
      method: 'POST',
      url: '/v1/auth/reset',
      headers: { host: 'api.test', 'user-agent': 'ua' },
    });
    expect(JSON.stringify(out)).not.toContain('SECRET');
    expect(JSON.stringify(out)).not.toContain('203.0.113.9');
  });

  it('never logs the raw x-request-id header (the validated id is req.id)', () => {
    const out = serializeRequest({
      id: 'uuid-1',
      headers: { 'x-request-id': 'bad id with spaces' },
    });
    expect(out.headers).toEqual({});
    expect(out.id).toBe('uuid-1');
  });

  it('prefers the original URL of a mounted request', () => {
    expect(serializeRequest({ url: '/x', raw: { originalUrl: '/v1/x?a=1' } }).url).toBe('/v1/x');
  });

  it('drops set-cookie from responses', () => {
    expect(
      serializeResponse({
        statusCode: 200,
        headers: { 'set-cookie': 'a=b', 'content-type': 'json' },
      }),
    ).toEqual({ statusCode: 200, headers: { 'content-type': 'json' } });
  });

  it('pathOnly removes fragments too', () => {
    expect(pathOnly('/a/b#frag?x')).toBe('/a/b');
    expect(pathOnly(undefined)).toBe('');
  });
});
