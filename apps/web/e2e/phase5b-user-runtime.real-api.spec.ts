import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';

import { seedLanguage } from './fixtures';
import {
  acceptTerms,
  api,
  completeDraft,
  REAL_API,
  registerProvider,
  type Account,
} from './real-api';

// Sprint 09B.29 Phase 5B — THE USER'S OWN RUNTIME, not a purpose-built one.
//
// Every other real-API spec builds the stack it tests: its own preview server
// on its own port, serving a bundle built moments earlier with the flag it
// wants, against an isolated API. That proves the artifact works. It cannot
// prove the developer's browser reaches that artifact, and for this sprint that
// was exactly the thing that was false — the process on port 4000 was a build
// from a fortnight earlier, so `GET /onboarding/markets` 404'd because the
// route did not exist in it yet, and every green suite in the repository was
// green about a different API.
//
// So this spec starts no server and builds no bundle. It is pointed at the
// running development stack by environment and asserts what that stack does:
//
//   E2E_BASE_URL   the dev server the developer actually browses (5173)
//   E2E_REAL_API   the API that dev server is configured to call (4000)
//   E2E_MAILPIT    the mail catcher that stack delivers to (8025)
//   E2E_PREBUILT=1 do not start anything
//
// Two things are proved that a synthetic stack cannot prove:
//
//   1. WHERE THE BROWSER GOES. Every request the page makes is recorded, and
//      the onboarding traffic is asserted to reach the configured API origin
//      and no other. The reported symptom was a Network panel full of 404s
//      against localhost:4000; a suite that never opens the developer's own
//      front end has nothing to say about that.
//
//   2. WHICH BUILD ANSWERS. `markets` answering 200 rather than 404 and the
//      draft carrying `minBioLength` are both properties of the CURRENT server
//      build. An old build cannot fake either, so together they are a
//      build-identity assertion made from inside the browser rather than from
//      a docker image digest.
//
// Run:
//   E2E_REAL_API=http://localhost:4000 E2E_MAILPIT=http://localhost:8025 \
//   E2E_BASE_URL=http://localhost:5173 E2E_PREBUILT=1 \
//   pnpm exec playwright test phase5b-user-runtime --project=chromium-desktop

const OUT = join('e2e', '__artifacts__', 'phase5b-user-runtime');

/** The viewport the V2 rule names, and the one the report was made at. */
const PHONE = { width: 393, height: 852 };

interface Seen {
  url: string;
  method: string;
  status: number;
}

