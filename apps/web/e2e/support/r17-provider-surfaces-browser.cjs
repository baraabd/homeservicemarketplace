/* R17-E — child of r17-provider-surfaces-browser.integration.spec.ts (real
 * AppModule, real PostgreSQL and Redis, both work-access axes armed).
 * Credentials/OTP and test-only database actions cross a private IPC pipe.
 * No route is intercepted and no API response is mocked: the in-page probes
 * below are ordinary credentialed requests to the real API, exactly what the
 * web client sends. */
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
  const checks = [];
  const check = (name) => {
    checks.push(name);
    process.send({ kind: 'progress', name });
  };
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('requestfailed', (r) =>
    console.error('request failed', r.method(), new URL(r.url()).pathname, r.failure()?.errorText),
  );
  const api = (p) => `${data.api}${p}`;
  const responseTo = (p, method) =>
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === new URL(api(p)).pathname && r.request().method() === method,
    );
  // A credentialed request from the page itself, as the web client makes it.
  const probe = (p, method = 'GET', body) =>
    page.evaluate(
      async ({ url, method, body }) => {
        const csrf = (globalThis.document.cookie.match(/(?:^|;\s*)hsm_csrf=([^;]*)/) || [])[1];
        const headers = { 'X-Client-Kind': 'web', 'content-type': 'application/json' };
        if (csrf) headers['X-CSRF-Token'] = decodeURIComponent(csrf);
        const r = await fetch(url, {
          method,
          credentials: 'include',
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        let json = null;
        try {
          json = await r.json();
        } catch {
          /* bodiless responses */
        }
        return { status: r.status, body: json };
      },
      { url: api(p), method, body },
    );

  async function login() {
    await page.goto(`${data.web}/login`);
    await page.locator('input[type=email]').waitFor({ timeout: 180000 });
    await page.locator('input[type=email]').fill(data.provider.email);
    await page.locator('input[type=password]').fill(data.provider.password);
    let status = 0;
    for (let attempt = 0; attempt < 3 && status !== 200; attempt++) {
      const res = responseTo('/v1/auth/login', 'POST');
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
    const otp = responseTo('/v1/auth/verify-otp', 'POST');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect((await otp).status()).toBe(200);
    await expect(page.getByTestId('otp-input')).toHaveCount(0);
  }

  async function bidThroughForm(requestId, price) {
    await page.goto(`${data.web}/provider/jobs`);
    await page.getByTestId('pull-up-control').click({ force: true });
    const card = page.getByTestId(`job-card-${requestId}`);
    await expect(card).toBeVisible();
    await card.click();
    await page.getByTestId('job-detail-place-bid').click();
    await page.locator('input[type="number"]').last().fill(String(price));
    await page.getByRole('button', { name: '30 min', exact: true }).click();
    const posted = responseTo('/v1/provider/bids', 'POST');
    await page.getByRole('button', { name: 'Send Offer', exact: true }).click();
    const res = await posted;
    expect(res.status()).toBe(201);
    return (await res.json()).bid.id;
  }

  async function layoutEvidence(name) {
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.waitForLoadState('networkidle');
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
    await writeFile(
      path.join(out, `${name}.json`),
      JSON.stringify({ overflow, violations }, null, 2),
    );
    await page.screenshot({
      path: path.join(out, `${name}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    expect(overflow).toBeLessThanOrEqual(1);
    expect(violations).toEqual([]);
  }

  try {
    // 1 ── Real password/OTP provider session.
    await login();
    check('real password/OTP provider session');

    // 2 ── Feed authority: the matching request is listed; the foreign
    //      category is on no surface, even when named explicitly.
    const feedLoaded = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/v1/provider/available-requests' &&
        r.request().method() === 'GET' &&
        r.status() === 200,
    );
    await page.goto(`${data.web}/provider/jobs`);
    const feed = await (await feedLoaded).json();
    const ids = feed.items.map((i) => i.id);
    expect(ids).toContain(data.requests.match);
    expect(ids).not.toContain(data.requests.foreign);
    await page.getByTestId('pull-up-control').click({ force: true });
    await expect(page.getByTestId(`job-card-${data.requests.match}`)).toBeVisible();
    await expect(page.getByTestId(`job-card-${data.requests.foreign}`)).toHaveCount(0);
    const named = await probe(`/v1/provider/available-requests?category=${data.foreignCategory}`);
    expect(named.status).toBe(200);
    expect(named.body.items).toEqual([]);
    expect((await probe(`/v1/provider/available-requests/${data.requests.foreign}`)).status).toBe(
      404,
    );
    const foreignBid = await probe('/v1/provider/bids', 'POST', {
      requestId: data.requests.foreign,
      amount: 50,
      pricingType: 'HOURLY',
    });
    expect(foreignBid.status).toBe(404);
    check('feed, detail and bid agree: matching request listed, foreign category on no surface');

    // 3 ── Submit a bid through the real form; it survives a reload.
    const firstBid = await bidThroughForm(data.requests.match, 120);
    await page.goto(`${data.web}/provider/bids`);
    await page.reload();
    await expect(page.getByTestId(`provider-bid-status-${firstBid}`)).toHaveText('Pending');
    await expect(page.getByTestId(`provider-bid-price-${firstBid}`)).toContainText('120 USD');
    await expect(page.getByTestId(`provider-bid-price-${firstBid}`)).toContainText('per hour');
    expect(await rpc('bidStatus', { id: firstBid })).toBe('PENDING');
    check('bid submitted through the form persists across reload, priced as stored');

    // 4 ── Withdraw needs a deliberate confirmation (keyboard path).
    const withdraw = page.getByTestId(`provider-bid-withdraw-${firstBid}`);
    await withdraw.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Withdraw this bid?');
    await expect(page.getByTestId(`provider-bid-withdraw-dialog-${firstBid}-keep`)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(withdraw).toBeFocused();
    expect(await rpc('bidStatus', { id: firstBid })).toBe('PENDING');
    await page.keyboard.press('Enter');
    const withdrawn = responseTo(`/v1/provider/bids/${firstBid}/withdraw`, 'POST');
    await page.getByTestId(`provider-bid-withdraw-dialog-${firstBid}-confirm`).click();
    expect((await withdrawn).status()).toBe(200);
    await expect(page.getByTestId(`provider-bid-withdraw-result-${firstBid}`)).toHaveAttribute(
      'data-result',
      'done',
    );
    await expect(page.getByTestId(`provider-bid-status-${firstBid}`)).toHaveText('Withdrawn');
    expect(await rpc('bidStatus', { id: firstBid })).toBe('WITHDRAWN');
    check('withdrawal: Escape keeps the bid, confirmation withdraws it, server agrees');

    // 5 ── Relogin: the withdrawn bid is still represented as withdrawn.
    await context.clearCookies();
    await login();
    await page.goto(`${data.web}/provider/bids`);
    await expect(page.getByTestId(`provider-bid-status-${firstBid}`)).toHaveText('Withdrawn');
    check('relogin: the withdrawn bid stays withdrawn');

    // 6 ── A new bid; the seeker accepts it; the provider sees the booking.
    const secondBid = await bidThroughForm(data.requests.match, 130);
    const bookingId = await rpc('accept', { requestId: data.requests.match, bidId: secondBid });
    await page.goto(`${data.web}/provider/bids`);
    await expect(page.getByTestId(`provider-bid-status-${secondBid}`)).toHaveText('Accepted');
    await expect(page.getByTestId(`provider-bid-booking-status-${secondBid}`)).toHaveAttribute(
      'data-status',
      'SCHEDULED',
    );
    const foreignTries = await rpc('foreignAttempts', { bidId: secondBid, bookingId });
    expect(foreignTries).toEqual({ withdraw: 404, read: 404, start: 404 });
    check(
      'accepted bid becomes the provider booking; another provider can neither see nor change it',
    );

    // 7 ── Booking detail: Start, reload, Complete, reload; history is persisted.
    await page.getByTestId(`provider-bid-open-booking-${secondBid}`).click();
    await expect(page.getByTestId('provider-booking-status')).toHaveAttribute(
      'data-status',
      'SCHEDULED',
    );
    const started = responseTo(`/v1/provider/bookings/${bookingId}/start`, 'POST');
    await page.getByTestId(`provider-booking-start-${bookingId}`).click();
    expect((await started).status()).toBe(200);
    await expect(page.getByTestId(`provider-booking-action-done-${bookingId}`)).toHaveText(
      'Job started.',
    );
    await page.reload();
    await expect(page.getByTestId('provider-booking-status')).toHaveAttribute(
      'data-status',
      'IN_PROGRESS',
    );
    const completed = responseTo(`/v1/provider/bookings/${bookingId}/complete`, 'POST');
    await page.getByTestId(`provider-booking-complete-${bookingId}`).click();
    expect((await completed).status()).toBe(200);
    await page.reload();
    await expect(page.getByTestId('provider-booking-status')).toHaveAttribute(
      'data-status',
      'COMPLETED',
    );
    await expect(page.getByTestId('provider-timeline').getByRole('listitem')).toHaveCount(3);
    expect(await rpc('bookingStatus', { id: bookingId })).toBe('COMPLETED');
    expect(await rpc('bookingEvents', { id: bookingId })).toBe(3);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await layoutEvidence('booking-detail-completed-en-1440');
    await page.setViewportSize({ width: 390, height: 844 });
    check('start and complete persist across reloads with a three-event history');

    // 8 ── Cancellation needs confirmation; then it lands once.
    const toCancel = await rpc('newBooking');
    await page.goto(`${data.web}/provider/bookings/${toCancel.bookingId}`);
    const cancel = page.getByTestId(`provider-booking-cancel-${toCancel.bookingId}`);
    await cancel.click();
    await expect(page.getByRole('alertdialog')).toContainText('Cancel this booking?');
    await page.getByTestId(`provider-booking-cancel-dialog-${toCancel.bookingId}-keep`).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(await rpc('bookingStatus', { id: toCancel.bookingId })).toBe('SCHEDULED');
    await cancel.click();
    const cancelled = responseTo(`/v1/provider/bookings/${toCancel.bookingId}/cancel`, 'POST');
    await page.getByTestId(`provider-booking-cancel-dialog-${toCancel.bookingId}-confirm`).click();
    expect((await cancelled).status()).toBe(200);
    await expect(page.getByTestId(`provider-booking-action-done-${toCancel.bookingId}`)).toHaveText(
      'Booking cancelled.',
    );
    await expect(page.getByTestId('provider-booking-status')).toHaveAttribute(
      'data-status',
      'CANCELLED',
    );
    expect(await rpc('bookingStatus', { id: toCancel.bookingId })).toBe('CANCELLED');
    check('cancellation: keeping sends nothing, confirming cancels once');

    // 9 ── A stale cancel (cancelled on another device) is an honest conflict.
    const stale = await rpc('newBooking');
    await page.goto(`${data.web}/provider/bookings/${stale.bookingId}`);
    await expect(page.getByTestId('provider-booking-status')).toHaveAttribute(
      'data-status',
      'SCHEDULED',
    );
    expect(await rpc('cancelElsewhere', { id: stale.bookingId })).toBe(200);
    await page.getByTestId(`provider-booking-cancel-${stale.bookingId}`).click();
    const conflict = responseTo(`/v1/provider/bookings/${stale.bookingId}/cancel`, 'POST');
    await page.getByTestId(`provider-booking-cancel-dialog-${stale.bookingId}-confirm`).click();
    expect((await conflict).status()).toBe(409);
    await expect(
      page.getByTestId(`provider-booking-action-error-${stale.bookingId}`),
    ).toHaveAttribute('data-error', 'CONFLICT');
    await expect(page.getByTestId('provider-booking-status')).toHaveAttribute(
      'data-status',
      'CANCELLED',
    );
    await expect(page.getByTestId(`provider-booking-action-done-${stale.bookingId}`)).toHaveCount(
      0,
    );
    check('stale cancellation: 409 is explained and the server state is shown');

    // 10 ── Restricted mid-session: new work disappears, obligations stay.
    const obligation = await rpc('newBooking');
    await page.goto(`${data.web}/provider/jobs`);
    await expect(page.getByTestId('provider-nav-jobs')).toBeVisible();
    await rpc('restrict');
    try {
      // The open workspace re-asks within the 30 s refresh interval.
      await expect(page).toHaveURL(/\/provider\/bookings$/, { timeout: 60000 });
      await expect(page.getByTestId('provider-bookings-restricted')).toBeVisible();
      await expect(page.getByTestId('provider-nav-bookings')).toBeVisible();
      await expect(page.getByTestId('provider-nav-jobs')).toHaveCount(0);
      await expect(page.getByTestId('provider-nav-bids')).toHaveCount(0);
      // The server refuses new work regardless of what the UI shows.
      expect((await probe('/v1/provider/available-requests')).status).toBe(403);
      // History stays readable; an existing obligation stays manageable.
      await expect(page.getByTestId(`provider-booking-row-${bookingId}`)).toHaveAttribute(
        'data-status',
        'COMPLETED',
      );
      await page.getByTestId(`provider-booking-row-${obligation.bookingId}`).click();
      const kept = responseTo(`/v1/provider/bookings/${obligation.bookingId}/start`, 'POST');
      await page.getByTestId(`provider-booking-start-${obligation.bookingId}`).click();
      expect((await kept).status()).toBe(200);
    } finally {
      await rpc('unrestrict');
    }
    check('restricted mid-session: marketplace gone, bookings readable and manageable');

    // 11 ── Grant revoked mid-session: the write fails closed, the UI follows.
    const scheduled = await rpc('newBooking');
    await page.goto(`${data.web}/provider/bookings/${scheduled.bookingId}`);
    await expect(page.getByTestId('provider-booking-status')).toHaveAttribute(
      'data-status',
      'SCHEDULED',
    );
    await rpc('revokeGrant');
    try {
      const refused = responseTo(`/v1/provider/bookings/${scheduled.bookingId}/start`, 'POST');
      await page.getByTestId(`provider-booking-start-${scheduled.bookingId}`).click();
      expect((await refused).status()).toBe(403);
      // The 403 re-asks for capabilities at once; no MANAGE_BOOKINGS → status.
      await expect(page).toHaveURL(/\/provider\/status$/, { timeout: 15000 });
      expect(await rpc('bookingStatus', { id: scheduled.bookingId })).toBe('SCHEDULED');
      await expect(page.getByText('Job started.')).toHaveCount(0);
    } finally {
      await rpc('restoreGrant');
    }
    check('grant revoked mid-session: start refused 403, workspace closes, nothing claimed');

    // 12 ── Wallet withdrawal stays disabled and writes nothing (R16).
    const writes = [];
    const onRequest = (r) => {
      if (r.method() !== 'GET' && r.url().startsWith(data.api)) writes.push(r.url());
    };
    page.on('request', onRequest);
    await page.goto(`${data.web}/provider/wallet`);
    const cta = page.getByRole('button', { name: /withdraw/i });
    await expect(cta).toBeDisabled();
    await cta.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(500);
    page.off('request', onRequest);
    expect(writes).toEqual([]);
    check('wallet withdrawal CTA disabled with no write');

    // 13 ── Arabic RTL at four widths: bookings, booking detail, bids, dialog.
    await page.evaluate(() => globalThis.localStorage.setItem('hsm.lang', 'ar'));
    const arabic = await rpc('newBooking');
    for (const [route, name] of [
      ['/provider/bookings', 'bookings'],
      [`/provider/bookings/${arabic.bookingId}`, 'booking-detail'],
      ['/provider/bids', 'bids'],
    ]) {
      await page.goto(`${data.web}${route}`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await layoutEvidence(`${name}-ar-${width}`);
      }
    }
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`${data.web}/provider/bookings/${arabic.bookingId}`);
    await page.getByTestId(`provider-booking-cancel-${arabic.bookingId}`).click();
    const arDialog = page.getByRole('alertdialog');
    await expect(arDialog).toHaveAttribute('dir', 'rtl');
    await expect(arDialog).toContainText('إلغاء هذا الحجز؟');
    await layoutEvidence('cancel-dialog-ar-320');
    await page.keyboard.press('Escape');
    expect(await rpc('bookingStatus', { id: arabic.bookingId })).toBe('SCHEDULED');
    await page.evaluate(() => globalThis.localStorage.setItem('hsm.lang', 'en'));
    check('Arabic RTL at 320/390/768/1440: no page overflow, no axe violation, dialog RTL');

    // 14 ── Session revoked on another device: nothing is claimed.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${data.web}/provider/bookings/${arabic.bookingId}`);
    await expect(page.getByTestId('provider-booking-status')).toHaveAttribute(
      'data-status',
      'SCHEDULED',
    );
    await rpc('logoutAll');
    const dead = responseTo(`/v1/provider/bookings/${arabic.bookingId}/start`, 'POST');
    await page.getByTestId(`provider-booking-start-${arabic.bookingId}`).click();
    expect((await dead).status()).toBe(401);
    await expect(page.getByText('Job started.')).toHaveCount(0);
    expect(await rpc('bookingStatus', { id: arabic.bookingId })).toBe('SCHEDULED');
    check('session revoked elsewhere: start refused, nothing claimed, booking unchanged');

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
      await page.screenshot({ path: path.join(out, 'failure-provider.png'), fullPage: true });
      await writeFile(
        path.join(out, 'failure-provider.txt'),
        await page.locator('body').innerText(),
      );
    } catch {
      /* Preserve the original browser failure if capture is unavailable. */
    }
    throw error;
  } finally {
    await browser.close();
  }
}
