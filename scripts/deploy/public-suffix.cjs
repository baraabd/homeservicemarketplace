const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { isIP } = require('node:net');
const path = require('node:path');
const { domainToASCII } = require('node:url');

// Vendored unmodified from the official URL below on 2026-11-03. The data file
// retains its MPL-2.0 notice, upstream version/commit, and ICANN + PRIVATE sections.
// Update the snapshot and this metadata together after reviewing upstream changes.
// SHA-256 is over the upstream UTF-8 bytes (LF); normalize checkout CRLF for Windows.
// Algorithm: https://github.com/publicsuffix/list/wiki/Format#formal-algorithm
const PSL_SNAPSHOT = Object.freeze({
  url: 'https://publicsuffix.org/list/public_suffix_list.dat',
  version: '2026-10-31_14-17-28_UTC',
  commit: '73f8cc701c084fe07d888ec552b2f0b53281a674',
  downloadedAt: '2026-11-03',
  sha256: '617d1b276660e5a01209d7b58159450e400cf636634a7a9c2cfd50a1c6675d01',
  bytes: 337917,
});

function canonicalHostname(value) {
  // domainToASCII also parses some URL-like inputs (e.g. example.com/path).
  // Reject URL syntax first so hostname validation cannot silently discard it.
  if (typeof value !== 'string' || !value || /[\s/@:?#\\%[\]]/u.test(value)) {
    throw new TypeError('A valid DNS hostname is required');
  }
  const ascii = domainToASCII(value).toLowerCase();
  const trailingDot = ascii.endsWith('.');
  const hostname = trailingDot ? ascii.slice(0, -1) : ascii;
  if (
    !hostname ||
    hostname.length > 253 ||
    isIP(hostname) ||
    hostname.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
  ) {
    throw new TypeError('A valid DNS hostname is required');
  }
  return { hostname, trailingDot };
}

function loadRules() {
  const source = readFileSync(path.join(__dirname, 'public-suffix-list.dat'), 'utf8').replace(
    /\r\n/gu,
    '\n',
  );
  if (createHash('sha256').update(source, 'utf8').digest('hex') !== PSL_SNAPSHOT.sha256) {
    throw new Error(
      'Public suffix snapshot checksum mismatch; review the data and provenance together',
    );
  }
  const exact = new Set();
  const wildcard = new Set();
  const exception = new Set();
  for (const line of source.split('\n')) {
    const rule = line.trim().split(/\s/u, 1)[0];
    if (!rule || rule.startsWith('//')) continue;
    const target = rule.startsWith('!') ? exception : rule.startsWith('*.') ? wildcard : exact;
    const domain = rule.startsWith('!')
      ? rule.slice(1)
      : rule.startsWith('*.')
        ? rule.slice(2)
        : rule;
    target.add(canonicalHostname(domain).hostname);
  }
  return { exact, wildcard, exception };
}

// PRIVATE rules are intentionally included: separate tenants of a hosting
// provider are separate cookie sites, even though they share an ICANN domain.
const rules = loadRules();

function publicSuffixLength(labels) {
  let longest = 1; // The PSL's implicit '*' rule also covers unknown TLDs.
  let exception = 0;
  for (let index = 0; index < labels.length; index += 1) {
    const candidate = labels.slice(index).join('.');
    const length = labels.length - index;
    if (rules.exception.has(candidate)) exception = Math.max(exception, length);
    if (rules.exact.has(candidate)) longest = Math.max(longest, length);
    // A wildcard consumes one actual label; '*.foo' does not itself match 'foo'.
    if (index > 0 && rules.wildcard.has(candidate)) longest = Math.max(longest, length + 1);
  }
  return exception ? exception - 1 : longest;
}

function domainOf(hostname) {
  const labels = hostname.split('.');
  const length = publicSuffixLength(labels);
  return labels.length > length ? labels.slice(-(length + 1)).join('.') : null;
}

// Results are lowercase ASCII (IDNA). As specified by the PSL, a query's final
// dot is preserved. Malformed hostnames and IP literals throw, never match.
function getPublicSuffix(value) {
  const { hostname, trailingDot } = canonicalHostname(value);
  const labels = hostname.split('.');
  return labels.slice(-publicSuffixLength(labels)).join('.') + (trailingDot ? '.' : '');
}

// A public suffix has no registrable domain and returns null.
function getDomain(value) {
  const { hostname, trailingDot } = canonicalHostname(value);
  const domain = domainOf(hostname);
  return domain === null ? null : domain + (trailingDot ? '.' : '');
}

function isPublicSuffix(value) {
  return getDomain(value) === null;
}

// Validate the DNS part of a same-site deployment. The caller must also require
// HTTPS and verify ownership, DNS, and the API's actual cookie configuration.
// cookieParent accepts either 'example.com' or '.example.com'. A cookie parent
// may equal one host or be a proper parent of both; the two hosts must differ.
// Unlike generic PSL queries, deployment hosts reject trailing dots to avoid
// treating dotted and undotted browser sites as interchangeable.
function validateSameSiteHosts(webHostname, apiHostname, cookieParent) {
  const failure =
    'HSM_COOKIE_DOMAIN: distinct same-site web/API hosts and a valid shared cookie parent required';
  let web;
  let api;
  let parent;
  try {
    web = canonicalHostname(webHostname);
    api = canonicalHostname(apiHostname);
    parent = canonicalHostname(
      typeof cookieParent === 'string' && cookieParent.startsWith('.')
        ? cookieParent.slice(1)
        : cookieParent,
    );
  } catch {
    throw new Error(failure);
  }
  const registrableDomain = domainOf(web.hostname);
  const withinParent = (hostname) =>
    hostname === parent.hostname || hostname.endsWith('.' + parent.hostname);
  if (
    web.trailingDot ||
    api.trailingDot ||
    parent.trailingDot ||
    web.hostname === api.hostname ||
    !registrableDomain ||
    domainOf(api.hostname) !== registrableDomain ||
    domainOf(parent.hostname) !== registrableDomain ||
    !withinParent(web.hostname) ||
    !withinParent(api.hostname)
  ) {
    throw new Error(failure);
  }
  return {
    webHostname: web.hostname,
    apiHostname: api.hostname,
    cookieParent: parent.hostname,
    registrableDomain,
  };
}

module.exports = {
  PSL_SNAPSHOT,
  getPublicSuffix,
  getDomain,
  isPublicSuffix,
  validateSameSiteHosts,
};