/** Record every request the page makes, with the status it came back with. */
function watch(page: Page): { seen: Seen[]; failed: string[] } {
  const seen: Seen[] = [];
  const failed: string[] = [];
  page.on('response', (res) => {
    seen.push({ url: res.url(), method: res.request().method(), status: res.status() });
  });
  page.on('requestfailed', (req: Request) => {
    failed.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'failed'}`);
  });
  return { seen, failed };
}

const apiCalls = (seen: Seen[]) => seen.filter((s) => /\/v1\//.test(s.url));
const onboardingCalls = (seen: Seen[]) =>
  seen.filter((s) => s.url.includes('/v1/me/provider/onboarding'));

function record(name: string, body: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(body, null, 2));
}

test.describe('Phase 5B — the development runtime the developer actually uses', () => {
  test.skip(!REAL_API, 'needs E2E_REAL_API pointing at the running development API');

  test.use({ viewport: PHONE });

  let account: Account;

  async function applyRealSession(context: BrowserContext, who: Account): Promise<void> {
    const host = new URL(REAL_API).hostname;
    await context.addCookies(
      [...who.jar].map(([name, value]) => ({
        name,
        value,
        domain: host,
        path: name === 'hsm_rt' ? '/v1/auth/refresh' : '/',
      })),
    );
  }

  test('the browser reaches the configured API, and that API is the current build', async ({
    page,
    context,
  }) => {
    const w = watch(page);
    account = await registerProvider();
    await applyRealSession(context, account);
    await seedLanguage(page, 'en');

    await page.goto('/provider/onboarding');

    // ── The V2 surface is what the developer's own runtime serves ──────────
    //
    // Nothing here seeds the localStorage override. If this passes, the flag is
    // genuinely on in the bundle the dev server is serving — which is the only
    // form of "V2 is enabled" that answers the question asked.
    await expect(page.getByTestId('onboarding-v2-shell')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    // ── 1. WHERE the traffic went ─────────────────────────────────────────
    const origin = new URL(REAL_API).origin;
    const calls = apiCalls(w.seen);
    expect(calls.length, 'the hub must actually call the API').toBeGreaterThan(0);

    const strangers = calls.filter((c) => new URL(c.url).origin !== origin);
    expect(strangers, `every /v1 call must go to ${origin}`).toEqual([]);

    // ── 2. The route that 404'd ───────────────────────────────────────────
    //
    // Asserted on the STATUS the browser received, not on a curl beside it.
    // The reported failure was a repeating 404 here, and a repeating one at
    // that: the query retried a permanent failure forever.
    const markets = onboardingCalls(w.seen).filter((c) => c.url.includes('/markets'));
    if (markets.length > 0) {
      expect(
        markets.filter((m) => m.status === 404),
        'GET /onboarding/markets must not 404 — that was the stale build',
      ).toEqual([]);
    }

    // Whether or not the hub happens to request it, ask it directly through
    // the browser's own fetch, with the browser's own cookies.
    const direct = await page.evaluate(async (base) => {
      const res = await fetch(`${base}/v1/me/provider/onboarding/markets`, {
        credentials: 'include',
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    }, REAL_API);

    expect(direct.status, 'the browser must get 200 from the markets endpoint').toBe(200);
    const list = direct.body.markets as Array<{
      countryCode: string;
      radius: Record<string, number>;
    }>;
    expect(Array.isArray(list), 'markets is the real contract').toBe(true);
    expect(list.length, 'at least one market is configured and enabled').toBeGreaterThan(0);

    // A picker whose bounds are 0-0 km is configured, and unusable. The write
    // path enforces the schema's numbers, so the read model must offer them.
    for (const m of list) {
      expect(m.radius.minKm, `${m.countryCode}: radius floor`).toBeGreaterThan(0);
      expect(m.radius.maxKm, `${m.countryCode}: radius ceiling`).toBeGreaterThan(m.radius.minKm);
    }

    // ── 3. WHICH build answered ───────────────────────────────────────────
    //
    // `minBioLength` is served from the policy constant by the current build
    // and does not exist in the one that was running. Read through the
    // browser, so it is the same process the screens are talking to.
    const draft = await page.evaluate(async (base) => {
      const res = await fetch(`${base}/v1/me/provider/onboarding/draft`, {
        credentials: 'include',
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    }, REAL_API);

    expect(draft.status).toBe(200);
    const data = draft.body.data as Record<string, unknown>;
    expect(
      typeof data.minBioLength,
      'the draft must carry the current contract, not the fortnight-old one',
    ).toBe('number');

    // ── 4. Nothing failed at the transport level ──────────────────────────
    expect(w.failed, 'no request may fail outright').toEqual([]);

    record('runtime', {
      baseURL: page.url(),
      apiOrigin: origin,
      v1Calls: calls.length,
      onboarding: onboardingCalls(w.seen),
      marketsStatus: direct.status,
      markets: list.map((m) => ({ countryCode: m.countryCode, radius: m.radius })),
      minBioLength: data.minBioLength,
    });
  });

  test('a provider whose ONLY outstanding item is specialty moderation reaches 6 of 6', async ({
    page,
    context,
  }) => {
    // Sprint 09B.29 Phase 5B — the journey behind the "stuck at 4 of 6" report.
    //
    // Selecting a specialty creates a PENDING `ProviderCategoryApplication`.
    // Membership is granted only when an admin approves it, so between those
    // two moments the provider holds nothing — and the question the policy has
    // to answer is whose move it is. It is the moderator's. The provider has
    // done everything asked of them, so onboarding completeness counts the step
    // as done and the review must let them submit.
    //
    // Nothing in this test approves anything. That is the whole point: if the
    // counter only reaches 6 of 6 after an approval, then pending moderation is
    // blocking submission, which is the defect.
    const w = watch(page);
    const pending = await registerProvider();

    // Every collecting step, through the real API, exactly once, plus the
    // consent the review folds into `canSubmit`. No admin session is opened
    // anywhere in this test.
    //
    // Consent is separate from the six hub tasks and is easy to leave out: the
    // first run of this test did, read `canSubmit: false`, and looked exactly
    // like the moderation deadlock it exists to disprove. A test that cannot
    // tell "the provider has not agreed to the terms" from "the platform is
    // holding their application" is not evidence about either.
    await completeDraft(pending);
    await acceptTerms(pending);

    const hub = await api<{
      progress: { complete: number; total: number };
      tasks: Array<{ id: string; status: string }>;
    }>(pending.jar, '/v1/me/provider/onboarding/hub');
    expect(hub.status).toBe(200);

    const review = await api<{ canSubmit: boolean; blockers: unknown[] }>(
      pending.jar,
      '/v1/me/provider/onboarding/review',
    );
    expect(review.status).toBe(200);

    // The specialty is genuinely un-approved: the provider holds no membership.
    const draft = await api<{ data: { specialties: Array<{ state: string }> } }>(
      pending.jar,
      '/v1/me/provider/onboarding/draft',
    );
    const states = (draft.body.data.specialties ?? []).map((s) => s.state);
    expect(states.length, 'the provider chose a specialty').toBeGreaterThan(0);
    expect(
      states.some((s) => s === 'APPROVED'),
      'nothing in this test approves anything — the state under test is PENDING',
    ).toBe(false);

    record('pending-only', {
      progress: hub.body.progress,
      tasks: hub.body.tasks,
      specialtyStates: states,
      canSubmit: review.body.canSubmit,
      blockers: review.body.blockers,
    });

    // THE RULE, asserted on the task rather than on the total: a task whose
    // only outstanding item is our approval is done as far as the provider is
    // concerned, so it is WAITING — never a demand for input they have already
    // given. The moderation axis stays visible in the status word; it is not
    // folded into the number and it is not called "Required".
    const services = hub.body.tasks.find((t) => t.id === 'SERVICES_EXPERIENCE');
    expect(services?.status, 'the Services task is waiting on US, not on them').toBe('WAITING');

    // Every collecting task has been answered. The one task that is not yet
    // counted is Review itself, which completes by being used.
    const outstanding = hub.body.tasks
      .filter((t) => t.status !== 'COMPLETE' && t.status !== 'WAITING')
      .map((t) => t.id);
    expect(outstanding, 'nothing but the review step is left to do').toEqual(['REVIEW_SUBMISSION']);
    expect(hub.body.progress).toEqual({ complete: 5, total: 6 });

    expect(review.body.canSubmit, 'pending moderation may block ACTIVATION, never submission').toBe(
      true,
    );

    // ── The same thing, on screen, in the developer's own runtime ─────────
    //
    // Before the submission rather than after: submitting moves the hub into
    // its SUBMITTED presentation, and the state under test is the one the
    // provider is actually stuck in — every answer given, one decision pending,
    // still looking at their task list.
    await applyRealSession(context, pending);
    await seedLanguage(page, 'en');
    await page.goto('/provider/onboarding');

    await expect(page.getByTestId('hub-task-list')).toBeVisible({ timeout: 45_000 });

    // Not a page-wide phrase search. State 14 taught this the hard way: two
    // rows said "In review", so searching the document passed while the row
    // that mattered read something else entirely. The assertion is scoped to
    // the Services row's own status element.
    const servicesStatus = page.getByTestId('task-status-SERVICES_EXPERIENCE');
    await expect(servicesStatus).toBeVisible();
    const label = ((await servicesStatus.textContent()) ?? '').trim();
    expect(label.length, 'the Services row states a status').toBeGreaterThan(0);
    expect(
      /required/i.test(label),
      `Services must not say "Required" when the provider has answered: got "${label}"`,
    ).toBe(false);

    // The counter the report named. Five of six, with the sixth being Review
    // itself — not the four the stale build produced.
    const shell = page.getByTestId('onboarding-v2-shell');
    await expect(shell).toContainText(/5\s*(of|\/)\s*6/i);

    record('pending-only-screen', {
      servicesStatusLabel: label,
      hubText: ((await shell.textContent()) ?? '').replace(/\s+/g, ' ').slice(0, 400),
    });

    expect(w.failed, 'no request may fail outright').toEqual([]);

    // ── And it really does submit, with the specialty still un-approved ────
    // The submission carries the revision it was raised against, so one made
    // from a stale tab is refused rather than committing content the provider
    // never saw. Read fresh: completing the draft and accepting the terms have
    // both advanced the revision since this test last looked at it.
    const current = await api<{ version: number }>(pending.jar, '/v1/me/provider/onboarding/draft');
    const submitted = await api<{ state?: string }>(
      pending.jar,
      '/v1/me/provider/onboarding/submit',
      { method: 'POST', body: { version: current.body.version } },
    );
    expect(submitted.status, 'a provider waiting only on moderation may submit').toBe(200);

    const after = await api<{
      progress: { complete: number; total: number };
      status: string;
    }>(pending.jar, '/v1/me/provider/onboarding/hub');
    expect(after.body.progress, 'and the hub then reads 6 of 6').toEqual({
      complete: 6,
      total: 6,
    });

    record('pending-only-after-submit', {
      progress: after.body.progress,
      status: after.body.status,
    });
  });
});
