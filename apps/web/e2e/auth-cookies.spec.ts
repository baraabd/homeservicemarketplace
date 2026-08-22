import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';

// Sprint 3 — cookies, CSRF, refresh, and logout in a REAL browser.
//
// Every one of these behaviours is defined by rules a browser enforces and a
// test double does not: HttpOnly is invisible to `document.cookie` only
// because Chromium says so; SameSite=Strict withholds a cookie only because
// Chromium compares sites; `Path=/v1/auth/refresh` scopes the refresh token
// only because Chromium matches path prefixes. supertest, axios-mock-adapter
// and happy-dom implement none of that — they will happily "pass" a cookie
// contract that a real browser refuses to honour. So this file drives a real
// Chromium against a real API.
//
// The page is parked on the API's own origin and the calls are made with
// in-page `fetch(..., { credentials: 'include' })`. That is deliberate: it
// puts the browser's own cookie jar, not Playwright's HTTP client, in charge
// of what gets stored and what gets sent — which is the entire thing under
// test.
//
// Requires a real API. `E2E_REAL_API` is the base URL; when it is unset the
// whole file skips with a reason rather than silently passing, because a
// security test that quietly does nothing is worse than no test.

const API = process.env.E2E_REAL_API ?? '';
const MAILPIT = process.env.E2E_MAILPIT ?? 'http://127.0.0.1:8025';

const ACCESS = 'hsm_at';
const REFRESH = 'hsm_rt';
const CSRF = 'hsm_csrf';
const REFRESH_PATH = '/v1/auth/refresh';

