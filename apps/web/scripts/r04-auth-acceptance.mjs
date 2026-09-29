import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import pg from 'pg';
import { acceptOfflineLogout, offlineLogoutCheckpoint } from './r04-offline-logout.mjs';

// No developer/live database is an admissible target. These are fixed loopback
// addresses in the separate, disposable GitHub-hosted acceptance job.
const API = 'http://127.0.0.1:4010';
const WEB = 'http://127.0.0.1:4173';
const MAIL = 'http://127.0.0.1:8025';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = path.join(ROOT, 'r04-auth-evidence');
const identity = new URL(process.env.DATABASE_URL || 'postgresql://missing/missing');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Run only in the isolated CI job');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Do not run against a developer host');
assert.equal(process.env.R04_ACCEPTANCE_SCOPE, 'isolated-ci');
assert.ok(['localhost', '127.0.0.1'].includes(identity.hostname));
assert.equal(identity.pathname, '/r04_auth_ci');

const phases = [];
const mailIds = new Set();
const users = [];
const contexts = [];
const errors = [];
let stage = 'initialize';
let browser;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const pwd = randomBytes(24).toString('base64url');
const nextPwd = randomBytes(24).toString('base64url');
async function phase(name, fn) {
  stage = name;
  const start = performance.now();
  await fn();
  phases.push({ name, status: 'PASS', durationMs: Math.round(performance.now() - start) });
  console.log(`PASS ${name}`);
}
async function newPage(width = 390, language = 'en') {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'en-US', serviceWorkers: 'block' });
  contexts.push(context);
  await context.addInitScript((lang) => localStorage.setItem('hsm.lang', lang), language);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', () => errors.push('browser-page-error'));
  return { context, page };
}
async function call(page, endpoint, body, csrf = true) {
  return page.evaluate(async ({ api, endpoint, body, csrf }) => {
    const token = globalThis.document.cookie.match(/(?:^|;\s*)hsm_csrf=([^;]*)/)?.[1];
    const response = await fetch(`${api}${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'include',
      headers: { 'X-Client-Kind': 'web', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(csrf && token ? { 'X-CSRF-Token': token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { api: API, endpoint, body, csrf });
}
async function message(address, kind = 'code') {
  let text;
  await expect.poll(async () => {
    const response = await fetch(`${MAIL}/api/v1/messages?limit=100`);
    if (!response.ok) return false;
    const { messages } = await response.json();
    for (const mail of messages ?? []) {
      if (mailIds.has(mail.ID) || !mail.To?.some((entry) => entry.Address === address)) continue;
      const detail = await (await fetch(`${MAIL}/api/v1/message/${encodeURIComponent(mail.ID)}`)).json();
      const candidate = detail.Text ?? '';
      if (kind === 'code' ? /code is \d{6}/u.test(candidate) : candidate.includes(`/${kind}?token=`)) {
        mailIds.add(mail.ID); text = candidate; return true;
      }
    }
    return false;
  }, { timeout: 30000, intervals: [200, 500, 1000], message: 'The real SMTP message must arrive' }).toBe(true);
  return text;
}
async function code(address) {
  const value = /code is (\d{6})/u.exec(await message(address))?.[1];
  assert.ok(value, 'Expected SMTP code'); return value;
}
async function link(address, kind) {
  const value = new RegExp(`http://127\\.0\\.0\\.1:4173/${kind}\\?token=[A-Za-z0-9_-]+`, 'u').exec(await message(address, kind))?.[0];
  assert.ok(value, 'Expected local SMTP link'); return value;
}
async function submitOtp(page, value, expected = 200) {
  await page.getByTestId('otp-input').fill(value);
  const response = page.waitForResponse((r) => r.url() === `${API}/v1/auth/verify-otp` && r.request().method() === 'POST');
  await page.getByTestId('otp-input').press('Enter');
  assert.equal((await response).status(), expected, 'OTP HTTP status');
}
async function signIn(page, address, password = pwd) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Email Address', { exact: true }).fill(address);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const response = page.waitForResponse((r) => r.url() === `${API}/v1/auth/login` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  assert.equal((await response).status(), 200, 'Login challenge status');
  await submitOtp(page, await code(address));
  await expect.poll(async () => (await call(page, '/v1/auth/me')).status).toBe(200);
}
async function prepareLogout(page) {
  await page.goto(`${WEB}/home/profile`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).first().click();
}
async function ownUser(address) {
  const result = await db.query('SELECT "id", "status", "emailVerifiedAt" FROM "User" WHERE "email" = $1', [address]);
  assert.equal(result.rows.length, 1, 'Fixture account exists');
  const user = result.rows[0];
  if (!users.includes(user.id)) users.push(user.id);
  return user;
}
try {
  await mkdir(OUT, { recursive: true });
  await db.connect();
  browser = await chromium.launch();
  const a = await newPage(390);
  const addressA = `r04-${randomUUID()}@example.test`;
  let challenge;
  let originalCode;
  let userA;
  await phase('register-real-ui-and-smtp-without-premature-session', async () => {
    await a.page.goto(`${WEB}/home/profile?from=r04#details`);
    await expect(a.page).toHaveURL(/\/login$/u);
    await a.page.getByRole('button', { name: 'Sign Up', exact: true }).click();
    await a.page.getByLabel('Full Name', { exact: true }).fill('R04 Customer');
    await a.page.locator('input[type="tel"]').fill('701234567');
    await a.page.getByRole('button', { name: 'Next', exact: true }).click();
    await a.page.getByLabel('Email Address', { exact: true }).fill(addressA);
    await a.page.getByLabel('Password', { exact: true }).fill(pwd);
    await a.page.getByRole('button', { name: /I agree to the/u }).click();
    const response = a.page.waitForResponse((r) => r.url() === `${API}/v1/auth/register` && r.request().method() === 'POST');
    await a.page.getByRole('button', { name: 'Create Account', exact: true }).click();
    const result = await response;
    assert.equal(result.status(), 202); challenge = (await result.json()).challengeId;
    originalCode = await code(addressA);
    userA = await ownUser(addressA);
    assert.equal(userA.status, 'PENDING_VERIFICATION');
    assert.equal((await call(a.page, '/v1/auth/me')).status, 401);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "Session" WHERE "userId"=$1', [userA.id])).rows[0].n, 0);
  });
  await phase('wrong-code-is-durable-resend-rotates-and-confirm-preserves-return-target', async () => {
    await submitOtp(a.page, originalCode === '000000' ? '111111' : '000000', 400);
    await expect(a.page.getByRole('alert')).toContainText('Incorrect code');
    assert.equal((await db.query('SELECT "attemptCount" FROM "VerificationToken" WHERE "challengeId"=$1', [challenge])).rows[0].attemptCount, 1);
    const resend = a.page.waitForResponse((r) => r.url() === `${API}/v1/auth/resend-otp` && r.request().method() === 'POST');
    await a.page.getByRole('button', { name: 'Resend code', exact: true }).click();
    assert.equal((await resend).status(), 202);
    const rotated = await code(addressA); assert.notEqual(rotated, originalCode);
    await submitOtp(a.page, rotated);
    await expect(a.page).toHaveURL(`${WEB}/home/profile?from=r04#details`);
    assert.equal((await call(a.page, '/v1/auth/verify-otp', { challengeId: challenge, code: rotated })).status, 400);
    const me = (await call(a.page, '/v1/auth/me')).body;
    assert.equal(me.id, userA.id); assert.deepEqual(me.roles, ['customer']);
    await a.page.screenshot({ path: path.join(OUT, 'customer-after-verification.png'), fullPage: true });
  });
  await phase('browser-cookie-csrf-and-server-refresh-rotation', async () => {
    const cookies = await a.context.cookies();
    const access = cookies.find((c) => c.name === 'hsm_at');
    const refresh = cookies.find((c) => c.name === 'hsm_rt');
    assert.ok(access?.httpOnly && refresh?.httpOnly);
    assert.equal(refresh.path, '/v1/auth/refresh');
    const visible = await a.page.evaluate(() => globalThis.document.cookie);
    assert.ok(!visible.includes('hsm_at=') && !visible.includes('hsm_rt='));
    assert.equal((await call(a.page, '/v1/auth/refresh', {}, false)).status, 400);
    assert.equal((await call(a.page, '/v1/auth/logout', {}, false)).status, 403);
    assert.equal((await call(a.page, '/v1/auth/refresh', {})).status, 200);
    const next = (await a.context.cookies()).find((c) => c.name === 'hsm_rt');
    assert.ok(next && next.value !== refresh.value);
  });
  const peer = await a.context.newPage();
  await phase('offline-local-logout-clears-two-tabs-and-does-not-auto-restore', () =>
    acceptOfflineLogout({ ...a, peer, web: WEB, api: API, prepareLogout }));
  await phase('recovery-through-real-mail-revokes-pending-codes-and-every-previous-session', async () => {
    await signIn(a.page, addressA);
    const oldChallenge = await call(a.page, '/v1/auth/login', { email: addressA, password: pwd });
    assert.equal(oldChallenge.status, 200);
    const pendingCode = await code(addressA);
    const resetContext = await newPage();
    await resetContext.page.goto(`${WEB}/forgot-password`);
    await resetContext.page.getByLabel('Email Address', { exact: true }).fill(addressA);
    await resetContext.page.getByRole('button', { name: 'Send Reset Link', exact: true }).click();
    await expect(resetContext.page.getByText(/Request received/u)).toBeVisible();
    const resetLink = await link(addressA, 'reset-password');
    await resetContext.page.goto(resetLink);
    await resetContext.page.getByLabel('New password', { exact: true }).fill(nextPwd);
    await resetContext.page.getByLabel('Confirm password', { exact: true }).fill(nextPwd);
    const response = resetContext.page.waitForResponse((r) => r.url() === `${API}/v1/auth/reset-password` && r.request().method() === 'POST');
    await resetContext.page.getByRole('button', { name: 'Update password', exact: true }).click();
    assert.equal((await response).status(), 200);
    await expect(resetContext.page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
    assert.equal((await call(a.page, '/v1/auth/verify-otp', { challengeId: oldChallenge.body.challengeId, code: pendingCode })).status, 400);
    assert.equal((await call(a.page, '/v1/auth/reset-password', { token: new URL(resetLink).searchParams.get('token'), newPassword: pwd })).status, 400);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "Session" WHERE "userId"=$1 AND "revokedAt" IS NULL', [userA.id])).rows[0].n, 0);
    await a.page.reload();
    await expect(a.page).toHaveURL(/\/login$/u);
    await signIn(a.page, addressA, nextPwd);
  });
  await phase('cold-verification-recovery-and-arabic-narrow-viewport', async () => {
    const b = await newPage(320, 'ar');
    const address = `r04-${randomUUID()}@example.test`;
    await b.page.goto(`${WEB}/signup`);
    const result = await call(b.page, '/v1/auth/register', { email: address, password: pwd, firstName: 'R04', lastName: 'Recovery' });
    assert.equal(result.status, 202); await ownUser(address); await code(address);
    await b.page.goto(`${WEB}/check-email`);
    await b.page.getByLabel('البريد الإلكتروني', { exact: true }).fill(address);
    await b.page.getByRole('button', { name: 'طلب رابط تحقق', exact: true }).click();
    await expect(b.page.getByRole('status')).toContainText('تم استلام الطلب');
    const target = await link(address, 'verify-email');
    await b.page.goto(target);
    await expect(b.page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
    assert.equal((await call(b.page, '/v1/auth/me')).status, 401);
    const size = await b.page.evaluate(() => ({ width: globalThis.document.documentElement.clientWidth, content: globalThis.document.documentElement.scrollWidth }));
    assert.ok(size.content <= size.width + 1, 'No horizontal overflow at 320px');
    await b.page.screenshot({ path: path.join(OUT, 'arabic-link-recovery-320.png'), fullPage: true });
  });
  await phase('roles-are-server-provisioned-and-all-three-roles-use-real-otp-login', async () => {
    // Only fixture accounts in this isolated database are provisioned; the public
    // registration endpoint never receives a role field or grants administrator access.
    for (const role of ['provider', 'admin']) {
      const c = await newPage(1280);
      const address = `r04-${randomUUID()}@example.test`;
      await c.page.goto(`${WEB}/login`);
      const response = await call(c.page, '/v1/auth/register', { email: address, password: pwd, firstName: 'R04', lastName: role });
      assert.equal(response.status, 202);
      const user = await ownUser(address);
      assert.equal((await call(c.page, '/v1/auth/verify-otp', { challengeId: response.body.challengeId, code: await code(address) })).status, 200);
      await db.query('INSERT INTO "UserRole" ("userId","roleId") SELECT $1,"id" FROM "Role" WHERE "name"=$2 ON CONFLICT DO NOTHING', [user.id, role]);
      assert.equal((await call(c.page, '/v1/auth/logout', {})).status, 204);
      await signIn(c.page, address);
      const me = (await call(c.page, '/v1/auth/me')).body;
      assert.ok(me.roles.includes(role));
      await c.page.goto(`${WEB}/${role === 'admin' ? 'admin' : 'provider'}`);
      await expect(c.page).not.toHaveURL(/\/login$/u);
      assert.equal((await call(c.page, '/v1/auth/logout', {})).status, 204);
      await c.page.reload();
      await expect(c.page).toHaveURL(/\/login$/u);
    }
  });
  assert.equal(errors.length, 0, 'No browser page errors');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify({ sourceSha: sha, result: 'PASS', environment: 'isolated-ci-real-http-smtp-postgres-chromium', phases, noApiResponseMocks: true, liveStagingAccepted: false }, null, 2));
} catch (error) {
  // Never upload mailbox content, cookie jars, passwords, OTPs, traces or raw API logs.
  console.error(`FAIL R04 stage: ${stage}; ${error?.name ?? 'Error'}`);
  await writeFile(path.join(OUT, 'failure.json'), JSON.stringify({ result: 'FAIL', stage, completed: phases.map((p) => p.name), logoutCheckpoint: offlineLogoutCheckpoint(), codeLocation: /r04-[a-z-]+\.mjs:\d+:\d+/u.exec(error?.stack ?? '')?.[0] ?? null })).catch(() => undefined);
  process.exitCode = 1;
} finally {
  for (const context of contexts) await context.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  // Only identities created by this process are eligible for cleanup. Never TRUNCATE.
  if (users.length) {
    for (const table of ['AuditEvent', 'Session', 'VerificationToken', 'UserRole']) {
      await db.query(`DELETE FROM "${table}" WHERE "userId" = ANY($1::text[])`, [users]).catch(() => { process.exitCode = 1; });
    }
    await db.query('DELETE FROM "User" WHERE "id" = ANY($1::text[])', [users]).catch(() => { process.exitCode = 1; });
  }
  await db.end();
}
