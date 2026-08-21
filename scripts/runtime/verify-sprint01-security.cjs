#!/usr/bin/env node
'use strict';

// Sprint 01 remediation — runtime security proof harness.
//
// Drives TWO live API instances (production mode) against real Postgres, Redis,
// Mongo and an SMTP sink, and produces sanitized evidence for every mandatory
// security scenario in the remediation brief:
//
//   D-1   registration rate limiting, including the cross-instance aggregate
//   D-2   immediate access-token revocation (logout / logout-all / password
//         reset / global suspension / refresh rotation)
//   D-4   WebSocket handshake authorization and post-connection eviction
//   Admin the AdminAccessRequest lifecycle and admin-endpoint authorization
//   Prov. the DRAFT → submit → PENDING_REVIEW → ACTIVE lifecycle and gating
//   Cust. customer capabilities and the boundaries around them
//   IDOR  cross-user resource access
//
// ── Output contract ──────────────────────────────────────────────────────────
// Nothing secret is ever printed. Tokens, cookies, passwords, OTP codes, reset
// tokens, and hashes are replaced with a stable placeholder before anything
// reaches stdout or the JSON report — see `redact()`. The report records
// method, path, status, and the error CODE, which is all the evidence a
// reviewer needs and none of the material an attacker would want.
//
// Usage:
//   node scripts/runtime/verify-sprint01-security.cjs \
//     --a http://localhost:4010 --b http://localhost:4011 \
//     --mailpit http://localhost:8025 --out report.json

const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');

// ─── configuration ───────────────────────────────────────────────────────────

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const A = arg('a', 'http://localhost:4010');
const B = arg('b', 'http://localhost:4011');
const MAILPIT = arg('mailpit', 'http://localhost:8025');
const OUT = arg('out', path.join(process.cwd(), 'sprint01-security-report.json'));

// One password for every harness account. Never printed; `redact()` scrubs it
// from anything that would be written out.
const PASSWORD = 'Harness!Passw0rd-2026';
const RUN = `${Date.now().toString(36)}-${process.pid.toString(36)}`;

// ─── redaction ───────────────────────────────────────────────────────────────

const SECRET_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'resettoken',
  'otp',
  'hash',
  'passwordhash',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'hsm_at',
  'hsm_rt',
  'hsm_csrf',
]);

const REDACTED = '<redacted>';

// Deep-redact any structure before it can be printed or serialised. Keys are
// matched case-insensitively; JWT-shaped and long opaque strings are scrubbed
// even under an unexpected key name, so a rename cannot leak material.
function redact(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? REDACTED : redact(v);
  }
  return out;
}

function redactString(s) {
  if (s === PASSWORD) return REDACTED;
  // OTP codes are six digits. Matched by SHAPE rather than by the key name
  // `code`, because `code` is also where the stable error codes live — and
  // those codes ARE the evidence these proofs are built on.
  if (/^d{6}$/.test(s)) return REDACTED;
  // JWT
  if (/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(s)) return REDACTED;
  // Long opaque token (refresh / reset / csrf)
  if (/^[A-Za-z0-9_-]{32,}$/.test(s)) return REDACTED;
  return s.split(PASSWORD).join(REDACTED);
}

// ─── report ──────────────────────────────────────────────────────────────────

const results = [];
let currentSection = 'general';

function section(name) {
  currentSection = name;
  console.log(`\n=== ${name} ===`);
}