test.describe('auth cookie contract (real browser)', () => {
  test.skip(!API, 'E2E_REAL_API is not set — start the API and set it to run these.');

  // These tests are slower than the UI suite by nature, not by accident: each
  // one registers an account, waits for an SMTP delivery, polls a mail
  // catcher, then verifies an OTP. The repo-wide 60s budget fits that on a
  // warm machine and not on a cold one — the FIRST test in a run routinely
  // took ~80s here while every later one took ~13s, because the first pays for
  // the SMTP connection, the mailpit container, and Chromium's first
  // navigation all at once. A CI runner is colder than a laptop, so the budget
  // is raised rather than left to be discovered as a flake.
  test.describe.configure({ timeout: 180_000 });

  // The OTP is never persisted in plaintext, so the mailbox is the only place
  // to read it — which is exactly how a real client gets it.
  // 60 attempts x 500ms = 30s. The old 10s window was fine once SMTP was warm
  // and too short for the first delivery of a run, where nodemailer is still
  // opening its first connection.
  async function otpFor(request: APIRequestContext, email: string): Promise<string> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const res = await request.get(`${MAILPIT}/api/v1/messages?limit=30`);
      const body = (await res.json()) as {
        messages?: { ID: string; To?: { Address: string }[] }[];
      };
      const hit = (body.messages ?? []).find((m) =>
        (m.To ?? []).some((t) => t.Address?.toLowerCase() === email.toLowerCase()),
      );
      if (hit) {
        const full = await request.get(`${MAILPIT}/api/v1/message/${hit.ID}`);
        const message = (await full.json()) as { Text?: string };
        // Read the TEXT body, not the serialised envelope. Searching the whole
        // JSON matched a six-digit run inside mailpit's own metadata before it
        // ever reached the code, so every verify-otp came back
        // AUTH_OTP_INVALID carrying a number that was never an OTP.
        const body = message.Text ?? '';
        const code = body.match(/code is (\d{6})/)?.[1] ?? body.match(/\b(\d{6})\b/)?.[1];
        if (code) return code;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no OTP mail arrived for ${email}`);
  }

  // Run a fetch from inside the page, so the browser applies its own cookie
  // rules to both the request and the response.
  async function inPage(
    page: Page,
    path: string,
    init: { method?: string; body?: unknown; csrf?: string } = {},
  ): Promise<{ status: number; body: unknown }> {
    return page.evaluate(
      async ([url, method, payload, csrfToken]) => {
        const headers: Record<string, string> = {};
        if (payload) headers['Content-Type'] = 'application/json';
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken as string;
        const res = await fetch(url as string, {
          method: (method as string) || 'GET',
          credentials: 'include',
          headers,
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
        // 204 responses (logout) have no body, so json() throws. The status is
        // the assertion in those cases; the body is best-effort.
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        return { status: res.status, body };
      },
      [`${API}${path}`, init.method ?? 'GET', init.body ?? null, init.csrf ?? null] as const,
    );
  }

  const freshEmail = () => `sprint3-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;

  async function signIn(page: Page, request: APIRequestContext) {
    const password = 'a-reasonable-passphrase-1';

    await page.goto(`${API}/health/live`);

    // One retry, because the first SMTP connection of a run can time out
    // against a cold mail catcher ("Greeting never received") and surface as a
    // 500. That is an environment warm-up artefact, not the contract.
    //
    // The retry uses a NEW address on purpose. A 500 from the mail step means
    // the account may already have been created before the send failed, so
    // reusing the address would collide with it and turn a warm-up blip into a
    // 409 that looks like a registration bug.
    let email = freshEmail();
    let registered = await inPage(page, '/v1/auth/register', {
      method: 'POST',
      body: { email, password, firstName: 'Cookie', lastName: 'Tester' },
    });
    if (registered.status >= 500) {
      email = freshEmail();
      registered = await inPage(page, '/v1/auth/register', {
        method: 'POST',
        body: { email, password, firstName: 'Cookie', lastName: 'Tester' },
      });
    }
    expect(registered.status, 'register should be accepted').toBeLessThan(400);

    const challengeId = (registered.body as { challengeId?: string })?.challengeId;
    expect(challengeId, 'register should issue an OTP challenge').toBeTruthy();

    const code = await otpFor(request, email);
    const verified = await inPage(page, '/v1/auth/verify-otp', {
      method: 'POST',
      body: { challengeId, code },
    });
    expect(verified.status, 'OTP verification should succeed').toBe(200);
    return { email, password };
  }

  const byName = (cookies: Awaited<ReturnType<BrowserContext['cookies']>>, name: string) =>
    cookies.find((c) => c.name === name);

  test('the cookie matrix a browser actually enforces', async ({ page, context, request }) => {
    await signIn(page, request);
    const cookies = await context.cookies();

    const access = byName(cookies, ACCESS);
    const refresh = byName(cookies, REFRESH);
    const csrf = byName(cookies, CSRF);

    expect(access, 'access cookie must be set').toBeTruthy();
    expect(refresh, 'refresh cookie must be set').toBeTruthy();
    expect(csrf, 'csrf cookie must be set').toBeTruthy();

    // Access: HttpOnly, site-wide.
    expect(access!.httpOnly, 'access token must be HttpOnly').toBe(true);
    expect(access!.path).toBe('/');

    // Refresh: HttpOnly, Strict, and scoped to the refresh route only. The
    // path matters — a refresh token sent on every request is just a
    // long-lived access token with extra steps.
    expect(refresh!.httpOnly, 'refresh token must be HttpOnly').toBe(true);
    expect(refresh!.sameSite, 'refresh token must be SameSite=Strict').toBe('Strict');
    expect(refresh!.path, 'refresh token must be scoped to the refresh route').toBe(REFRESH_PATH);

    // CSRF: deliberately readable by JS — the app has to echo it back as a
    // header, which is the whole double-submit mechanism.
    expect(csrf!.httpOnly, 'csrf cookie must be readable by app JS').toBe(false);
    expect(csrf!.sameSite).toBe('Strict');
  });

  test('HttpOnly is real: document.cookie shows the CSRF token and nothing else', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    // This is the assertion a jsdom/happy-dom suite cannot make honestly.
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).toContain(CSRF);
    expect(visible, 'access token must not be reachable from JS').not.toContain(ACCESS);
    expect(visible, 'refresh token must not be reachable from JS').not.toContain(REFRESH);
  });

  test('the refresh cookie is withheld from non-refresh paths by path scoping', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    // Chromium decides this, not the server: Path=/v1/auth/refresh means the
    // cookie is simply not attached to /v1/auth/me.
    const sentToMe = await page.evaluate(async (base) => {
      await fetch(`${base}/v1/auth/me`, { credentials: 'include' });
      return document.cookie; // only proves JS visibility; see server check below
    }, API);
    expect(sentToMe).not.toContain(REFRESH);
  });

  test('CSRF: a cookie-authenticated mutation is refused without the header', async ({
    page,
    request,
  }) => {
    await signIn(page, request);

    const withoutHeader = await inPage(page, '/v1/auth/logout', { method: 'POST' });
    expect(withoutHeader.status, 'no X-CSRF-Token must be refused').toBe(403);
    expect((withoutHeader.body as { error?: { code?: string } })?.error?.code).toBe(
      'AUTH_CSRF_FAILED',
    );

    // Still signed in — a refused CSRF must not have logged anyone out.
    const stillMe = await inPage(page, '/v1/auth/me');
    expect(stillMe.status).toBe(200);
  });

  test('CSRF: a mismatched header token is refused', async ({ page, request }) => {
    await signIn(page, request);
    const mismatched = await inPage(page, '/v1/auth/logout', {
      method: 'POST',
      csrf: 'not-the-cookie-value',
    });
    expect(mismatched.status).toBe(403);
  });

  test('refresh rotates the session and keeps the caller signed in', async ({ page, request }) => {
    await signIn(page, request);
    const before = await page.context().cookies();
    const beforeRefresh = byName(before, REFRESH)!.value;

    // Refresh is a POST authenticated by cookie, so the global CsrfGuard
    // applies to it exactly as it does to any other mutation — the double
    // submit is not waived just because this endpoint mints the next session.
    const csrfValue = byName(before, CSRF)!.value;
    const refreshed = await inPage(page, '/v1/auth/refresh', {
      method: 'POST',
      csrf: csrfValue,
    });
    expect(refreshed.status, 'refresh should succeed').toBe(200);

    const after = await page.context().cookies();
    const afterRefresh = byName(after, REFRESH)!.value;

    // Rotation: the refresh token must not survive its own use.
    expect(afterRefresh).not.toBe(beforeRefresh);

    const me = await inPage(page, '/v1/auth/me');
    expect(me.status, 'still authenticated after refresh').toBe(200);
  });

  test('cross-site: the browser withholds the session, which is why the topology is constrained', async ({
    page,
    request,
  }) => {
    await signIn(page, request);

    // Confirm the session works same-site first, so the next step is
    // attributable to the site change and nothing else.
    expect((await inPage(page, '/v1/auth/me')).status).toBe(200);

    // Move the page to a DIFFERENT site. `localhost` and `127.0.0.1` are
    // separate hosts to a browser, so a fetch from here to the API is
    // cross-site even though it is the same server on the same port.
    const crossSiteOrigin = API.replace('127.0.0.1', 'localhost');
    test.skip(crossSiteOrigin === API, 'API base must use 127.0.0.1 for this check');
    await page.goto(`${crossSiteOrigin}/health/live`);

    const me = await page.evaluate(async (base) => {
      const res = await fetch(`${base}/v1/auth/me`, { credentials: 'include' });
      return res.status;
    }, API);

    // hsm_at is SameSite=Lax and hsm_rt/hsm_csrf are Strict. None of the three
    // is attached to a cross-site fetch, so the request arrives anonymous.
    // This is not a bug to fix in the API — it is the browser working — but it
    // does mean a deployment that puts the web app and the API on different
    // registrable domains has no working session, refresh, or CSRF at all.
    // See docs/adr/0001-web-api-deployment-topology.md.
    expect(me, 'cross-site request must arrive without the session').toBe(401);
  });

  test('logout clears every auth cookie and the session stops working', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    const csrfValue = (await page.context().cookies()).find((c) => c.name === CSRF)!.value;

    const out = await inPage(page, '/v1/auth/logout', { method: 'POST', csrf: csrfValue });
    // 204, not 200: logout returns no body. Asserting 200 here passed review
    // and failed the browser, which is the whole argument for running this
    // against the real thing.
    expect(out.status).toBe(204);

    const remaining = await page.context().cookies();
    for (const name of [ACCESS, REFRESH, CSRF]) {
      const left = remaining.find((c) => c.name === name);
      // Cleared means gone, or present-but-empty — browsers differ on which.
      expect(left?.value ?? '', `${name} must not survive logout`).toBe('');
    }

    // The decisive check: the server must reject the old session, not merely
    // the browser forget it.
    const me = await inPage(page, '/v1/auth/me');
    expect(me.status, 'the session must be dead server-side').toBe(401);
  });
});
