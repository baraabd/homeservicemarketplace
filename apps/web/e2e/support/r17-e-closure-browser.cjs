/* R17-E post-merge closure — child of r17-e-closure-browser.integration.spec.ts
 * (real AppModule, real PostgreSQL and Redis, both work-access axes armed).
 * Credentials/OTP and test-only database actions cross a private IPC pipe.
 * Every booking page is a real response from the real API. One step (5) is a
 * labelled FAULT test: it makes one real page-2 request fail at the network
 * layer to prove the retry path, and never substitutes a response. */
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
    }, 60000);
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
  const check = (name) => process.send({ kind: 'progress', name });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const LIST = '/v1/provider/bookings';
  const isList = (r) => new URL(r.url()).pathname === LIST && r.request().method() === 'GET';
  const isLaterPage = (r) => isList(r) && new URL(r.url()).searchParams.has('cursor');
  const firstPage = () => page.waitForResponse((r) => isList(r) && !isLaterPage(r));
  const laterPage = () => page.waitForResponse(isLaterPage);
  const rows = page.locator('[data-testid^="provider-booking-row-"]');
  const loadMore = page.getByTestId('provider-bookings-load-more');
  const rowIds = () =>
    rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid').replace('provider-booking-row-', '')),
    );

  async function login() {
    await page.goto(`${data.web}/login`);
    await page.locator('input[type=email]').waitFor({ timeout: 180000 });
    await page.locator('input[type=email]').fill(data.provider.email);
    await page.locator('input[type=password]').fill(data.provider.password);
    let status = 0;
    for (let attempt = 0; attempt < 3 && status !== 200; attempt++) {
      const res = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/login' && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Log In', exact: true }).click();
      const response = await res;
      status = response.status();
      if (status === 429)
        await page.waitForTimeout(
          Math.min(Number(response.headers()['retry-after']) || 60, 65) * 1000,
        );
    }
    expect(status).toBe(200);
    await page.getByTestId('otp-input').fill(await rpc('otp', { email: data.provider.email }));
    const otp = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/v1/auth/verify-otp' && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect((await otp).status()).toBe(200);
    await expect(page.getByTestId('otp-input')).toHaveCount(0);
  }

  /** Opens the list and waits for the real first page. */
  async function openList(how = 'goto') {
    const first = firstPage();
    if (how === 'reload') await page.reload();
    else await page.goto(`${data.web}/provider/bookings`);
    const response = await first;
    expect(response.status()).toBe(200);
    const body = await response.json();
    await expect(rows).toHaveCount(body.items.length);
    return body;
  }

  /** Follows "Load more" to the end; each page a real server response. */
  async function loadAll({ keyboard = false } = {}) {
    for (let i = 0; i < 10 && (await loadMore.count()) > 0; i++) {
      const before = await rows.count();
      const next = laterPage();
      if (keyboard) {
        await loadMore.focus();
        await page.keyboard.press('Enter');
      } else await loadMore.click();
      const response = await next;
      expect(response.status()).toBe(200);
      const body = await response.json();
      await expect(rows).toHaveCount(before + body.items.length);
      // Focus continues at the first booking that arrived.
      const firstNew = (await rowIds())[before];
      await expect(page.getByTestId(`provider-booking-row-${firstNew}`)).toBeFocused();
    }
    await expect(loadMore).toHaveCount(0);
  }

  async function expectAll(truth) {
    const ids = await rowIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(truth);
  }

  /** The control is on screen and nothing (the bottom navigation, a sticky
   *  bar) covers it: the element at its centre is the control itself. */
  async function unobscured(locator) {
    await locator.scrollIntoViewIfNeeded();
    return locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = globalThis.document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        tag: el.tagName,
        width: Math.round(r.width),
        height: Math.round(r.height),
        covered: !(hit === el || el.contains(hit)),
      };
    });
  }

  /** focus: the control the screenshot is about, scrolled into view. */
  async function layoutEvidence(name, focus = loadMore) {
    await page.evaluate(() => globalThis.document.fonts.ready);
    const overflow = await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
    );
    const violations = (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
    }));
    // The control, when present, keeps the project's 44px touch target and
    // is not hidden behind the bottom navigation.
    const target = (await focus.count()) > 0 ? await unobscured(focus) : null;
    await writeFile(
      path.join(out, `${name}.json`),
      JSON.stringify({ overflow, violations, loadMoreTarget: target }, null, 2),
    );
    await page.screenshot({ path: path.join(out, `${name}.png`), animations: 'disabled' });
    expect(overflow).toBeLessThanOrEqual(1);
    expect(violations).toEqual([]);
    if (target) {
      if (target.tag === 'BUTTON') expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.covered).toBe(false);
    }
  }

  try {
    const truth = await rpc('truth');
    expect(truth).toHaveLength(data.owned);

    // 1 ── Real password/OTP provider session.
    await login();
    check('real password/OTP provider session');

    // 2 ── The first page is the server's first page, and says there is more.
    const first = await openList();
    expect(first.items).toHaveLength(data.pageSize);
    expect(first.nextCursor).toBeTruthy();
    await expect(loadMore).toBeVisible();
    await expect(loadMore).toHaveText('Load more');
    await layoutEvidence('en-390-first-page');
    check('first page: 50 real rows and a Load more control');

    // 3 ── Mouse for page 2, keyboard for page 3; focus follows; all 105, in
    //      the database's order, none twice; then the end marker.
    const second = laterPage();
    await loadMore.click();
    const page2 = await second;
    expect(new URL(page2.url()).searchParams.get('cursor')).toBe(first.nextCursor);
    await expect(rows).toHaveCount(2 * data.pageSize);
    await loadAll({ keyboard: true });
    await expectAll(truth);
    await expect(page.getByTestId('provider-bookings-end')).toHaveText('All bookings shown');
    await layoutEvidence('en-390-all-loaded', page.getByTestId('provider-bookings-end'));
    check('every booking reachable: 50 + 50 + 5 by mouse and keyboard, in server order');

    // 4 ── Hard reload starts from the server again and reaches the end again.
    await openList('reload');
    await expect(rows).toHaveCount(data.pageSize);
    await loadAll();
    await expectAll(truth);
    check('hard reload: first page from the server, every page reachable again');

    // 5 ── FAULT TEST (labelled): the next real page-2 request is failed at
    //      the network layer once. Loaded rows stay usable; retry asks for the
    //      same page and gets the real one.
    await openList('reload');
    let failed = 0;
    await page.route(
      (url) => url.pathname === LIST && url.searchParams.has('cursor'),
      async (route) => {
        if (failed === 0) {
          failed += 1;
          await route.abort('failed');
        } else await route.continue();
      },
    );
    await loadMore.click();
    const alert = page.getByTestId('provider-bookings-more-error');
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('alert')).toContainText('Couldn’t load more bookings.');
    await expect(rows).toHaveCount(data.pageSize);
    await expect(page.getByTestId(`provider-booking-row-${truth[0]}`)).toHaveAttribute(
      'href',
      `/provider/bookings/${truth[0]}`,
    );
    await layoutEvidence(
      'en-390-later-page-failed',
      alert.getByRole('button', { name: 'Try again' }),
    );
    const retried = laterPage();
    await alert.getByRole('button', { name: 'Try again' }).click();
    const retry = await retried;
    expect(retry.status()).toBe(200);
    expect(new URL(retry.url()).searchParams.get('cursor')).toBe(first.nextCursor);
    await expect(rows).toHaveCount(2 * data.pageSize);
    await expect(alert).toHaveCount(0);
    await page.unroute((url) => url.pathname === LIST && url.searchParams.has('cursor'));
    expect(failed).toBe(1);
    check('fault: a failed later page keeps loaded rows and retries the same cursor');

    // 6 ── RESTRICTED keeps every obligation: all pages, and the detail of a
    //      booking only reachable on page 3.
    await rpc('restrict');
    await openList('reload');
    await expect(page.getByTestId('provider-bookings-restricted')).toBeVisible();
    await loadAll();
    await expectAll(truth);
    const last = truth[truth.length - 1];
    const detail = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `${LIST}/${last}` && r.request().method() === 'GET',
    );
    await page.getByTestId(`provider-booking-row-${last}`).click();
    expect((await detail).status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/provider/bookings/${last}$`));
    await rpc('unrestrict');
    check('restricted provider reaches every obligation, including page 3 detail');

    // 7 ── Suspended mid-list: the server refuses page 2 and the loaded rows
    //      are dropped, not left on screen.
    await openList();
    await rpc('suspend');
    const refused = laterPage();
    await loadMore.click();
    expect((await refused).status()).toBe(403);
    await expect(rows).toHaveCount(0, { timeout: 30000 });
    await rpc('unsuspend');
    check('suspended mid-list: page 2 refused by the server, loaded rows dropped');

    // 8 ── Arabic RTL at 320/390/768/1440 with the control, then loaded.
    await page.evaluate(() => globalThis.localStorage.setItem('hsm.lang', 'ar'));
    await openList();
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    await expect(loadMore).toHaveText('عرض المزيد');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await layoutEvidence(`ar-${width}-first-page`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await loadAll();
    await expect(page.getByTestId('provider-bookings-end')).toHaveText('تم عرض كل الحجوزات');
    await layoutEvidence('ar-390-all-loaded', page.getByTestId('provider-bookings-end'));
    await page.evaluate(() => globalThis.localStorage.setItem('hsm.lang', 'en'));
    check('Arabic RTL at 320/390/768/1440: no overflow, no axe violations, 44px control');

    // 9 ── A session revoked elsewhere between pages: page 2 is refused and
    //      the list does not survive into the signed-out state.
    await openList();
    await rpc('logoutAll');
    const revoked = laterPage();
    await loadMore.click();
    expect((await revoked).status()).toBe(401);
    await expect(page).toHaveURL(/\/login/, { timeout: 30000 });
    await expect(rows).toHaveCount(0);
    check('session revoked between pages: page 2 refused, signed out, no rows left');

    // 10 ── Fresh login: the whole list again, from the server.
    await login();
    await openList();
    await loadAll();
    await expectAll(truth);
    check('fresh login: every booking reachable again');
  } finally {
    await browser.close();
  }
}