function record(name, passed, evidence) {
  results.push({ section: currentSection, name, passed, evidence: redact(evidence ?? {}) });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}`);
  if (!passed) console.log(`        evidence: ${JSON.stringify(redact(evidence ?? {}))}`);
}

// `expect`-style helper that never throws the run away: a failed proof is
// recorded and the harness continues, so one failure does not hide the rest.
function check(name, condition, evidence) {
  record(name, Boolean(condition), evidence);
  return Boolean(condition);
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

// A minimal cookie jar per simulated client. Cookie VALUES are held in memory
// and never logged.
class Client {
  constructor(baseUrl, label) {
    this.baseUrl = baseUrl;
    this.label = label;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  csrf() {
    return this.cookies.get('hsm_csrf');
  }

  absorb(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '' || /Expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  // Snapshot the current credential set so a later "is the OLD token still
  // accepted?" probe can replay exactly what was issued before a revocation.
  snapshot() {
    return new Map(this.cookies);
  }

  restore(snap) {
    this.cookies = new Map(snap);
  }

  async request(method, pathname, body, opts = {}) {
    const headers = { 'content-type': 'application/json' };
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    const csrf = this.csrf();
    if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
    Object.assign(headers, opts.headers ?? {});

    const res = await fetch(`${opts.baseUrl ?? this.baseUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    if (opts.absorb !== false) this.absorb(res);

    let payload = null;
    const text = await res.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 200) };
      }
    }
    return {
      status: res.status,
      body: payload,
      code: payload?.error?.code ?? null,
      retryAfter: res.headers.get('retry-after'),
    };
  }

  get(p, o) {
    return this.request('GET', p, undefined, o);
  }
  post(p, b, o) {
    return this.request('POST', p, b, o);
  }
  patch(p, b, o) {
    return this.request('PATCH', p, b, o);
  }
}

// ─── mail (OTP retrieval) ────────────────────────────────────────────────────

