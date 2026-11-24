// Invoked only by the gated, real-API PostgreSQL browser integration suite.
// Only failed/delayed public configuration reads are intercepted to exercise
// presentation recovery. Their successful retries, policy writes, authentication
// and persistence use the actual API. The parent captures the external sender
// and supplies synthetic recipient codes through this private IPC channel.
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
  const configurationRecovery = [];
  const signupRecovery = [];
  const restoredSignupRecovery = [];
  let signupPosts = 0;
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
      locale: 'en-US',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    contexts.push(context);
    await context.addInitScript((language) => localStorage.setItem('hsm.lang', language), lang);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', () => pageErrors.push('browser-page-error'));
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url() === `${data.api}/v1/auth/register`)
        signupPosts += 1;
    });
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
  const policyCopy = (lang) =>
    lang === 'ar'
      ? {
          pending: 'جارٍ تجهيز تسجيل الدخول…',
          unavailable: 'خدمة تسجيل الدخول غير متاحة مؤقتًا. يرجى إعادة المحاولة بعد قليل.',
          retry: 'إعادة المحاولة',
          send: 'إرسال رمز التحقق',
        }
      : {
          pending: 'Preparing secure sign in…',
          unavailable: 'The sign-in service is temporarily unavailable. Please try again shortly.',
          retry: 'Try again',
          send: 'Send verification code',
        };
  async function interruptConfiguration(page, hold = false) {
    let release;
    const barrier = new Promise((resolve) => {
      release = resolve;
    });
    if (!hold) release();
    let requests = 0;
    const credentialPosts = [];
    const recordPost = (request) => {
      if (
        request.method() === 'POST' &&
        ['/v1/auth/login', '/v1/auth/register', '/v1/auth/verify-otp', '/v1/auth/resend-otp'].some(
          (endpoint) => request.url() === `${data.api}${endpoint}`,
        )
      )
        credentialPosts.push(request.url());
    };
    const handler = async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      requests += 1;
      await barrier;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': data.web,
          'access-control-allow-credentials': 'true',
          'cache-control': 'no-store',
        },
        body: JSON.stringify({ error: { code: 'DEPENDENCY_UNAVAILABLE' } }),
      });
    };
    page.on('request', recordPost);
    await page.route(`${data.api}/v1/auth/config`, handler);
    return {
      release,
      requestCount: () => requests,
      credentialPosts,
      restore: async () => {
        release();
        await page.unroute(`${data.api}/v1/auth/config`, handler);
      },
      dispose: async () => {
        release();
        await page.unroute(`${data.api}/v1/auth/config`, handler);
        page.off('request', recordPost);
      },
    };
  }
  async function assertActualPolicy(response, channel) {
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.json()).toEqual({ otpChannel: channel, whatsappAvailable: true });
  }
  async function retryActualPolicy(page, lang, channel, interruption) {
    // Only the failure was intercepted. The keyboard retry must read the
    // actual controller and persisted setting after removing that interception.
    await interruption.restore();
    const recovered = responseTo(page, '/v1/auth/config', 'GET');
    const retry = page.getByRole('button', { name: policyCopy(lang).retry, exact: true });
    await retry.focus();
    await expect(retry).toBeFocused();
    await page.keyboard.press('Enter');
    await assertActualPolicy(await recovered, channel);
  }
  async function recoverInitialPolicy(page, role, lang, channel = 'whatsapp') {
    const copy = policyCopy(lang);
    const interruption = await interruptConfiguration(page, true);
    try {
      await page.goto(
        `${data.web}/login?${new URLSearchParams({ returnTo: data.actors[role].path })}`,
      );
      await expect.poll(interruption.requestCount).toBeGreaterThan(0);
      await selectedPhone(page, role, lang);
      await expect(page.getByRole('status').filter({ hasText: copy.pending })).toBeVisible();
      await expect(page.getByTestId('dial-code-select')).toHaveValue('US');
      await expect(page.getByTestId('selected-country-flag')).toHaveAttribute('data-country', 'US');
      const phone = page.locator('input[type="tel"]');
      const send = page.getByRole('button', { name: copy.send, exact: true });
      await expect(phone).toBeEditable();
      await phone.fill(data.actors[role].phone);
      await phone.press('Enter');
      await expect(send).toBeDisabled();
      expect(interruption.credentialPosts).toEqual([]);
      await snapshot(page, `${role}-${lang}-${channel}-policy-pending`);

      interruption.release();
      await expect(page.getByRole('alert').filter({ hasText: copy.unavailable })).toBeVisible();
      await expect(phone).toHaveValue(data.actors[role].phone);
      await expect(send).toBeDisabled();
      await phone.press('Enter');
      expect(interruption.credentialPosts).toEqual([]);
      if (channel === 'whatsapp') {
        for (const width of [320, 390, 430, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: 844 });
          await noOverflow(page);
          await snapshot(page, `${role}-${lang}-policy-unavailable-${width}`);
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.evaluate(() => {
          globalThis.document.documentElement.style.zoom = '2';
        });
        await noOverflow(page);
        await snapshot(page, `${role}-${lang}-policy-unavailable-zoom-200`);
        await page.evaluate(() => {
          globalThis.document.documentElement.style.zoom = '';
        });
      } else {
        await noOverflow(page);
        await snapshot(page, `${role}-${lang}-saved-email-policy-unavailable`);
      }

      await retryActualPolicy(page, lang, channel, interruption);
      await expect(page.getByRole('alert').filter({ hasText: copy.unavailable })).toHaveCount(0);
      if (channel === 'whatsapp') {
        await selectedPhone(page, role, lang);
        await expect(phone).toHaveValue(data.actors[role].phone);
        await expect(send).toBeEnabled();
      } else {
        await expect(page.getByTestId(`auth-hero-${role}`)).toBeVisible();
        await expect(page.getByTestId('auth-channel-email')).toBeVisible();
        await expect(page.locator('input[type="tel"]')).toHaveCount(0);
        await expect(page.locator('input[type="email"]')).toBeEditable();
        await expect(page.locator('input[type="password"]')).toBeEditable();
        await snapshot(page, `${role}-${lang}-saved-email-policy-recovered`);
      }
      expect(interruption.credentialPosts).toEqual([]);
      configurationRecovery.push({
        role,
        language: lang,
        initialFailure: 'INTERCEPTED_PUBLIC_CONFIG_503',
        recoveredPolicy: channel,
        successfulRead: 'ACTUAL_API_AND_POSTGRES',
        credentialPostsBeforeConfirmation: 0,
      });
    } finally {
      await interruption.dispose();
    }
  }
  async function recoverSignupPolicy(page, role, lang) {
    const copy = policyCopy(lang);
    const fullName = lang === 'ar' ? 'نورة أحمد' : 'Noura Ahmad';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `${data.web}/login?${new URLSearchParams({ returnTo: data.actors[role].path })}`,
    );
    await selectedPhone(page, role, lang);
    await expect(page.getByRole('button', { name: copy.send, exact: true })).toBeEnabled();
    await page.evaluate(() => sessionStorage.removeItem('hsm.signup.draft.v1'));
    const interruption = await interruptConfiguration(page, true);
    try {
      // Follow the real branded entry point. Its cached successful login policy
      // cannot authorize the newly mounted signup form before a fresh response.
      await page
        .getByRole('button', { name: lang === 'ar' ? 'إنشاء حساب' : 'Sign Up', exact: true })
        .click();
      await expect(page).toHaveURL(`${data.web}/signup`);
      await expect.poll(interruption.requestCount).toBeGreaterThan(0);
      await expect(page.getByRole('status').filter({ hasText: copy.pending })).toBeVisible();
      await expect(page.getByTestId('auth-channel-whatsapp')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      const name = page.getByLabel(lang === 'ar' ? 'الاسم الكامل' : 'Full Name', { exact: true });
      const phone = page.locator('input[type="tel"]');
      const next = page.getByRole('button', {
        name: lang === 'ar' ? 'التالي' : 'Next',
        exact: true,
      });
      await expect(name).toBeEditable();
      await expect(phone).toBeEditable();
      await expect(page.getByTestId('dial-code-select')).toHaveValue('US');
      await name.fill(fullName);
      await phone.fill(data.actors[role].phone);
      await phone.press('Enter');
      await expect(next).toBeDisabled();
      expect(interruption.credentialPosts).toEqual([]);
      await snapshot(page, `signup-${role}-${lang}-policy-pending`);

      interruption.release();
      const unavailable = page.getByRole('alert').filter({ hasText: copy.unavailable });
      await expect(unavailable).toBeVisible();
      await expect(name).toHaveValue(fullName);
      await expect(phone).toHaveValue(data.actors[role].phone);
      await expect(next).toBeDisabled();
      for (const width of [320, 390, 430, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await noOverflow(page);
        if (width === 320 || width === 390) {
          await unavailable.scrollIntoViewIfNeeded();
          await snapshot(page, `signup-${role}-${lang}-policy-unavailable-${width}`);
          await phone.scrollIntoViewIfNeeded();
          await expect(phone).toBeInViewport();
          await expect(next).toBeInViewport();
          await snapshot(page, `signup-${role}-${lang}-policy-unavailable-fields-${width}`);
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => {
        globalThis.document.documentElement.style.zoom = '2';
      });
      await noOverflow(page);
      await unavailable.scrollIntoViewIfNeeded();
      await snapshot(page, `signup-${role}-${lang}-policy-unavailable-zoom-200`);
      await page.evaluate(() => {
        globalThis.document.documentElement.style.zoom = '';
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await retryActualPolicy(page, lang, 'whatsapp', interruption);
      await expect(unavailable).toHaveCount(0);
      await expect(name).toHaveValue(fullName);
      await expect(phone).toHaveValue(data.actors[role].phone);
      await expect(next).toBeEnabled();
      expect(interruption.credentialPosts).toEqual([]);
      await phone.scrollIntoViewIfNeeded();
      await snapshot(page, `signup-${role}-${lang}-policy-recovered`);
      signupRecovery.push({
        brand: role,
        language: lang,
        initialFailure: 'INTERCEPTED_PUBLIC_CONFIG_503',
        successfulRead: 'ACTUAL_API_AND_POSTGRES_AFTER_UNROUTE',
        signupPosts: 0,
      });
    } finally {
      await interruption.dispose();
    }

    if (role !== 'seeker') return;
    // Use the actual draft writer by advancing normally, then reload. Neither
    // password nor legal acceptance may survive that restoration.
    await page
      .getByRole('button', { name: lang === 'ar' ? 'التالي' : 'Next', exact: true })
      .click();
    const password = page.locator('input[type="password"]');
    const consent = page.getByRole('checkbox');
    const create = page.getByRole('button', {
      name: lang === 'ar' ? 'إنشاء الحساب' : 'Create Account',
      exact: true,
    });
    const syntheticPassword = 'Signup-view-fixture-2026';
    await expect(password).toHaveValue('');
    await password.fill(syntheticPassword);
    await expect(consent).toBeEnabled();
    await consent.check();
    await expect(create).toBeEnabled();
    const draft = await page.evaluate(() => sessionStorage.getItem('hsm.signup.draft.v1'));
    expect(JSON.parse(draft).step).toBe(2);
    expect(draft).not.toContain(syntheticPassword);

    const restored = await interruptConfiguration(page, true);
    try {
      await page.reload();
      await expect.poll(restored.requestCount).toBeGreaterThan(0);
      await expect(page.getByRole('status').filter({ hasText: copy.pending })).toBeVisible();
      await expect(password).toHaveValue('');
      await expect(consent).not.toBeChecked();
      await expect(create).toBeDisabled();
      await password.fill(syntheticPassword);
      await expect(consent).toBeEnabled();
      await consent.check();
      await expect(create).toBeDisabled();
      await snapshot(page, `signup-seeker-${lang}-restored-step-two-pending`);
      restored.release();
      const unavailable = page.getByRole('alert').filter({ hasText: copy.unavailable });
      await expect(unavailable).toBeVisible();
      await expect(password).toHaveValue(syntheticPassword);
      await expect(consent).toBeChecked();
      await expect(create).toBeDisabled();
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await noOverflow(page);
        await unavailable.scrollIntoViewIfNeeded();
        await snapshot(page, `signup-seeker-${lang}-restored-step-two-unavailable-${width}`);
      }
      await retryActualPolicy(page, lang, 'whatsapp', restored);
      await expect(password).toHaveValue(syntheticPassword);
      await expect(consent).toBeChecked();
      await expect(create).toBeEnabled();
      await consent.uncheck();
      await expect(create).toBeDisabled();
      await consent.check();
      await password.fill('short');
      await expect(create).toBeDisabled();
      await password.fill(syntheticPassword);
      await expect(create).toBeEnabled();
      expect(restored.credentialPosts).toEqual([]);
      await snapshot(page, `signup-seeker-${lang}-restored-step-two-recovered`);
      restoredSignupRecovery.push({
        brand: role,
        language: lang,
        restoredStep: 2,
        passwordAndConsentRestored: false,
        enteredDraftRetainedAfterRetry: true,
        signupPosts: 0,
      });
    } finally {
      await restored.dispose();
    }
  }
  async function reconnectForPolicy(context, page) {
    // Real browser online/offline events exercise the existing query reconnect
    // behavior without reaching into application state or inventing a test API.
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    const response = responseTo(page, '/v1/auth/config', 'GET');
    await context.setOffline(false);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
    return response;
  }
  async function preserveConfirmedInputs(context, page, fields, channel, name) {
    const nodes = await Promise.all(fields.map(({ locator }) => locator.elementHandle()));
    expect(nodes.every(Boolean)).toBe(true);
    const assertRetained = async () => {
      for (const [index, { locator, value }] of fields.entries()) {
        await expect(locator).toHaveValue(value);
        expect(await nodes[index].evaluate((node) => node.isConnected)).toBe(true);
      }
    };
    const interruption = await interruptConfiguration(page);
    try {
      expect((await reconnectForPolicy(context, page)).status()).toBe(503);
      await assertRetained();
      expect(interruption.credentialPosts).toEqual([]);
      await snapshot(page, `${name}-policy-refresh-failed`);
      await interruption.restore();
      await assertActualPolicy(await reconnectForPolicy(context, page), channel);
      await assertRetained();
      expect(interruption.credentialPosts).toEqual([]);
      await snapshot(page, `${name}-policy-refresh-recovered`);
    } finally {
      await interruption.dispose();
      await Promise.all(nodes.map((node) => node.dispose()));
    }
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
    const verified = await response;
    expect(verified.status()).toBe(expected);
    return verified;
  }
  try {
    await mkdir(data.output, { recursive: true });
    for (const lang of ['en', 'ar']) {
      const { page } = await newPage(lang);
      for (const role of Object.keys(data.actors)) {
        await page.setViewportSize({ width: 390, height: 844 });
        await recoverInitialPolicy(page, role, lang);
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
    mark('form-first-policy-failure-and-real-api-recovery');
    mark('responsive-selected-methods');

    for (const lang of ['en', 'ar']) {
      const { page } = await newPage(lang);
      for (const role of Object.keys(data.actors)) await recoverSignupPolicy(page, role, lang);
    }
    mark('signup-policy-recovery-and-restored-step-two');

    const signedIn = {};
    for (const role of ['seeker', 'provider', 'admin']) {
      const item = await newPage();
      signedIn[role] = item;
      const challenge = await requestPhone(item.page, role);
      const delivered = await deliveredCode(data.actors[role].phone);
      await snapshot(item.page, `${role}-otp`);
      if (role === 'seeker') {
        await item.page.getByTestId('otp-input').fill('12');
        await preserveConfirmedInputs(
          item.context,
          item.page,
          [{ locator: item.page.getByTestId('otp-input'), value: '12' }],
          'whatsapp',
          'seeker-issued-otp',
        );
        mark('issued-challenge-survives-policy-refresh');
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
        // Keep the reconnect notification in the full-page Axe scan above.
        // Produce a fresh notification afterward so keyboard dismissal does
        // not race its automatic timer while the accessibility scan runs.
        const dismiss = item.page.getByRole('button', {
          name: 'Dismiss notification',
          exact: true,
        });
        // Root shows the notification for 5000ms; Snackbar then takes 320ms
        // to remove it. Cover that lifecycle before creating another notice.
        await expect(dismiss).toHaveCount(0, { timeout: 6_000 });
        await assertActualPolicy(await reconnectForPolicy(item.context, item.page), 'whatsapp');
        await expect(dismiss).toBeVisible();
        await dismiss.focus();
        await expect(dismiss).toBeFocused();
        await item.page.keyboard.press('Enter');
        await expect(dismiss).toHaveCount(0);
        await expect(item.page.getByTestId('otp-input')).toHaveValue('12');
      }
      const verification = await verify(item.page, delivered.code);
      expect(verification.request().postDataJSON().challengeId).toBe(challenge.challengeId);
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

    for (const lang of ['en', 'ar']) {
      const { page } = await newPage(lang);
      for (const role of Object.keys(data.actors)) {
        await recoverInitialPolicy(page, role, lang, 'email');
      }
    }
    mark('saved-admin-email-honored-after-config-recovery');

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
    await preserveConfirmedInputs(
      email.context,
      email.page,
      [
        { locator: email.page.locator('input[type="email"]'), value: data.email },
        { locator: email.page.locator('input[type="password"]'), value: data.password },
      ],
      'email',
      'email-credential-draft',
    );
    mark('credential-draft-survives-policy-refresh');
    const challenge = responseTo(email.page, '/v1/auth/login');
    await email.page.getByRole('button', { name: 'Log In', exact: true }).click();
    expect((await challenge).status()).toBe(200);
    await verify(email.page, await rpc('emailCode'));
    expect((await probe(email.page, '/v1/auth/me')).status).toBe(200);
    mark('email-method-isolated');
    // OTP submission above uses keyboard Enter against the real code field.
    mark('accessibility-and-keyboard');
    expect(pageErrors).toEqual([]);
    expect(signupPosts).toBe(0);
    await writeFile(
      path.join(data.output, 'acceptance.json'),
      JSON.stringify(
        {
          evidence: 'REAL_API_REAL_POSTGRES_REAL_REDIS_CAPTURED_EXTERNAL_WHATSAPP',
          providerDelivery: 'SIMULATED_EXTERNAL_BOUNDARY',
          publicConfigurationFailures: 'INTERCEPTED_PRESENTATION_ONLY',
          successfulConfigurationReads: 'ACTUAL_API_AND_POSTGRES_AFTER_UNROUTE',
          configurationRecovery,
          signupRecovery,
          restoredSignupRecovery,
          signupPosts,
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
