import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PSL_SNAPSHOT,
  getPublicSuffix,
  getDomain,
  isPublicSuffix,
  validateSameSiteHosts,
} = require('./public-suffix.cjs');

test('uses the complete licensed official snapshot, including PRIVATE rules', () => {
  const source = readFileSync(new URL('./public-suffix-list.dat', import.meta.url), 'utf8').replace(
    /\r\n/gu,
    '\n',
  );
  assert.equal(Buffer.byteLength(source), PSL_SNAPSHOT.bytes);
  assert.equal(createHash('sha256').update(source).digest('hex'), PSL_SNAPSHOT.sha256);
  assert.ok(
    source.startsWith('// This Source Code Form is subject to the terms of the Mozilla Public'),
  );
  assert.ok(source.includes('// VERSION: ' + PSL_SNAPSHOT.version));
  assert.ok(source.includes('// COMMIT: ' + PSL_SNAPSHOT.commit));
  for (const section of ['ICANN', 'PRIVATE']) {
    assert.ok(source.includes('// ===BEGIN ' + section + ' DOMAINS==='));
    assert.ok(source.includes('// ===END ' + section + ' DOMAINS==='));
  }
});

const cases = [
  ['com.sa', 'com.sa', null],
  ['co.uk', 'co.uk', null],
  ['example.com.sa', 'com.sa', 'example.com.sa'],
  ['app.staging.example.com.sa', 'com.sa', 'example.com.sa'],
  ['APP.Example.CO.UK', 'co.uk', 'example.co.uk'],
  ['example.co.uk.', 'co.uk.', 'example.co.uk.'],
  ['co.uk.', 'co.uk.', null],
  ['a.ck', 'a.ck', null],
  ['b.a.ck', 'a.ck', 'b.a.ck'],
  ['www.ck', 'ck', 'www.ck'],
  ['x.www.ck', 'ck', 'www.ck'],
  ['a.kawasaki.jp', 'a.kawasaki.jp', null],
  ['b.a.kawasaki.jp', 'a.kawasaki.jp', 'b.a.kawasaki.jp'],
  ['city.kawasaki.jp', 'kawasaki.jp', 'city.kawasaki.jp'],
  ['x.city.kawasaki.jp', 'kawasaki.jp', 'city.kawasaki.jp'],
  ['vercel.app', 'vercel.app', null],
  ['tenant.vercel.app', 'vercel.app', 'tenant.vercel.app'],
  ['up.railway.app', 'up.railway.app', null],
  ['tenant.up.railway.app', 'up.railway.app', 'tenant.up.railway.app'],
  ['railway.app', 'app', 'railway.app'],
  ['github.io', 'github.io', null],
  ['tenant.github.io', 'github.io', 'tenant.github.io'],
  ['公司.cn', 'xn--55qx5d.cn', null],
  ['食狮.公司.cn', 'xn--55qx5d.cn', 'xn--85x722f.xn--55qx5d.cn'],
  ['www.xn--85x722f.xn--55qx5d.cn', 'xn--55qx5d.cn', 'xn--85x722f.xn--55qx5d.cn'],
  ['BÜCHER.DE', 'de', 'xn--bcher-kva.de'],
  ['EXAMPLE。COM', 'com', 'example.com'],
  ['www.example.hsm-unknown-tld', 'hsm-unknown-tld', 'example.hsm-unknown-tld'],
];
for (const [hostname, suffix, domain] of cases) {
  test('PSL query for ' + hostname, () => {
    assert.equal(getPublicSuffix(hostname), suffix);
    assert.equal(getDomain(hostname), domain);
    assert.equal(isPublicSuffix(hostname), domain === null);
  });
}