// The API sends OTP codes and reset links by email. Reading them back from the
// SMTP sink keeps AUTH_REQUIRE_EMAIL_VERIFICATION=true for the whole run — the
// harness proves the real flow instead of a weakened one.
async function latestMailFor(address, matcher, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const res = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    if (res.ok) {
      const data = await res.json();
      for (const message of data.messages ?? []) {
        const full = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`);
        if (!full.ok) continue;
        const detail = await full.json();
        const text = `${detail.Subject ?? ''}\n${detail.Text ?? ''}`;
        const hit = matcher(text);
        if (hit) {
          await fetch(`${MAILPIT}/api/v1/messages`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ IDs: [message.ID] }),
          });
          return hit;
        }
      }
    }
    await sleep(250);
  }
  throw new Error(`no matching mail for ${address} after ${attempts} attempts`);
}

const otpFrom = (text) => text.match(/\b(\d{6})\b/)?.[1] ?? null;
const resetTokenFrom = (text) => text.match(/token=([A-Za-z0-9_-]+)/)?.[1] ?? null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── rate-limit isolation ────────────────────────────────────────────────────
//
// Every harness client talks to the API over loopback, so they ALL share one
// registration IP bucket — and the production budget is five per hour. Without
// isolation, the first scenario to create accounts would exhaust the budget and
// every later scenario would fail for the wrong reason.
//
// So the counters are cleared between scenario groups. This is TIME TRAVEL, not
// a bypass: it is exactly equivalent to the rolling window elapsing, the limit
// itself is never raised, the API is never reconfigured, and the D-1 scenario
// deliberately runs its six-attempt sequence with NO reset in the middle — that
// sequence is the actual proof.
let redisClient = null;
async function resetRateLimits() {
  if (!redisClient) {
    // ioredis is resolved from the API package: this harness lives at the repo
    // root, which has no direct Redis dependency.
    const Redis = require(path.resolve(__dirname, '../../apps/api/node_modules/ioredis'));
    redisClient = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      maxRetriesPerRequest: 3,
    });
  }
  const keys = await redisClient.keys('rl:*');
  if (keys.length > 0) await redisClient.del(...keys);
}

async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

// ─── account helpers ─────────────────────────────────────────────────────────

let accountSeq = 0;
function nextEmail(prefix) {
  accountSeq += 1;
  return `${prefix}-${RUN}-${accountSeq}@harness.local`;
}

// Full real signup: register → OTP → verify → login → OTP → session cookies.
async function signUpAndLogin(baseUrl, prefix, label) {
  const email = nextEmail(prefix);
  const client = new Client(baseUrl, label);

  // See resetRateLimits(): every harness client shares one loopback bucket, so
  // account setup for a scenario would otherwise be throttled by the previous
  // scenario's setup. D-1's own sequence never calls this mid-run.
  await resetRateLimits();

  const reg = await client.post('/v1/auth/register', {
    email,
    password: PASSWORD,
    firstName: 'Test',
    lastName: prefix,
  });
  if (reg.status !== 202) throw new Error(`register failed for ${label}: ${reg.status}`);

  const code = await latestMailFor(email, otpFrom);
  const verified = await client.post('/v1/auth/verify-otp', {
    challengeId: reg.body.challengeId,
    code,
  });
  if (verified.status !== 200)
    throw new Error(`verify-otp failed for ${label}: ${verified.status}`);

  return { email, client };
}

// Log an already-registered identity in again (a second device / session).
async function loginExisting(baseUrl, email, label) {
  const client = new Client(baseUrl, label);
  const login = await client.post('/v1/auth/login', { email, password: PASSWORD });
  if (login.status !== 200) throw new Error(`login failed for ${label}: ${login.status}`);
  const code = await latestMailFor(email, otpFrom);
  const verified = await client.post('/v1/auth/verify-otp', {
    challengeId: login.body.challengeId,
    code,
  });
  if (verified.status !== 200)
    throw new Error(`verify-otp failed for ${label}: ${verified.status}`);
  return client;
}

// ─── websocket helper ────────────────────────────────────────────────────────

// Opens a socket using the client's cookie jar, exactly as the browser does.
// Resolves with the outcome rather than throwing so both the accept and the
// reject path are observable.
function openSocket(baseUrl, client, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const socket = io(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie: client.cookieHeader() },
      reconnection: false,
      timeout: timeoutMs,
    });

    const done = (outcome) => {
      clearTimeout(timer);
      resolve({ ...outcome, socket });
    };
    const timer = setTimeout(() => done({ result: 'timeout' }), timeoutMs);

    socket.on('connection.ack', (ack) => done({ result: 'accepted', rooms: ack.joinedRooms }));
    socket.on('error', (payload) => done({ result: 'rejected', code: payload?.code ?? null }));
    socket.on('connect_error', (err) => done({ result: 'connect_error', code: err?.message }));
  });
}

// Waits for an already-connected socket to be torn down by the server.
function awaitDisconnect(socket, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (socket.disconnected) return resolve(true);
    const timer = setTimeout(() => resolve(false), timeoutMs);
    socket.on('disconnect', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

module.exports = {
  Client,
  check,
  record,
  section,
  results,
  redact,
  signUpAndLogin,
  loginExisting,
  latestMailFor,
  otpFrom,
  resetTokenFrom,
  openSocket,
  awaitDisconnect,
  sleep,
  nextEmail,
  A,
  B,
  OUT,
  PASSWORD,
  RUN,
  resetRateLimits,
  closeRedis,
};

// The scenarios live in a sibling module so this file stays the harness
// (transport, redaction, reporting) and that one stays the proofs.
if (require.main === module) {
  const scenarios = require('./sprint01-scenarios.cjs');
  scenarios
    .run(module.exports)
    .then(async () => {
      await closeRedis();
      const failed = results.filter((r) => !r.passed);
      const report = {
        generatedAt: new Date().toISOString(),
        instances: { a: A, b: B },
        total: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
        results,
      };
      fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
      console.log(`\n${'='.repeat(72)}`);
      console.log(`Scenarios: ${report.passed}/${report.total} passed`);
      console.log(`Report written to ${OUT}`);
      if (failed.length > 0) {
        console.log('\nFAILED:');
        for (const f of failed) console.log(`  - [${f.section}] ${f.name}`);
      }
      process.exit(failed.length === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error(`\nHarness aborted: ${redactString(String(err?.message ?? err))}`);
      console.error(err?.stack ? redactString(err.stack) : '');
      process.exit(2);
    });
}
