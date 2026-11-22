// Invoked only by the gated, real-API PostgreSQL browser integration suite.
// No API routes are intercepted. The parent captures the external sender and
// supplies only synthetic recipient codes through this private IPC channel.
const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

let sequence = 0;
const pending = new Map();
function rpc(kind, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Fixture ${kind} timed out`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
    process.send({ id, kind, payload });
  });
}
process.on('message', async (message) => {
  if (message.reply) {
    const operation = pending.get(message.reply);
    if (!operation) return;
    clearTimeout(operation.timer);
    pending.delete(message.reply);
    if (message.error) operation.reject(new Error(message.error));
    else operation.resolve(message.data);
  } else if (message.kind === 'start') {
    try {
      await run(message.data);
      process.exit(0);
    } catch (error) {
      process.send({ kind: 'failure', error: String(error.stack || error) });
      process.exit(1);
    }
  }
});

async function run(data) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox'],
  });
  const contexts = [];
  const phases = [];
  const pageErrors = [];
  const accessibility = [];
  const mark = (name) => {
    phases.push(name);
    process.send({ kind: 'progress', name });
  };
  const snapshot = (page, name) =>
    page.screenshot({
      path: path.join(data.output, `${name}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  const responseTo = (page, endpoint, method = 'POST') =>
    page.waitForResponse(
      (response) =>
        response.url() === `${data.api}${endpoint}` && response.request().method() === method,
    );
  async function newPage(lang = 'en', width = 390) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    contexts.push(context);
    await context.addInitScript((language) => localStorage.setItem('hsm.lang', language), lang);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', () => pageErrors.push('browser-page-error'));
    return { context, page };
  }
  async function probe(page, endpoint, method = 'GET', body) {
    return page.evaluate(
      async ({ url, method, body }) => {
        const csrf = globalThis.document.cookie.match(/(?:^|;\s*)hsm_csrf=([^;]*)/)?.[1];
        const response = await fetch(url, {
          method,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Kind': 'web',
            ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return {
          status: response.status,
          body: response.status === 204 ? null : await response.json(),
        };
      },
      { url: `${data.api}${endpoint}`, method, body },
    );
  }
  async function noOverflow(page) {
    expect(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
  }
  async function selectedPhone(page, role, lang = 'en') {
    await expect(page.getByTestId(`auth-hero-${role}`)).toBeVisible();
    await expect(page.getByTestId('auth-channel-whatsapp')).toBeVisible();
    await expect(page.locator('input[type="password"], input[type="email"]')).toHaveCount(0);
    await expect(page.locator('a[href*="forgot-password"]')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /forgot password|نسيت كلمة المرور/iu }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^(I have an email account|لدي حساب بريد إلكتروني)$/u }),
    ).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    const accent = { seeker: 'from-amber-500', provider: 'from-blue-600', admin: 'from-slate-700' }[
      role
    ];
    await expect(page.getByTestId(`auth-hero-${role}`)).toHaveClass(new RegExp(accent));
  }
  async function requestPhone(page, role, lang = 'en') {
    const actor = data.actors[role];
    await page.goto(`${data.web}/login?${new URLSearchParams({ returnTo: actor.path })}`);
    await selectedPhone(page, role, lang);
    await page.locator('input[type="tel"]').fill(actor.phone);
    const challengeResponse = responseTo(page, '/v1/auth/login');
    await page
      .getByRole('button', {
        name: lang === 'ar' ? 'إرسال رمز التحقق' : 'Send verification code',
        exact: true,
      })
      .click();
    const response = await challengeResponse;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({ phoneNumber: actor.phone });
    const challenge = await response.json();
    expect(challenge).toMatchObject({
      otpRequired: true,
      channel: 'whatsapp',
      expiresInSeconds: 300,
      codeLength: 6,
    });
    await expect(page.getByTestId('otp-countdown')).toContainText(/0[45]:[0-5][0-9]/u);
    expect((await probe(page, '/v1/auth/me')).status).toBe(401);
    return challenge;
  }
  async function deliveredCode(phone, after = 0) {
    let latest;
    await expect
      .poll(async () => {
        latest = await rpc('code', { phone });
        return latest.count;
      })
      .toBeGreaterThan(after);
    assert.match(latest.code, /^[0-9]{6}$/u);
    return latest;
  }
  async function verify(page, code, expected = 200) {
    await page.getByTestId('otp-input').fill(code);
    const response = responseTo(page, '/v1/auth/verify-otp');
    await page.getByTestId('otp-input').press('Enter');
    expect((await response).status()).toBe(expected);
  }
  try {
    await mkdir(data.output, { recursive: true });
    for (const lang of ['en', 'ar']) {
      const { page } = await newPage(lang);
      for (const [role, actor] of Object.entries(data.actors)) {
        await page.goto(`${data.web}/login?${new URLSearchParams({ returnTo: actor.path })}`);
        await selectedPhone(page, role, lang);
        for (const width of [320, 390, 430, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: 844 });
          await noOverflow(page);
          await snapshot(page, `${role}-${lang}-${width}`);
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => {
        globalThis.document.documentElement.style.zoom = '2';
      });
      await noOverflow(page);
      await snapshot(page, `admin-${lang}-zoom-200`);
    }
    mark('responsive-selected-methods');

    const signedIn = {};
    for (const role of ['seeker', 'provider', 'admin']) {
      const item = await newPage();
      signedIn[role] = item;
      const challenge = await requestPhone(item.page, role);
      const delivered = await deliveredCode(data.actors[role].phone);
      await snapshot(item.page, `${role}-otp`);
      if (role === 'seeker') {
        const result = await new AxeBuilder({ page: item.page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        accessibility.push({
          surface: 'whatsapp-otp',
          violations: result.violations.map(({ id, impact }) => ({ id, impact })),
        });
        expect(
          result.violations.filter((violation) =>
            ['serious', 'critical'].includes(violation.impact),
          ),
        ).toEqual([]);
      }
      await verify(item.page, delivered.code);
      const me = await probe(item.page, '/v1/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.id).toBe(data.actors[role].userId);
      expect(me.body.phoneNumber).toBe(data.actors[role].phone);
      const replay = await probe(item.page, '/v1/auth/verify-otp', 'POST', {
        challengeId: challenge.challengeId,
        code: delivered.code,
      });
      expect(replay.status).toBe(400);
    }
    mark('all-role-phone-only-sessions');

    const expiry = await newPage('ar');
    await expiry.page.clock.install();
    const beforeCount = (await rpc('code', { phone: data.actors.seeker.phone })).count;
    const old = await requestPhone(expiry.page, 'seeker', 'ar');
    await deliveredCode(data.actors.seeker.phone, beforeCount);
    await rpc('expire', { challengeId: old.challengeId });
    await expiry.page.clock.fastForward(301_000);
    await expect(expiry.page.getByTestId('otp-countdown')).toContainText('00:00');
    await expect(
      expiry.page.getByRole('status').filter({ hasText: 'انتهت صلاحية الرمز' }),
    ).toBeVisible();
    await expect(expiry.page.getByTestId('otp-input')).toHaveValue('');
    const requestNewCode = expiry.page.getByRole('button', {
      name: 'طلب رمز جديد',
      exact: true,
    });
    await expect(requestNewCode).toBeEnabled();
    await snapshot(expiry.page, 'seeker-ar-expired');
    const renewed = responseTo(expiry.page, '/v1/auth/login');
    await requestNewCode.click();
    const renewal = await renewed;
    expect(renewal.status()).toBe(200);
    expect(renewal.request().postDataJSON()).toEqual({ phoneNumber: data.actors.seeker.phone });
    expect((await renewal.json()).challengeId).not.toBe(old.challengeId);
    const fresh = await deliveredCode(data.actors.seeker.phone, beforeCount + 1);
    await expect(expiry.page.getByTestId('otp-countdown')).not.toContainText('00:00');
    await verify(expiry.page, fresh.code);
    expect((await probe(expiry.page, '/v1/auth/me')).status).toBe(200);
    mark('expiry-and-fresh-code');

    const admin = signedIn.admin.page;
    await admin.goto(`${data.web}/admin/settings`);
    await expect(admin.locator('input[name="auth-channel"][value="email"]')).toBeEnabled();
    await admin.locator('input[name="auth-channel"][value="email"]').check();
    const saved = responseTo(admin, '/v1/admin/settings', 'PATCH');
    await admin.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect((await saved).status()).toBe(200);
    const evidence = await rpc('policyEvidence');
    expect(evidence.value).toBe('email');
    expect(evidence.history).toBeGreaterThan(0);
    await admin.reload();
    await expect(admin.locator('input[name="auth-channel"][value="email"]')).toBeChecked();
    mark('admin-policy-switch');

    const email = await newPage();
    await email.page.goto(`${data.web}/login`);
    await expect(email.page.getByTestId('auth-channel-email')).toBeVisible();
    await expect(email.page.locator('input[type="tel"]')).toHaveCount(0);
    await expect(email.page.getByTestId('auth-channel-whatsapp')).toHaveCount(0);
    await expect(email.page.locator('input[type="password"]')).toBeVisible();
    expect(
      (await probe(email.page, '/v1/auth/login', 'POST', { phoneNumber: data.actors.seeker.phone }))
        .status,
    ).toBe(400);
    await snapshot(email.page, 'email-selected');
    await email.page.locator('input[type="email"]').fill(data.email);
    await email.page.locator('input[type="password"]').fill(data.password);
    const challenge = responseTo(email.page, '/v1/auth/login');
    await email.page.getByRole('button', { name: 'Log In', exact: true }).click();
    expect((await challenge).status()).toBe(200);
    await verify(email.page, await rpc('emailCode'));
    expect((await probe(email.page, '/v1/auth/me')).status).toBe(200);
    mark('email-method-isolated');
    // OTP submission above uses keyboard Enter against the real code field.
    mark('accessibility-and-keyboard');
    expect(pageErrors).toEqual([]);
    await writeFile(
      path.join(data.output, 'acceptance.json'),
      JSON.stringify(
        {
          evidence: 'REAL_API_REAL_POSTGRES_REAL_REDIS_CAPTURED_EXTERNAL_WHATSAPP',
          providerDelivery: 'SIMULATED_EXTERNAL_BOUNDARY',
          phases,
          accessibility,
          responsive: {
            widths: [320, 390, 430, 768, 1024, 1440],
            languages: ['en', 'ar'],
            brands: ['seeker', 'provider', 'admin'],
            cssZoom: '200%',
          },
          realWhatsAppRecipient: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await browser.close();
  }
}
