/* R17-D — child of r17-admin-operations-browser.integration.spec.ts (real
 * AppModule, real PostgreSQL). Credentials/OTP and test-only database actions
 * cross a private IPC pipe. No route is intercepted and no API response is
 * mocked. */
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

let seq = 0;
const pending = new Map();
const rpc = (kind, payload = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`IPC ${kind} timed out`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    process.send({ id, kind, payload });
  });
process.on('message', async (msg) => {
  if (msg.reply) {
    const p = pending.get(msg.reply);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(msg.reply);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.data);
    }
    return;
  }
  if (msg.kind === 'start') {
    try {
      await run(msg.data);
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
  const out = data.output;
  await mkdir(out, { recursive: true });
  const checks = [];
  const check = (name) => {
    checks.push(name);
    process.send({ kind: 'progress', name });
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('requestfailed', (r) =>
    console.error('request failed', r.method(), new URL(r.url()).pathname, r.failure()?.errorText),
  );
  const api = (p) => `${data.api}${p}`;
  const responseTo = (p, method) =>
    page.waitForResponse((r) => r.url().startsWith(api(p)) && r.request().method() === method);
  try {
    // ── Real password/OTP login, honouring Retry-After on a shared IP budget.
    await page.goto(`${data.web}/login`);
    await page.locator('input[type=email]').waitFor({ timeout: 180000 });
    await page.locator('input[type=email]').fill(data.admin.email);
    await page.locator('input[type=password]').fill(data.admin.password);
    let loginStatus = 0;
    for (let attempt = 0; attempt < 3 && loginStatus !== 200; attempt++) {
      const login = responseTo('/v1/auth/login', 'POST');
      await page.getByRole('button', { name: 'Log In', exact: true }).click();
      const response = await login;
      loginStatus = response.status();
      if (loginStatus === 429)
        await page.waitForTimeout(
          Math.min(Number(response.headers()['retry-after']) || 60, 65) * 1000,
        );
    }
    expect(loginStatus).toBe(200);
    await page.getByTestId('otp-input').fill(await rpc('otp', { email: data.admin.email }));
    const otp = responseTo('/v1/auth/verify-otp', 'POST');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect((await otp).status()).toBe(200);
    await expect(page.getByTestId('otp-input')).toHaveCount(0);
    check('real password/OTP admin session');

    // ── Settings: inert settings are read-only; a real setting validates,
    // saves, survives a hard reload and is what the database holds.
    await page.goto(`${data.web}/admin/settings`);
    await expect(page.getByTestId('setting-readonly-platform_fee_bps')).toContainText(
      'does not read this setting',
    );
    await expect(page.getByLabel('platform_fee_bps', { exact: true })).toHaveCount(0);
    const docs = page.getByLabel('verification_policy_max_documents', { exact: true });
    await expect(docs).toHaveValue(String(data.settingBefore));
    await docs.fill('25');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Must be ≤ 20.')).toBeVisible();
    await docs.fill('12');
    const saved = responseTo('/v1/admin/settings', 'PATCH');
    await page.getByRole('button', { name: 'Save changes' }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByText('✓ Saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('verification_policy_max_documents', { exact: true })).toHaveValue(
      '12',
    );
    expect(await rpc('setting', { key: 'verification_policy_max_documents' })).toBe(12);
    await page.screenshot({ path: path.join(out, 'settings-en-1440.png'), fullPage: true });
    check('settings: inert read-only, validation, save, reload, database read-back');

    // ── Analytics: booked value per currency, never summed; no fee claim.
    await page.goto(`${data.web}/admin`);
    const inRange = page.getByTestId('kpi-value-in-range');
    await expect(inRange).toContainText('XTS');
    await expect(inRange).toContainText('XXX');
    const text = await inRange.innerText();
    expect(text).toContain(data.expect.xts);
    expect(text).toContain(data.expect.xxx);
    await expect(page.getByTestId('analytics-value-note')).toContainText('not payments');
    expect(await page.locator('body').innerText()).not.toMatch(/platform fee \d|After \d+%/i);
    await page.screenshot({ path: path.join(out, 'dashboard-en-1440.png'), fullPage: true });
    check('analytics: per-currency booked value, no cross-currency sum, no fee');

    // ── Audit: the new settings change is visible; paging reaches the end.
    await page.goto(`${data.web}/admin/audit`);
    await expect(page.getByText('ADMIN_SETTING_UPDATED').first()).toBeVisible();
    await page.getByPlaceholder('Filter by actor user id').fill(data.auditActor);
    await page.getByRole('button', { name: 'Filter', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(50);
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByText('End of the log.')).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(data.auditRows);
    expect(await page.locator('tbody').innerText()).not.toContain('not-for-display');
    check('audit: past 50 rows to the end, secrets redacted');

    // ── Users: suspend persists; a revoked write grant is refused and said so.
    await page.goto(`${data.web}/admin/users`);
    await page.getByPlaceholder('Search by email or name').fill(data.target.email);
    await page.getByPlaceholder('Search by email or name').press('Enter');
    await page.getByText(data.target.email).first().click();
    const dialog = page.getByRole('dialog');
    const suspended = responseTo(`/v1/admin/users/${data.target.id}/status`, 'PATCH');
    await dialog.getByRole('button', { name: 'Suspend', exact: true }).click();
    expect((await suspended).status()).toBe(200);
    await expect(dialog.getByRole('button', { name: 'Activate', exact: true })).toBeVisible();
    expect(await rpc('userStatus', { id: data.target.id })).toBe('SUSPENDED');
    await rpc('revokeWriteGrant');
    try {
      const refused = responseTo(`/v1/admin/users/${data.target.id}/status`, 'PATCH');
      await dialog.getByRole('button', { name: 'Activate', exact: true }).click();
      expect((await refused).status()).toBe(403);
      await expect(dialog.getByRole('alert')).toContainText('permissions no longer allow');
      expect(await rpc('userStatus', { id: data.target.id })).toBe('SUSPENDED');
    } finally {
      await rpc('restoreWriteGrant');
    }
    const restored = responseTo(`/v1/admin/users/${data.target.id}/status`, 'PATCH');
    await dialog.getByRole('button', { name: 'Activate', exact: true }).click();
    expect((await restored).status()).toBe(200);
    expect(await rpc('userStatus', { id: data.target.id })).toBe('ACTIVE');
    await page.keyboard.press('Escape');
    check('users: suspend persists, revoked grant refused with an explanation, restore');

    // ── Arabic RTL at representative widths: no page overflow, no axe violation.
    await page.evaluate(() => localStorage.setItem('hsm.lang', 'ar'));
    for (const [route, name] of [
      ['/admin/settings', 'settings'],
      ['/admin', 'dashboard'],
    ]) {
      await page.goto(`${data.web}${route}`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        // Measure the settled layout, not a frame mid-reflow.
        await page.evaluate(() => globalThis.document.fonts.ready);
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
        );
        const violations = (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
        // Which elements cross the viewport edge, so an overflow is diagnosable
        // from the evidence alone.
        const outside = await page.evaluate(() =>
          [...globalThis.document.querySelectorAll('body *')]
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.right > globalThis.innerWidth || r.left < 0;
            })
            .slice(0, 10)
            .map((e) => ({
              tag: e.tagName,
              cls: String(e.className).slice(0, 80),
              text: (e.textContent || '').trim().slice(0, 30),
              width: Math.round(e.getBoundingClientRect().width),
              testId: e.getAttribute('data-testid'),
              left: Math.round(e.getBoundingClientRect().left),
              right: Math.round(e.getBoundingClientRect().right),
            })),
        );
        // Content spilling out of a box that does not clip it.
        const spilling = await page.evaluate(() =>
          [...globalThis.document.querySelectorAll('body *')]
            .filter(
              (e) =>
                e.scrollWidth > e.clientWidth + 1 &&
                globalThis.getComputedStyle(e).overflowX === 'visible',
            )
            .slice(-6)
            .map((e) => ({
              tag: e.tagName,
              cls: String(e.className).slice(0, 80),
              text: (e.textContent || '').trim().slice(0, 40),
              scrollWidth: e.scrollWidth,
              clientWidth: e.clientWidth,
            })),
        );
        await writeFile(
          path.join(out, `${name}-ar-${width}.json`),
          JSON.stringify({ width, overflow, outside, spilling, violations }, null, 2),
        );
        expect(overflow).toBeLessThanOrEqual(1);
        expect(violations).toEqual([]);
        await page.screenshot({
          path: path.join(out, `${name}-ar-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    await page.evaluate(() => localStorage.setItem('hsm.lang', 'en'));
    await page.setViewportSize({ width: 1440, height: 1000 });
    check('Arabic RTL settings and dashboard at four widths without page overflow');

    // ── Stale session: revoked elsewhere while Settings is open.
    await page.goto(`${data.web}/admin/settings`);
    const field = page.getByLabel('verification_policy_max_documents', { exact: true });
    await expect(field).toHaveValue('12');
    await rpc('logoutAll');
    await field.fill('13');
    const stale = responseTo('/v1/admin/settings', 'PATCH');
    await page.getByRole('button', { name: 'Save changes' }).click();
    expect((await stale).status()).toBe(401);
    expect(await rpc('setting', { key: 'verification_policy_max_documents' })).toBe(12);
    await expect(page.getByText('✓ Saved')).toHaveCount(0);
    check('stale session: a revoked session cannot save, and nothing claims it did');

    await writeFile(
      path.join(out, 'summary.json'),
      JSON.stringify(
        {
          checks,
          transport: 'real HTTP and database; no route interception',
          commit: process.env.GITHUB_SHA ?? null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    try {
      await page.screenshot({ path: path.join(out, 'failure-admin.png'), fullPage: true });
      await writeFile(path.join(out, 'failure-admin.txt'), await page.locator('body').innerText());
    } catch {
      /* Preserve the original browser failure if capture is unavailable. */
    }
    throw error;
  } finally {
    await browser.close();
  }
}
