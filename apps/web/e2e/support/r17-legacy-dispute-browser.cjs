/* R17-C — child of r17-dispute-legacy-browser.integration.spec.ts (real AppModule,
 * real PostgreSQL). Credentials/OTP cross a private IPC pipe only. No route is
 * intercepted and no API response is mocked. */
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

const RAW_ENUM = /RESOLVED_REFUND|RESOLVED_PARTIAL|RESOLVED_DENIED/;

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
  // A failed request is reported on the failure path, never silently retried.
  page.on('requestfailed', (r) =>
    console.error('request failed', r.method(), new URL(r.url()).pathname, r.failure()?.errorText),
  );
  try {
    await page.goto(`${data.web}/login`);
    // A cold dev server optimizes dependencies on the first request; only this
    // first render gets the longer bound.
    await page.locator('input[type=email]').waitFor({ timeout: 180000 });
    await page.locator('input[type=email]').fill(data.admin.email);
    await page.locator('input[type=password]').fill(data.admin.password);
    // Login is rate-limited per client IP and earlier suites in the same job
    // share 127.0.0.1. Honour the server's Retry-After (bounded) like a user
    // waiting, instead of widening the limit.
    let loginStatus = 0;
    for (let attempt = 0; attempt < 3 && loginStatus !== 200; attempt++) {
      const login = page.waitForResponse(
        (r) => r.url() === `${data.api}/v1/auth/login` && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Log In', exact: true }).click();
      const response = await login;
      loginStatus = response.status();
      if (loginStatus === 429) {
        const seconds = Math.min(Number(response.headers()['retry-after']) || 60, 65);
        await page.waitForTimeout(seconds * 1000);
      }
    }
    expect(loginStatus).toBe(200);
    await page.getByTestId('otp-input').fill(await rpc('otp', { email: data.admin.email }));
    const otp = page.waitForResponse((r) => r.url() === `${data.api}/v1/auth/verify-otp`);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect((await otp).status()).toBe(200);
    await expect(page.getByTestId('otp-input')).toHaveCount(0);
    check('real password/OTP admin session');

    async function openTicket(legacyLabel) {
      await page.goto(`${data.web}/admin/disputes`);
      await page.getByText(legacyLabel, { exact: true }).click();
      const row = page.locator('tr', { hasText: data.reason });
      await expect(row).toBeVisible();
      return row;
    }

    // 1. The legacy ticket opens with decision wording, never the raw enum.
    const row = await openTicket('Earlier support tickets');
    await row.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Record a decision', { exact: true })).toBeVisible();
    await expect(
      drawer.getByText('Recording a decision does not refund, pay or move any money.'),
    ).toBeVisible();
    const options = await drawer.locator('select option').allTextContents();
    expect(options).toEqual(
      expect.arrayContaining([
        'Decision: refund intent (not executed)',
        'Decision: partial refund intent (not executed)',
        'Decision: declined',
      ]),
    );
    expect(await page.locator('body').innerText()).not.toMatch(RAW_ENUM);
    check('decision outcomes labelled as intent, not executed refunds');

    // 2. Another admin decides first; this admin's decision is refused honestly.
    await drawer.getByLabel('Resolution', { exact: true }).fill('Browser admin decision');
    await rpc('decideElsewhere');
    const refused = page.waitForResponse(
      (r) => r.url() === `${data.api}/v1/admin/disputes/${data.ticketId}/resolve`,
    );
    await drawer.getByRole('button', { name: 'Record decision', exact: true }).click();
    expect((await refused).status()).toBe(409);
    await expect(drawer.getByRole('alert')).toHaveText(/Another admin changed this dispute first/);
    // The authoritative read-back replaces the stale form with the decided state.
    await expect(
      drawer.getByText('Dispute is in a terminal state and cannot be edited.'),
    ).toBeVisible();
    await expect(drawer.getByText('Decision: declined', { exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Record decision' })).toHaveCount(0);
    // The conflict explanation is still shown after the read-back.
    await expect(drawer.getByRole('alert')).toHaveText(/Another admin changed this dispute first/);
    await expect(page.getByText(/^✓ Saved$/)).toHaveCount(0);
    await rpc('verifyOneDecision');
    await page.screenshot({ path: path.join(out, 'legacy-conflict-en-1440.png'), fullPage: true });
    check('concurrent decision refused with a conflict and an authoritative read-back');

    // 3. A hard reload shows the same committed state.
    await page.reload();
    const reloaded = await openTicket('Earlier support tickets');
    await expect(reloaded.getByText('Decision: declined', { exact: true })).toBeVisible();
    check('hard reload shows the committed decision');

    // 4. Arabic/RTL and the responsive matrix on the real ticket list and drawer.
    await page.evaluate(() => localStorage.setItem('hsm.lang', 'ar'));
    const arRow = await openTicket('تذاكر الدعم السابقة');
    await expect(arRow.getByText('قرار: مرفوض', { exact: true })).toBeVisible();
    await arRow.click();
    await expect(page.getByRole('dialog').getByText('قرار: مرفوض', { exact: true })).toBeVisible();
    for (const width of [320, 390, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.locator('body').innerText()).not.toMatch(RAW_ENUM);
      const overflow = await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
      );
      await writeFile(
        path.join(out, `legacy-ar-${width}-overflow.json`),
        JSON.stringify({ width, overflow }),
      );
      expect(overflow).toBeLessThanOrEqual(1);
      const issues = (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations;
      await writeFile(
        path.join(out, `legacy-ar-${width}-axe.json`),
        JSON.stringify(issues, null, 2),
      );
      expect(issues).toEqual([]);
      await page.screenshot({
        path: path.join(out, `legacy-ar-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
    check('Arabic decision labels rendered at six widths with overflow and axe evidence');

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
