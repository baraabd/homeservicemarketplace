/* E-18 — child of provider-my-bids-browser.integration.spec.ts (real
 * AppModule, real PostgreSQL and Redis, both work-access axes armed).
 * Credentials/OTP and test-only database reads cross a private IPC pipe.
 * Every bids page is a real response from the real API. One step (5) is a
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
  const LIST = '/v1/provider/bids';
  const isList = (r) => new URL(r.url()).pathname === LIST && r.request().method() === 'GET';
  const isLaterPage = (r) => isList(r) && new URL(r.url()).searchParams.has('cursor');
  const firstPage = () => page.waitForResponse((r) => isList(r) && !isLaterPage(r));
  const laterPage = () => page.waitForResponse(isLaterPage);
  // The cards only: per-card controls carry longer prefixes (status, price…).
  const cards = page.locator('[data-testid^="provider-bid-it-mybidsb-"]');
  const loadMore = page.getByTestId('provider-bids-load-more');
  const cardIds = () =>
    cards.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid').replace('provider-bid-', '')),
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

  /** Opens My Bids and waits for the real first page. */
  async function openList(how = 'goto') {
    const first = firstPage();
    if (how === 'reload') await page.reload();
    else await page.goto(`${data.web}/provider/bids`);
    const response = await first;
    expect(response.status()).toBe(200);
    const body = await response.json();
    await expect(cards).toHaveCount(body.items.length);
    return body;
  }

  /** Follows "Load more" to the end; each page a real server response. */
  async function loadAll({ keyboard = false } = {}) {
    for (let i = 0; i < 10 && (await loadMore.count()) > 0; i++) {
      const before = await cards.count();
      const next = laterPage();
      if (keyboard) {
        await loadMore.focus();
        await page.keyboard.press('Enter');
      } else await loadMore.click();
      const response = await next;
      expect(response.status()).toBe(200);
      const body = await response.json();
      await expect(cards).toHaveCount(before + body.items.length);
      // Focus continues at the first bid that arrived.
      const firstNew = (await cardIds())[before];
      await expect(page.getByTestId(`provider-bid-${firstNew}`)).toBeFocused();
    }
    await expect(loadMore).toHaveCount(0);
  }

  async function expectAll(truth) {
    const ids = await cardIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(truth.map((b) => b.id));
  }

  /** The control is on screen and nothing covers it. */
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
    const target = (await focus.count()) > 0 ? await unobscured(focus) : null;
    await writeFile(
      path.join(out, `${name}.json`),
      JSON.stringify({ overflow, violations, target }, null, 2),
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
    const onFirstBookingsPage = new Set(await rpc('firstBookingsPage'));

    // 1 ── Real password/OTP provider session.
    await login();
    check('real password/OTP provider session');

    // 2 ── The first page is the server's first page; counts say "at least".
    const first = await openList();
    expect(first.items).toHaveLength(data.pageSize);
    expect(first.nextCursor).toBeTruthy();
    await expect(loadMore).toHaveText('Load more');
    await expect(page.getByTestId('provider-bids-count-accepted')).toContainText('20+');
    await layoutEvidence('en-390-first-page');
    check('first page: 20 real bids, partial counts marked, a Load more control');

    // 3 ── An accepted bid whose booking is NOT on the first bookings page
    //      still shows its booking and opens it (before: "Waiting for booking…").
    const orphan = first.items.find(
      (b) => b.status === 'ACCEPTED' && !onFirstBookingsPage.has(b.id),
    );
    expect(orphan).toBeTruthy();
    expect(orphan.booking).toEqual(
      expect.objectContaining({ id: truth.find((t) => t.id === orphan.id).bookingId }),
    );
    const card = page.getByTestId(`provider-bid-${orphan.id}`);
    await expect(card.getByText('Waiting for booking…')).toHaveCount(0);
    await expect(page.getByTestId(`provider-bid-booking-status-${orphan.id}`)).toHaveAttribute(
      'data-status',
      'SCHEDULED',
    );
    const detail = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/v1/provider/bookings/${orphan.booking.id}` &&
        r.request().method() === 'GET',
    );
    await page.getByTestId(`provider-bid-open-booking-${orphan.id}`).click();
    expect((await detail).status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/provider/bookings/${orphan.booking.id}$`));
    check('an accepted bid beyond the first bookings page opens its own booking');

    // 4 ── Mouse for page 2, keyboard for the rest; focus follows; every bid
    //      in the database's order, none twice; then the end marker.
    await openList();
    const second = laterPage();
    await loadMore.click();
    const page2 = await second;
    expect(new URL(page2.url()).searchParams.get('cursor')).toBe(first.nextCursor);
    await expect(cards).toHaveCount(2 * data.pageSize);
    await loadAll({ keyboard: true });
    await expectAll(truth);
    await expect(page.getByTestId('provider-bids-end')).toHaveText('All bids shown');
    await expect(page.getByTestId('provider-bids-count-accepted')).toContainText('60');
    await expect(page.getByTestId('provider-bids-count-accepted')).not.toContainText('+');
    await layoutEvidence('en-390-all-loaded', page.getByTestId('provider-bids-end'));
    check('every bid reachable: 20 + 20 + 20 + 5 by mouse and keyboard, in server order');

    // 5 ── FAULT TEST (labelled): the next real page-2 request is failed at
    //      the network layer once. Loaded bids stay; retry asks for the same
    //      page and gets the real one.
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
    const alert = page.getByTestId('provider-bids-more-error');
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('alert')).toContainText('Couldn’t load more bids.');
    await expect(cards).toHaveCount(data.pageSize);
    await layoutEvidence(
      'en-390-later-page-failed',
      alert.getByRole('button', { name: 'Try again' }),
    );
    const retried = laterPage();
    await alert.getByRole('button', { name: 'Try again' }).click();
    const retry = await retried;
    expect(retry.status()).toBe(200);
    expect(new URL(retry.url()).searchParams.get('cursor')).toBe(first.nextCursor);
    await expect(cards).toHaveCount(2 * data.pageSize);
    await expect(alert).toHaveCount(0);
    await page.unroute((url) => url.pathname === LIST && url.searchParams.has('cursor'));
    expect(failed).toBe(1);
    check('fault: a failed later page keeps loaded bids and retries the same cursor');

    // 6 ── Arabic RTL at 320/390/768/1440 with the control, then loaded.
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
    await expect(page.getByTestId('provider-bids-end')).toHaveText('تم عرض كل العروض');
    await layoutEvidence('ar-390-all-loaded', page.getByTestId('provider-bids-end'));
    await page.evaluate(() => globalThis.localStorage.setItem('hsm.lang', 'en'));
    check('Arabic RTL at 320/390/768/1440: no overflow, no axe violations, 44px control');

    // 7 ── A session revoked elsewhere between pages: page 2 is refused and
    //      the list does not survive into the signed-out state.
    await openList();
    await rpc('logoutAll');
    const revoked = laterPage();
    await loadMore.click();
    expect((await revoked).status()).toBe(401);
    await expect(page).toHaveURL(/\/login/, { timeout: 30000 });
    await expect(cards).toHaveCount(0);
    check('session revoked between pages: page 2 refused, signed out, no bids left');

    // 8 ── Fresh login: the whole list again, from the server.
    await login();
    await openList();
    await loadAll();
    await expectAll(truth);
    check('fresh login: every bid reachable again');
  } finally {
    await browser.close();
  }
}