test('accepts registered Saudi domains and narrower staging cookie scope', () => {
  assert.deepEqual(
    validateSameSiteHosts('app.example.com.sa', 'api.example.com.sa', '.example.com.sa'),
    {
      webHostname: 'app.example.com.sa',
      apiHostname: 'api.example.com.sa',
      cookieParent: 'example.com.sa',
      registrableDomain: 'example.com.sa',
    },
  );
  assert.equal(
    validateSameSiteHosts(
      'app.staging.example.com.sa',
      'api.staging.example.com.sa',
      '.staging.example.com.sa',
    ).registrableDomain,
    'example.com.sa',
  );
  assert.equal(
    validateSameSiteHosts('example.co.uk', 'api.example.co.uk', 'example.co.uk').cookieParent,
    'example.co.uk',
  );
});

test('accepts Unicode and ASCII forms of the same registrable IDNA domain', () => {
  const asciiHostname = 'api.xn--85x722f.xn--55qx5d.cn';
  assert.deepEqual(validateSameSiteHosts('WEB.食狮.公司.cn', asciiHostname, '.食狮.公司.cn'), {
    webHostname: 'web.xn--85x722f.xn--55qx5d.cn',
    apiHostname: asciiHostname,
    cookieParent: 'xn--85x722f.xn--55qx5d.cn',
    registrableDomain: 'xn--85x722f.xn--55qx5d.cn',
  });
});

const invalidSites = [
  ['web.com.sa', 'api.com.sa', '.com.sa'],
  ['web.co.uk', 'api.co.uk', '.co.uk'],
  ['web.vercel.app', 'api.vercel.app', '.vercel.app'],
  ['web.up.railway.app', 'api.up.railway.app', '.up.railway.app'],
  ['web.up.railway.app', 'api.up.railway.app', '.railway.app'],
  ['web.github.io', 'api.github.io', '.github.io'],
  ['web.a.ck', 'api.a.ck', '.a.ck'],
  ['web.a.kawasaki.jp', 'api.a.kawasaki.jp', '.a.kawasaki.jp'],
  ['web.example.com', 'api.other.com', '.com'],
  ['evil-example.com', 'api.example.com', '.example.com'],
  ['web.example.com', 'api.example.com', '.web.example.com'],
  ['web.example.com', 'web.example.com', '.example.com'],
  ['web.example.com.', 'api.example.com', '.example.com'],
  ['web.example.com', 'api.example.com', '.example.com.'],
  ['web.example.com', 'api.example.com', '..example.com'],
  ['web.食狮.公司.cn', 'api.食狮.公司.cn', '.公司.cn'],
];
for (const [web, api, parent] of invalidSites) {
  test('rejects an unsafe shared cookie scope: ' + web + ' / ' + parent, () => {
    assert.throws(() => validateSameSiteHosts(web, api, parent), /^Error: HSM_COOKIE_DOMAIN:/u);
  });
}

test('permits shared descendants inside a PRIVATE tenant or a wildcard exception', () => {
  assert.equal(
    validateSameSiteHosts('web.tenant.vercel.app', 'api.tenant.vercel.app', '.tenant.vercel.app')
      .registrableDomain,
    'tenant.vercel.app',
  );
  assert.equal(
    validateSameSiteHosts('web.city.kawasaki.jp', 'api.city.kawasaki.jp', '.city.kawasaki.jp')
      .registrableDomain,
    'city.kawasaki.jp',
  );
});

test('rejects malformed hostnames, URL syntax, IP literals and overlong DNS labels', () => {
  const invalid = [
    undefined,
    '',
    '.example.com',
    'example..com',
    'example.com..',
    ' example.com',
    'example.com\n',
    'https://example.com',
    'example.com/path',
    'user@example.com',
    'example.com:443',
    'example.com?x=1',
    'example.com#fragment',
    'example.com\\path',
    'e%78ample.com',
    '_service.example.com',
    '-example.com',
    'example-.com',
    '127.0.0.1',
    '0x7f.1',
    '[::1]',
    '::1',
    'xn--.com',
    'a'.repeat(64) + '.com',
    Array(5).fill('a'.repeat(63)).join('.'),
  ];
  for (const value of invalid) {
    assert.throws(() => getDomain(value), TypeError);
    assert.throws(() => getPublicSuffix(value), TypeError);
    assert.throws(() => isPublicSuffix(value), TypeError);
  }
});
