const assert = require('node:assert/strict');
const test = require('node:test');
const { buildWebCsp, exactOrigin, injectWebCsp } = require('./web-csp.cjs');
const parse = (value) =>
  Object.fromEntries(
    value.split('; ').map((d) => {
      const [name, ...sources] = d.split(' ');
      return [name, sources];
    }),
  );

test('CSP explicitly binds API, socket, media and upload origins without widening scripts', () => {
  const csp = parse(
    buildWebCsp({
      VITE_API_URL: 'https://api.example.test',
      VITE_CSP_MEDIA_ORIGINS: 'https://cdn.example.test',
      VITE_CSP_UPLOAD_ORIGINS: 'https://uploads.example.test',
    }),
  );
  assert.deepEqual(csp['script-src'], ["'self'"]);
  assert.deepEqual(csp['script-src-attr'], ["'none'"]);
  assert.deepEqual(csp['default-src'], ["'none'"]);
  assert.ok(csp['connect-src'].includes('wss://api.example.test'));
  assert.ok(csp['connect-src'].includes('https://uploads.example.test'));
  assert.ok(csp['img-src'].includes('https://cdn.example.test'));
  assert.ok(csp['img-src'].includes('blob:'));
  assert.ok(csp['font-src'].includes('https://fonts.gstatic.com'));
  assert.deepEqual(csp['worker-src'], ["'self'"]);
  assert.deepEqual(csp['frame-src'], ["'none'"]);
  assert.ok(
    !Object.values(csp)
      .flat()
      .some((value) => ['*', 'https:', 'wss:', "'unsafe-eval'"].includes(value)),
  );
});
for (const raw of [
  '*',
  'https:',
  'https://*.test',
  'https://api.test/path',
  'https://api.test/?private=value',
  'https://name:private@api.test',
  'https://api.test/#x',
  'https://api.test;script-src',
  'https://api.test\\@other.test',
  'https://api.test\n',
  'http://api.test',
  '//api.test',
  'data:text/html,x',
]) {
  test(`rejects unsafe configured origin ${JSON.stringify(raw)}`, () => {
    assert.throws(
      () => exactOrigin(raw, 'origin'),
      (error) => !error.message.includes('private'),
    );
    assert.throws(() =>
      buildWebCsp({ VITE_API_URL: 'https://api.test', VITE_CSP_MEDIA_ORIGINS: raw }),
    );
  });
}
test('loopback-only HTTP fixture keeps its exact API and WS port', () => {
  const csp = parse(buildWebCsp({ VITE_API_URL: 'http://127.0.0.1:4326' }));
  assert.ok(csp['connect-src'].includes('http://127.0.0.1:4326'));
  assert.ok(csp['connect-src'].includes('ws://127.0.0.1:4326'));
});
test('origin input is bounded, deduplicated and cannot inject a second directive', () => {
  assert.throws(() =>
    buildWebCsp({
      VITE_API_URL: 'https://api.test',
      VITE_CSP_UPLOAD_ORIGINS: Array(21).fill('https://store.test').join(','),
    }),
  );
  assert.throws(() =>
    buildWebCsp({
      VITE_API_URL: 'https://api.test',
      VITE_CSP_UPLOAD_ORIGINS: 'https://store.test,',
    }),
  );
  const csp = parse(
    buildWebCsp({
      VITE_API_URL: 'https://api.test',
      VITE_CSP_MEDIA_ORIGINS: 'https://cdn.test,https://cdn.test',
    }),
  );
  assert.equal(csp['img-src'].filter((x) => x === 'https://cdn.test').length, 1);
});
test('enforced metadata precedes resource loading and cannot be duplicated', () => {
  const html =
    '<html><head>\n<meta charset="UTF-8" /><script src="/app.js"></script></head></html>';
  const result = injectWebCsp(html, buildWebCsp({ VITE_API_URL: 'https://api.test' }));
  assert.ok(result.indexOf('charset=') < result.indexOf('Content-Security-Policy'));
  assert.ok(result.indexOf('Content-Security-Policy') < result.indexOf('<script'));
  assert.ok(!result.includes('Report-Only'));
  assert.throws(() => injectWebCsp(result, 'anything'));
  assert.throws(() => injectWebCsp('<head><script src="/early.js"></script>', 'anything'));
});

test('HTML insertion treats replacement tokens as literal policy text', () => {
  const result = injectWebCsp(
    '<head><meta charset="UTF-8" /></head>',
    'connect-src https://api$&.test',
  );
  assert.equal((result.match(/<head>/gu) ?? []).length, 1);
  assert.ok(result.includes('https://api$&amp;.test'));
});
