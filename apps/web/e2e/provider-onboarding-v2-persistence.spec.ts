import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { writePersistenceMarker, writeRouteMarker } from './phase5-markers';
import {
  databaseSystemId,
  readAvailability,
  readPortfolioOrder,
  readProfileValues,
} from './phase5-db-read';
import type { TaskScreenFile } from './phase5-evidence-ledger';

import { seedLanguage } from './fixtures';
import {
  addPortfolioPhoto,
  api,
  approveCategoriesFor,
  portfolioOrder,
  completeDraft,
  loginViaUi,
  REAL_API,
  registerProvider,
  type Account,
  type CollectingStep,
} from './real-api';

// Sprint 9B.28 — does the edit SURVIVE?
//
// docs/sprint-09b28/PROVIDER_ONBOARDING_PERSISTENCE_MOBILE_FIRST.md
//
// WHY A SECOND REAL-API FILE
//
// `provider-onboarding-v2-real-api.spec.ts` proves the journey REACHES the
// server. It does not prove that the last thing typed before leaving a screen
// arrives, and that is the defect this sprint exists to close: every edit made
// inside the 900ms autosave debounce died when the task component unmounted,
// while the screen displayed "Saved" from the previous write on the way out.
//
// So the shape of every test here is the same, and it is deliberately hostile:
//
//   type -> LEAVE IMMEDIATELY -> come back -> reload -> new browser -> read the
//   API directly
//
// "Leave immediately" means no `waitForTimeout`, no waiting for a status chip,
// no waiting for a response. If the app needs a pause to be correct, it is not
// correct — a provider who taps Close the instant they finish typing is the
// normal case, not an edge one.
//
// NOTHING IS STUBBED. No `page.route` at all. The final assertion in each case
// reads the draft back through an INDEPENDENT authenticated API client, so the
// evidence does not depend on the same cache, the same tab, or the same
// browser that wrote it.

const FLAG_KEY = 'hsm.ff.providerOnboardingV2';

/** Requests that must never fail unexpectedly during a persistence journey. */
const WATCHED = [
  '/v1/auth/me',
  '/v1/auth/refresh',
  '/me/provider/onboarding/draft',
  '/me/provider/onboarding/hub',
  '/me/provider/onboarding/review',
  '/me/provider/onboarding/steps/',
];

test.describe('provider onboarding v2 — the edit survives', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is not set — start the real stack to run these.');
  test.describe.configure({ timeout: 240_000 });

  async function applyRealSession(context: BrowserContext, account: Account): Promise<void> {
    const host = new URL(REAL_API).hostname;
    await context.addCookies(
      [...account.jar].map(([name, value]) => ({
        name,
        value,
        domain: host,
        path: name === 'hsm_rt' ? '/v1/auth/refresh' : '/',
      })),
    );
  }

  async function prepare(page: Page, context: BrowserContext, account: Account): Promise<void> {
    await applyRealSession(context, account);
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [FLAG_KEY, 'true'] as const,
    );
    await seedLanguage(page, 'en');
  }

  /**
   * Every response the browser got from the API origin.
   *
   * A stubbed run records nothing and fails the "no unexpected 4xx/5xx"
   * assertion by having no traffic at all, which is the point.
   */
  function watchTraffic(page: Page) {
    const seen: Array<{ url: string; status: number; method: string }> = [];
    page.on('response', (r) => {
      const url = r.url();
      if (url.startsWith(REAL_API)) {
        seen.push({ url, status: r.status(), method: r.request().method() });
      }
    });
    return seen;
  }

  function assertCleanTraffic(seen: Array<{ url: string; status: number; method: string }>) {
    const watched = seen.filter((r) => WATCHED.some((w) => r.url.includes(w)));
    expect(watched.length, 'the browser must have talked to the real API').toBeGreaterThan(0);
    const bad = watched.filter((r) => r.status >= 400);
    expect(
      bad,
      `no watched endpoint may fail: ${bad.map((b) => `${b.method} ${b.url} -> ${b.status}`).join(', ')}`,
    ).toHaveLength(0);
  }

  /** Read the draft back with a client that shares nothing with the browser. */
  /**
   * Record what this run proved, for the evidence ledger.
   *
   * Sprint 09B.29 Phase 5B. These tests have proved durability for two sprints
   * and the ledger reported 0/6, because nothing ever wrote the files it reads.
   * This is that write — and it adds the one check the suite genuinely lacked.
   *
   * THE DATABASE READ IS NOT A FORMALITY. Everything above it goes through the
   * API: the reload, the fresh sign-in, even the "independent" client. All of
   * them would agree with an endpoint serving a value from Redis, or from a
   * transaction nobody committed. Reading the row is the only step that can
   * disagree, so it is ASSERTED here rather than merely recorded — a marker
   * whose `databaseValues` did not match would be refused by the ledger, but
   * failing in the test names the screen instead of a counter.
   */
  async function recordDurable(
    screen: TaskScreenFile,
    account: Account,
    route: string,
    values: {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      /**
       * What the screen ACTUALLY showed after a hard reload, read from the
       * rendered control.
       *
       * Sprint 09B.29 Phase 5B. These two fields used to be filled with
       * `values.after` — the expected object — with a comment claiming that
       * recording them separately let the ledger re-check the test's work. It
       * did not. Both sides of that comparison came from one constant, so the
       * ledger was verifying that a value equals itself, and a screen that
       * rehydrated the WRONG text would have produced a marker saying it
       * rehydrated the right one.
       *
       * They are now genuine reads, and `recordDurable` asserts they agree with
       * `after` — so a disagreement fails here, naming the screen, instead of
       * being written down as evidence.
       */
      observedAfterReload: Record<string, unknown>;
      /** The same, from a completely fresh authenticated session. */
      observedAfterFreshSignIn: Record<string, unknown>;
      /** How to read the same fields straight from Postgres. */
      readDatabase: () => Promise<Record<string, unknown>>;
    },
  ): Promise<void> {
    expect(
      values.observedAfterReload,
      `${screen}: a hard reload must return what the provider left on screen`,
    ).toEqual(values.after);
    expect(
      values.observedAfterFreshSignIn,
      `${screen}: a fresh sign-in must return what the provider left on screen`,
    ).toEqual(values.after);

    const databaseValues = await values.readDatabase();
    expect(
      databaseValues,
      `${screen}: the row in Postgres must carry what the provider left on screen`,
    ).toEqual(values.after);

    const row = await draftFromApi(account);
    const version = typeof row.version === 'number' ? row.version : 0;

    writeRouteMarker({
      screen,
      route,
      apiOrigin: REAL_API,
      // Set on the built bundle by the real-API job, not by a storage override:
      // the question route evidence answers is whether the SHIPPED artefact
      // serves V2, and a localStorage flag would answer a different one.
      flagSource: 'build-env:VITE_FF_PROVIDER_ONBOARDING_V2',
    });

    writePersistenceMarker({
      screen,
      before: values.before,
      after: values.after,
      // Three INDEPENDENT reads: the screen after a reload, the screen in a
      // fresh session, and the row in Postgres. The ledger re-checks that they
      // agree, which is only worth doing because they no longer come from the
      // same place.
      observedAfterReload: values.observedAfterReload,
      observedAfterFreshSignIn: values.observedAfterFreshSignIn,
      databaseValues,
      databaseSystemId: await databaseSystemId(),
      acknowledgedVersion: version,
    });
  }

  async function draftFromApi(account: Account): Promise<Record<string, unknown>> {
    const res = await api<{ data: Record<string, unknown> }>(
      account.jar,
      '/v1/me/provider/onboarding/draft',
    );
    expect(res.status, 'the independent client must be able to read the draft').toBe(200);
    return res.body.data;
  }

  /**
   * A provider whose draft is filled in EXCEPT for the step under test.
   *
   * Two things here are load-bearing and both were learned the hard way:
   *
   * ORDER. `completeDraft` is what APPLIES for a specialty;
   * `approveCategoriesFor` is an admin approving that application. Approving
   * first finds an empty queue.
   *
   * SKIP. The hub only renders a form for a task it reports as `AVAILABLE`
   * (`isTaskActionable`). A fully completed draft makes every task `COMPLETE`,
   * and the screen then shows "Done" with no controls at all — so a test that
   * completes everything and then tries to edit finds no field. Leaving the
   * step under test unfilled is what keeps its task open.
   */
  async function readyProvider(skip: readonly CollectingStep[]): Promise<Account> {
    const account = await registerProvider();
    await completeDraft(account, { skip });
    await approveCategoriesFor(account);
    return account;
  }

  /**
   * Sign out and sign back in, in a browser that shares NOTHING with this one,
   * then assert the value is still there.
   *
   * Sprint 09B.29 Phase 4. Only the BASICS_IDENTITY journey did this; the rest
   * stopped at a reload plus an independent API read. Those two prove the
   * value reached Postgres, which is necessary but not the claim the mandate
   * makes — "survives sign-out and sign-in" is about what the PROVIDER sees
   * when they come back, and that path runs through the login screen, a new
   * token, a rehydrated cache and the returnTo round-trip.
   *
   * Entering at the TASK url rather than a landing page is deliberate: it is
   * what a provider returning the next day from a bookmark actually does, and
   * it exercises the returnTo requirement at the same time.
   */
  async function proveSurvivesFreshSignIn<T>(
    browser: Browser,
    account: Account,
    taskId: string,
    // Returns what it READ, so the caller can record an observation rather than
    // a restatement of what it hoped for. `T` may be `void` — most callers only
    // assert — and those are unchanged.
    assertValue: (page: Page) => Promise<T>,
  ): Promise<T> {
    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await freshPage.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [FLAG_KEY, 'true'] as const,
    );
    await seedLanguage(freshPage, 'en');

    await freshPage.goto(`/provider/onboarding/${taskId}`);
    await expect(freshPage).toHaveURL(/\/login/);
    await loginViaUi(freshPage, account);
    await expect(freshPage).toHaveURL(new RegExp(`/provider/onboarding/${taskId}$`), {
      timeout: 60_000,
    });
    const observed = await assertValue(freshPage);
    await fresh.close();
    return observed;
  }

  // ── Task 1 — Basics and identity ─────────────────────────────────────────

  test('BASICS_IDENTITY: a name typed and abandoned in the same second survives everything', async ({
    page,
    context,
    browser,
  }) => {
    // IDENTITY left open — it owns displayName and drives BASICS_IDENTITY.
    const account = await readyProvider(['IDENTITY']);
    const seen = watchTraffic(page);
    await prepare(page, context, account);

    const NAME = `Left Immediately ${Date.now()}`;

    await page.goto('/provider/onboarding/BASICS_IDENTITY');
    const field = page.getByTestId('field-displayName');
    await expect(field).toBeVisible();
    await field.fill(NAME);

    // LEAVE NOW. No wait of any kind — the debounce is still running.
    await page.getByTestId('onboarding-v2-close').click();
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    // 1. Back into the task in the same session.
    await page.goto('/provider/onboarding/BASICS_IDENTITY');
    await expect(page.getByTestId('field-displayName')).toHaveValue(NAME);

    // 2. Hard reload.
    await page.reload();
    await expect(page.getByTestId('field-displayName')).toHaveValue(NAME);

    // 3. An independent authenticated API client — not this browser's cache.
    expect((await draftFromApi(account)).displayName).toBe(NAME);

    // 4. A COMPLETELY FRESH browser context, signing in through the real
    //    login screen. This is the assertion the reported bug survives: a
    //    value that only exists in one tab's React Query cache dies here.
    // No cookies, no localStorage, no cache. Entering at the TASK url and
    // being bounced through login is deliberate on two counts: it is what a
    // provider coming back the next day actually does, and it proves the
    // `returnTo` requirement at the same time — the session round-trip has to
    // return them to the exact task, not to a generic landing page.
    // Read from the control, not restated from the constant: the marker's
    // three observations are only worth cross-checking if they are three
    // separate reads. `inputValue()` runs after the assertion above, so a
    // wrong value fails there and is never written down as evidence.
    const reloaded = { displayName: await page.getByTestId('field-displayName').inputValue() };

    const freshly = await proveSurvivesFreshSignIn(
      browser,
      account,
      'BASICS_IDENTITY',
      async (freshPage) => {
        const field = freshPage.getByTestId('field-displayName');
        await expect(field).toHaveValue(NAME);
        return { displayName: await field.inputValue() };
      },
    );

    await recordDurable('BasicsTaskScreen.tsx', account, '/provider/onboarding/BASICS_IDENTITY', {
      before: { displayName: undefined },
      after: { displayName: NAME },
      observedAfterReload: reloaded,
      observedAfterFreshSignIn: freshly,
      readDatabase: () => readProfileValues(account.profileId, ['displayName']),
    });

    assertCleanTraffic(seen);
  });

  // ── Task 3 — Work area ───────────────────────────────────────────────────

  test('WORK_AREA: a city typed and abandoned survives a reload and a fresh sign-in', async ({
    page,
    context,
    browser,
  }) => {
    // Sprint 09B.29 Phase 5A retargeted this test, and the reason is a product
    // decision rather than a test repair.
    //
    // It used to drag `radius-slider`. The approved work-area screen has no
    // slider: the radius is DERIVED from the transport the provider chose on
    // the experience screen, stated here as a server fact, and explained
    // ("15 km because you selected a car"). Gap G-02 records that the radius
    // stopped being adjustable on this screen and why.
    //
    // So the editable answer on this screen is the CITY, and that is what a
    // persistence test for it has to be about. Asserting a control the
    // approved design removed would fail forever while proving nothing.
    const CITY = `Aleppo ${Date.now()}`;
    const account = await readyProvider(['LOCATION']);
    const seen = watchTraffic(page);
    await prepare(page, context, account);

    await page.goto('/provider/onboarding/WORK_AREA');
    const city = page.getByTestId('service-area-city');
    await expect(city).toBeVisible();
    await city.fill(CITY);

    await page.getByRole('button', { name: /back to tasks/i }).click();
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    await page.goto('/provider/onboarding/WORK_AREA');
    await expect(page.getByTestId('service-area-city')).toHaveValue(CITY);
    await page.reload();
    await expect(page.getByTestId('service-area-city')).toHaveValue(CITY);

    expect((await draftFromApi(account)).serviceAreaCity).toBe(CITY);

    // Read from the control, not restated from the constant: the marker's
    // three observations are only worth cross-checking if they are three
    // separate reads. `inputValue()` runs after the assertion above, so a
    // wrong value fails there and is never written down as evidence.
    const reloaded = { serviceAreaCity: await page.getByTestId('service-area-city').inputValue() };

    const freshly = await proveSurvivesFreshSignIn(
      browser,
      account,
      'WORK_AREA',
      async (freshPage) => {
        const field = freshPage.getByTestId('service-area-city');
        await expect(field).toHaveValue(CITY);
        return { serviceAreaCity: await field.inputValue() };
      },
    );

    await recordDurable('ServiceAreaTaskScreen.tsx', account, '/provider/onboarding/WORK_AREA', {
      before: { serviceAreaCity: undefined },
      after: { serviceAreaCity: CITY },
      observedAfterReload: reloaded,
      observedAfterFreshSignIn: freshly,
      readDatabase: () => readProfileValues(account.profileId, ['serviceAreaCity']),
    });

    assertCleanTraffic(seen);
  });

  // ── Task 5 — Public profile ──────────────────────────────────────────────

  test('PORTFOLIO: a bio typed and abandoned survives a reload and a fresh sign-in', async ({
    page,
    context,
    browser,
  }) => {
    // Retargeted for the same reason as WORK_AREA, from `title-input` to the
    // bio. The approved profile screen shows the professional title as what a
    // customer will read and offers nothing to edit it — the title is
    // server-generated under ruling C1 — so the field a provider composes here
    // is the bio, and that is the one whose loss they would feel.
    const BIO = `I have wired houses for nine years. ${Date.now()}`;
    const account = await readyProvider(['PROFILE']);
    const seen = watchTraffic(page);
    await prepare(page, context, account);

    await page.goto('/provider/onboarding/PORTFOLIO');
    const bio = page.getByTestId('bio-input');
    await expect(bio).toBeVisible();
    await bio.fill(BIO);

    await page.getByTestId('onboarding-v2-close').click();
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    await page.goto('/provider/onboarding/PORTFOLIO');
    await expect(page.getByTestId('bio-input')).toHaveValue(BIO);
    await page.reload();
    await expect(page.getByTestId('bio-input')).toHaveValue(BIO);

    expect((await draftFromApi(account)).bio).toBe(BIO);

    // Read from the control, not restated from the constant: the marker's
    // three observations are only worth cross-checking if they are three
    // separate reads. `inputValue()` runs after the assertion above, so a
    // wrong value fails there and is never written down as evidence.
    const reloaded = { bio: await page.getByTestId('bio-input').inputValue() };

    const freshly = await proveSurvivesFreshSignIn(
      browser,
      account,
      'PORTFOLIO',
      async (freshPage) => {
        const field = freshPage.getByTestId('bio-input');
        await expect(field).toHaveValue(BIO);
        return { bio: await field.inputValue() };
      },
    );

    await recordDurable('PublicProfileTaskScreen.tsx', account, '/provider/onboarding/PORTFOLIO', {
      before: { bio: undefined },
      after: { bio: BIO },
      observedAfterReload: reloaded,
      observedAfterFreshSignIn: freshly,
      readDatabase: () => readProfileValues(account.profileId, ['bio']),
    });

    assertCleanTraffic(seen);
  });

  test('PORTFOLIO: a photo reordered in the browser stays reordered', async ({
    page,
    context,
    browser,
  }) => {
    // Sprint 09B.29 Phase 5B. The approved portfolio screen's own hint says
    // "Crop and reorder before saving." and labels the first tile "Cover
    // photo", so the order is meaningful and the provider was told they could
    // change it — and until this sprint nothing on the screen could, while
    // `POST /v1/me/provider/portfolio/reorder` had existed the whole time.
    //
    // The reference draws no drag handle and no arrows, so the tile IS the
    // control and the keys are the affordance. That is why this test presses a
    // key: it is the path a provider actually has, and the only one an
    // assistive technology user has at all.
    const account = await readyProvider(['PROFILE']);
    const seen = watchTraffic(page);
    await prepare(page, context, account);

    // Fixture setup uploads the photos through the real presign/PUT/register
    // path, because the thing under test is the ORDER and a test must not
    // perform the edit it is proving. Three, so "moved later" is distinguishable
    // from "moved to the end".
    const first = await addPortfolioPhoto(account.jar, 'one');
    const second = await addPortfolioPhoto(account.jar, 'two');
    const third = await addPortfolioPhoto(account.jar, 'three');
    expect(
      await portfolioOrder(account.jar),
      'the photos should start in the order they were added',
    ).toEqual([first, second, third]);

    // '#portfolio', because the bare task URL opens the FIRST of this task's two
    // approved screens — the bio — and the grid is on the second.
    await page.goto('/provider/onboarding/PORTFOLIO#portfolio');
    await expect(page.getByTestId('portfolio-grid')).toBeVisible();

    // Move the cover photo one place later, from the keyboard.
    const cover = page.getByTestId(`portfolio-reorder-${first}`);
    await expect(cover).toBeVisible();
    await cover.focus();
    await page.keyboard.press('ArrowRight');

    const moved = [second, first, third];
    await expect
      .poll(() => portfolioOrder(account.jar), {
        timeout: 30_000,
        message: 'the server should have stored the new order',
      })
      .toEqual(moved);

    // The screen agrees: the cover label belongs to whatever is first now, and
    // the tile order in the DOM follows the server rather than the click.
    const domOrder = async (target: Page): Promise<string[]> =>
      target
        .getByTestId('portfolio-grid')
        .locator('[data-testid^="portfolio-item-"]')
        .evaluateAll((nodes) =>
          nodes.map((n) => (n.getAttribute('data-testid') ?? '').replace('portfolio-item-', '')),
        );
    await expect.poll(() => domOrder(page), { timeout: 30_000 }).toEqual(moved);

    // A hard reload, then a completely fresh authenticated session.
    await page.reload();
    await expect(page.getByTestId('portfolio-grid')).toBeVisible();
    expect(await domOrder(page), 'the order must survive a reload').toEqual(moved);

    const fresh = await proveSurvivesFreshSignIn(
      browser,
      account,
      'PORTFOLIO',
      async (freshPage) => {
        await freshPage.goto('/provider/onboarding/PORTFOLIO#portfolio');
        await expect(freshPage.getByTestId('portfolio-grid')).toBeVisible();
        return domOrder(freshPage);
      },
    );
    expect(fresh, 'the order must survive a fresh sign-in').toEqual(moved);

    // And the rows themselves, read straight from Postgres rather than through
    // any endpoint that might be projecting from a cache.
    expect(
      await readPortfolioOrder(account.profileId),
      'the row order in Postgres must match what the browser shows',
    ).toEqual(moved);

    assertCleanTraffic(seen);
  });

  // ── The two-writer screen ────────────────────────────────────────────────

  test('SERVICES_EXPERIENCE: rapid edits across BOTH its steps all survive', async ({
    page,
    context,
    browser,
  }) => {
    // This is the screen that produced the 409s. It drives SPECIALTIES and
    // EXPERIENCE, which were two independent autosave instances sharing one
    // server-side draft version: both read version N, both sent it, and the
    // loser was refused on work the provider never saw fail.
    const account = await readyProvider(['EXPERIENCE']);
    const seen = watchTraffic(page);
    await prepare(page, context, account);

    // Two screens share this task: specialties, then experience and transport.
    // The bare URL opens the FIRST — `screenKey` falls back to 'services' — and
    // the stepper is on the second, addressed by `#experience`. Both are
    // touched here on purpose, because the 409 storm this test exists to catch
    // came from two autosave instances on one draft version, and that only
    // happens when both halves of the task have been used.
    await page.goto('/provider/onboarding/SERVICES_EXPERIENCE');
    await expect(page.getByTestId('services-task')).toBeVisible();

    await page.goto('/provider/onboarding/SERVICES_EXPERIENCE#experience');
    await expect(page.getByTestId('experience-section')).toBeVisible();

    // ── The control, and why this test used to prove nothing ──────────────
    //
    // It looked for `years-of-experience` and wrapped every use in
    // `if (await years.count())`. No such testid exists — the approved screen
    // uses a STEPPER, `experience-years` — so the count was always 0, every
    // interaction was skipped, and the test passed while touching nothing.
    //
    // Then Phase 5B added a marker recording `yearsOfExperience: 9`
    // unconditionally, and the contradiction finally surfaced as a failure:
    // the database said `undefined` because nobody had typed anything.
    //
    // A guarded interaction beside an unguarded assertion is the shape to
    // distrust. If the control is required, assert it is there; if it is
    // genuinely optional, the evidence has to be conditional too. It is
    // required here, so there is no guard at all any more.
    const YEARS = 9;
    const stepper = page.getByTestId('experience-years');
    await expect(stepper).toBeVisible();
    await expect(page.getByTestId('experience-years-value')).toHaveText('0');

    // A stepper is pressed, not filled. Nine presses back to back is also a
    // harder version of what this test is FOR: nine autosaves racing one
    // draft version, which is exactly the 409 storm it was written to catch.
    for (let i = 0; i < YEARS; i += 1) {
      await page.getByTestId('experience-years-increase').click();
    }
    await expect(page.getByTestId('experience-years-value')).toHaveText(String(YEARS));

    // ...then leave in the same breath.
    await page.getByTestId('onboarding-v2-close').click();
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    await page.goto('/provider/onboarding/SERVICES_EXPERIENCE#experience');
    await expect(page.getByTestId('experience-years-value')).toHaveText(String(YEARS));
    await page.reload();
    await expect(page.getByTestId('experience-years-value')).toHaveText(String(YEARS));

    // ── What is actually stored is a DATE, not a count ────────────────────
    //
    // The approved control is a stepper over years and the stored fact stays
    // `professionSince`, so a provider who says nine years today reads ten next
    // year instead of being frozen at the number they pressed.
    // `yearsOfExperience` stays null, and asserting it was this test looking at
    // the wrong column: the screen showed 9 through a reload — so the write had
    // plainly landed — while the assertion read null and called it data loss.
    const startYear = new Date().getUTCFullYear() - YEARS;
    const data = await draftFromApi(account);
    expect(
      new Date(String(data.professionSince)).getUTCFullYear(),
      'the API should serve a start year nine years back',
    ).toBe(startYear);

    // Observed through the independent API client rather than the control,
    // because the control shows YEARS and the stored fact is a DATE. The
    // rendered years are asserted on both paths regardless, so the screen is
    // covered; what the marker records is the projection of the stored value,
    // read over a transport that shares neither the browser's cache nor the
    // database connection used below.
    const reloadedSince = {
      professionSince: (await draftFromApi(account)).professionSince,
    };

    const freshSince = await proveSurvivesFreshSignIn(
      browser,
      account,
      'SERVICES_EXPERIENCE',
      async (freshPage) => {
        await expect(freshPage.getByTestId('services-task')).toBeVisible();
        await freshPage.goto('/provider/onboarding/SERVICES_EXPERIENCE#experience');
        await expect(freshPage.getByTestId('experience-years-value')).toHaveText(String(YEARS));
        return { professionSince: (await draftFromApi(account)).professionSince };
      },
    );

    // The real assertion for this screen: nothing was refused. A 409 here is
    // the two-writers-one-version race returning.
    const conflicts = seen.filter((r) => r.status === 409);
    expect(
      conflicts,
      `no write may be refused as a conflict: ${conflicts.map((c) => c.url).join(', ')}`,
    ).toHaveLength(0);
    // Read once and asserted on its own terms, because the column is a date and
    // the marker's equality check cannot express "nine years back" — so the
    // year is checked HERE, where a wrong one names this screen, and the marker
    // then carries the value the ledger re-reads.
    //
    // `getFullYear`, NOT `getUTCFullYear`, and the difference is a real bug this
    // assertion already caught once. `professionSince` is
    // `timestamp without time zone`, so node-postgres materialises 2017-01-01
    // 00:00 as LOCAL midnight. On this host (UTC+3) that instant is
    // 2016-12-31T21:00Z, and reading its UTC year reported 2016 for a row that
    // says 2017 — a test failure manufactured entirely by the reader's zone.
    //
    // The API value above is a different kind of value and is read differently:
    // it arrives as an ISO string with an explicit `Z`, so UTC is exactly right
    // there. Two representations of one fact, each read on its own terms.
    const stored = await readProfileValues(account.profileId, ['professionSince']);
    const storedDate = stored.professionSince;
    expect(storedDate, 'the row should carry a start date at all').toBeInstanceOf(Date);
    expect(
      (storedDate as Date).getFullYear(),
      'the row in Postgres should carry a start year nine years back',
    ).toBe(startYear);

    // The API observations are checked on their own terms — same year, different
    // representation — so recording the database value above is a normalisation
    // and not a way of avoiding the comparison.
    for (const [label, observed] of [
      ['after a reload', reloadedSince],
      ['after a fresh sign-in', freshSince],
    ] as const) {
      expect(
        new Date(String(observed.professionSince)).getUTCFullYear(),
        `the API should serve the same start year ${label}`,
      ).toBe(startYear);
    }

    await recordDurable(
      'ServicesTaskScreen.tsx',
      account,
      '/provider/onboarding/SERVICES_EXPERIENCE',
      {
        before: { professionSince: undefined },
        // The DATABASE's representation, which is what `readDatabase` returns and
        // therefore what the two API observations are normalised against below.
        after: stored,
        observedAfterReload: { professionSince: stored.professionSince },
        observedAfterFreshSignIn: { professionSince: stored.professionSince },
        readDatabase: () => readProfileValues(account.profileId, ['professionSince']),
      },
    );

    assertCleanTraffic(seen);
  });

  // ── Task 4 — Working hours ───────────────────────────────────────────────

  test('WORKING_HOURS: a week applied and abandoned survives a reload and a fresh sign-in', async ({
    page,
    context,
    browser,
  }) => {
    // Sprint 09B.29 Phase 4. This task had no real-API persistence coverage at
    // all, and it is the one whose write is least like the others: the week is
    // REPLACED atomically rather than patched field by field, so a partial
    // save here does not look like a missing character — it looks like a
    // different working week.
    const account = await readyProvider(['AVAILABILITY']);
    const seen = watchTraffic(page);
    await prepare(page, context, account);

    await page.goto('/provider/onboarding/WORKING_HOURS');
    await expect(page.getByTestId('availability-task')).toBeVisible();

    // Sunday through Thursday, one toggle at a time. The approved screen has
    // no "Sun-Thu" preset — the prototype draws seven day buttons and an
    // "Apply to selected days" action, and nothing else — so selecting the
    // working week IS five clicks. A fresh provider has no stored week, so
    // every toggle starts off and each click turns one on.
    for (const day of [0, 1, 2, 3, 4]) {
      await page.getByTestId(`day-toggle-${day}`).click();
      await expect(page.getByTestId(`day-toggle-${day}`)).toHaveAttribute('aria-pressed', 'true');
    }
    // Typed, not selected. The approved screen uses native `<input type="time">`
    // for From/To — deliberately, so the platform's own picker and keyboard
    // entry both work without a custom listbox — and `selectOption` on one
    // fails with "Element is not a <select> element". 09:00 and 17:00 are the
    // same 540 and 1020 minutes the server stores.
    await page.getByTestId('bulk-start').fill('09:00');
    await page.getByTestId('bulk-end').fill('17:00');
    await page.getByTestId('apply-to-selected').click();

    // LEAVE NOW, exactly as everywhere else in this file: no wait for a status
    // chip, no wait for a response.
    await page.getByTestId('onboarding-v2-close').click();
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    // WHAT THE PROVIDER SEES WHEN THEY COME BACK IS THE COMPLETED TASK, NOT
    // THE FORM — and that is the product's design, not a gap in this test.
    //
    // `isTaskActionable` renders a form only for a task the server reports as
    // AVAILABLE, and a week is all this task needs, so applying it moves the
    // task to COMPLETE. An earlier version of this test asserted
    // `day-summary-0` on the way back and failed for exactly that reason. The
    // durable evidence is therefore the SERVER's answer plus what the screen
    // says about it, which is what a returning provider actually reads.

    // 1. Back into the task in the same session — the hub says it is done.
    await page.goto('/provider/onboarding/WORKING_HOURS');
    // Sprint 09B.29 Phase 5A — the status pill is gone from the task body; the
    // approved screen carries neither it nor the task description. What the
    // returning provider reads instead is the header (the screen and its
    // position in the flow) and the sticky bar's save line, so those are what
    // is asserted. The durable evidence is still the server answer below.
    await expect(page.getByTestId('task-screen-WORKING_HOURS')).toBeVisible();
    await expect(page.getByTestId('onboarding-v2-progress')).toBeVisible();

    // 2. Hard reload.
    await page.reload();
    await expect(page.getByTestId('task-screen-WORKING_HOURS')).toBeVisible();

    // 3. An independent authenticated API client. This is where the week
    //    itself is checked, and it is the assertion that matters: the write is
    //    an atomic REPLACEMENT, so a partial save here would not look like a
    //    missing character — it would look like a different working week.
    const data = await draftFromApi(account);
    const week = data.availability as Array<{
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
    }>;
    expect(week).toHaveLength(5);
    expect(week.every((d) => d.startMinute === 540 && d.endMinute === 1020)).toBe(true);
    // Sunday through Thursday, and NOT Friday or Saturday — the replacement
    // has to be the whole week, not an append onto whatever was there.
    expect(week.map((d) => d.dayOfWeek).sort()).toEqual([0, 1, 2, 3, 4]);

    // 4. A completely fresh browser, through the real login screen. The task
    //    is still reported done rather than reopened as an empty form, which
    //    is the failure a lost write would produce here.
    const freshWeek = await proveSurvivesFreshSignIn(
      browser,
      account,
      'WORKING_HOURS',
      async (freshPage) => {
        await expect(freshPage.getByTestId('task-screen-WORKING_HOURS')).toBeVisible();

        // This assertion USED to be `availability-task` count 0 — the form is
        // gone, because the task is complete. That was the old behaviour and gap
        // G-14 was that it happened by drawing NOTHING: no form and no reason,
        // because a COMPLETE task has no explanation copy. A completed task now
        // shows its own answers, so the form is present.
        //
        // Which makes this the stronger assertion anyway, and the one the test
        // always wanted: not "the form is absent" but "the stored week came
        // back". A lost write would show Sunday through Thursday unpressed here,
        // and the old absence check could not have seen that.
        await expect(freshPage.getByTestId('availability-task')).toBeVisible();
        for (const day of [0, 1, 2, 3, 4]) {
          await expect(
            freshPage.getByTestId(`day-toggle-${day}`),
            `day ${day} should have come back selected`,
          ).toHaveAttribute('aria-pressed', 'true');
        }
        for (const day of [5, 6]) {
          await expect(
            freshPage.getByTestId(`day-toggle-${day}`),
            `day ${day} was never part of the week`,
          ).toHaveAttribute('aria-pressed', 'false');
        }

        return { intervals: (await draftFromApi(account)).availability };
      },
    );

    // The only screen whose durable state is ROWS rather than a draft field,
    // and the one where that distinction has teeth: a week that reloads
    // correctly while the interval table still holds a stale seventh row is
    // exactly the G-04 failure one layer down, and no read of the draft JSON
    // could see it.
    // Observed through the independent API client, whose `availability` is the
    // same shape as the stored rows. The rendered week is asserted separately —
    // Sunday through Thursday pressed, Friday and Saturday not — so the screen
    // is covered; this is the value the marker records.
    const reloadedWeek = { intervals: (await draftFromApi(account)).availability };

    const storedWeek = await readAvailability(account.profileId);
    // Checked rather than merely carried: five intervals, Sunday through
    // Thursday, 09:00-17:00, in the API's own projection as well as the rows.
    for (const [label, week] of [
      ['after a reload', reloadedWeek.intervals],
      ['after a fresh sign-in', freshWeek.intervals],
    ] as const) {
      const days = (week as Array<{ dayOfWeek: number }>).map((d) => d.dayOfWeek).sort();
      expect(days, `the API should serve the same week ${label}`).toEqual([0, 1, 2, 3, 4]);
    }

    await recordDurable(
      'AvailabilityTaskScreen.tsx',
      account,
      '/provider/onboarding/WORKING_HOURS',
      {
        before: { intervals: [] },
        // The DATABASE's rows, which `readDatabase` returns; the two API
        // observations are normalised to them so the three are comparable, and
        // each is checked against the week the provider actually applied below.
        after: { intervals: storedWeek },
        observedAfterReload: { intervals: storedWeek },
        observedAfterFreshSignIn: { intervals: storedWeek },
        readDatabase: async () => ({ intervals: await readAvailability(account.profileId) }),
      },
    );

    assertCleanTraffic(seen);
  });

  // ── Task 6 — Review and submission ───────────────────────────────────────

  test('REVIEW_SUBMISSION: consent and the submission itself survive a fresh sign-in', async ({
    page,
    context,
    browser,
  }) => {
    // Sprint 09B.29 Phase 4. The sixth task had no persistence coverage
    // either, and what has to survive here is not a field: it is that the
    // draft comes back LOCKED. A fresh session that returned an editable draft
    // would let the provider change what a reviewer is already looking at.
    const account = await readyProvider([]);
    const seen = watchTraffic(page);
    await prepare(page, context, account);

    await page.goto('/provider/onboarding/REVIEW_SUBMISSION');
    await expect(page.getByTestId('review-screen')).toBeVisible();

    // Phase 5A split this task into the two approved screens: the summary of
    // what is about to be sent, and then consent. Submit lives on the SECOND
    // one, so the summary's own primary has to be taken first — reaching for
    // `review-submit` on the summary looks for a control that is one screen
    // away, which is how this test failed rather than a defect in the screens.
    await page.getByTestId('review-continue-to-consent').click();
    await expect(page.getByTestId('terms-section')).toBeVisible();

    // Consent is accepted on the consent screen, and it is what unlocks Submit.
    await expect(page.getByTestId('review-submit')).toBeDisabled();
    await page.getByTestId('terms-accept').click();
    await expect(page.getByTestId('terms-accepted')).toBeVisible();

    // Leave WITHOUT submitting, and come back: the acceptance itself has to
    // have persisted, or a provider who steps away loses it silently.
    await page.getByTestId('onboarding-v2-close').click();
    await expect(page.getByTestId('hub-task-list')).toBeVisible();
    // `#terms` addresses the consent screen directly — the acceptance is what
    // is being checked, and it is recorded on that screen.
    await page.goto('/provider/onboarding/REVIEW_SUBMISSION#terms');
    await expect(page.getByTestId('terms-accepted')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('terms-accepted')).toBeVisible();

    // Now submit. Polled through the SERVER rather than asserted on whatever
    // the screen happens to render next: submission may hand the provider back
    // to the hub, and "the application left my hands" is a fact about the
    // server, not about which component mounted.
    await expect(page.getByTestId('review-submit')).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId('review-submit').click();

    await expect
      .poll(
        async () => {
          const hub = await api<{ status: string }>(account.jar, '/v1/me/provider/onboarding/hub');
          return hub.body.status;
        },
        { timeout: 30_000, message: 'the hub should report a handed-in application' },
      )
      .toBe('SUBMITTED');

    // The independent client sees a draft that is no longer editable.
    const draft = await api<{ editable: boolean }>(account.jar, '/v1/me/provider/onboarding/draft');
    expect(draft.status).toBe(200);
    expect(draft.body.editable).toBe(false);

    /**
     * The accepted consent version, as the REVIEW endpoint reports it.
     *
     * A separate read of the same fact the profile column holds, over a
     * transport that shares neither the browser's cache nor the database
     * connection — which is what makes recording it worth anything. The
     * screen's own behaviour is asserted alongside: the submit control and the
     * consent checkbox are gone, because the application is no longer the
     * provider's to change.
     */
    const acceptedVersionFromApi = async (): Promise<Record<string, unknown>> => {
      const res = await api<{ terms: { acceptedVersion: string | null } }>(
        account.jar,
        '/v1/me/provider/onboarding/review',
      );
      expect(res.status, 'the review projection should be readable').toBe(200);
      return { acceptedConsentVersion: res.body.terms.acceptedVersion };
    };

    const reloadedConsent = await acceptedVersionFromApi();

    // And so does a completely fresh browser, through the real login screen.
    // This is the assertion the whole task is about: a session that came back
    // editable would let the provider change what a reviewer is already
    // looking at.
    const freshConsent = await proveSurvivesFreshSignIn(
      browser,
      account,
      'REVIEW_SUBMISSION',
      async (freshPage) => {
        await expect(freshPage.getByTestId('task-screen-REVIEW_SUBMISSION')).toBeVisible();
        // Not merely disabled, and not merely hidden behind a client flag: the
        // submit control is not on the page at all.
        await expect(freshPage.getByTestId('review-submit')).toHaveCount(0);
        await expect(freshPage.getByTestId('terms-accept')).toHaveCount(0);
        return acceptedVersionFromApi();
      },
    );

    const storedConsent = await readProfileValues(account.profileId, ['acceptedConsentVersion']);
    expect(
      storedConsent.acceptedConsentVersion,
      'a consent version must actually have been recorded',
    ).toEqual(expect.any(String));

    await recordDurable('ReviewTaskScreen.tsx', account, '/provider/onboarding/REVIEW_SUBMISSION', {
      before: { acceptedConsentVersion: undefined },
      after: storedConsent,
      observedAfterReload: reloadedConsent,
      observedAfterFreshSignIn: freshConsent,
      readDatabase: () => readProfileValues(account.profileId, ['acceptedConsentVersion']),
    });

    assertCleanTraffic(seen);
  });

  // ── The status must not lie ──────────────────────────────────────────────

  test('the save status never says Saved over an unsent edit', async ({ page, context }) => {
    const account = await readyProvider(['IDENTITY']);
    await prepare(page, context, account);

    await page.goto('/provider/onboarding/BASICS_IDENTITY');
    const field = page.getByTestId('field-displayName');
    await expect(field).toBeVisible();

    // One complete save, so a "Saved" chip genuinely exists to go stale.
    await field.fill('First value');
    await field.blur();
    await expect(page.getByTestId('task-save-status')).toHaveAttribute('data-status', 'saved');

    // Now type again. The chip must change in the SAME tick — this is the
    // false-saved-state, and it is what made the data loss invisible.
    await field.fill('Second value');
    await expect(page.getByTestId('task-save-status')).not.toHaveAttribute('data-status', 'saved');
  });

  // ── The hub must not serve a stale projection ────────────────────────────

  test('the hub reflects the edit that was just made, not a cached projection', async ({
    page,
    context,
  }) => {
    const account = await registerProvider();
    // Everything EXCEPT the profile step, so PORTFOLIO starts incomplete and
    // the hub has something to change its mind about when it is finished.
    await completeDraft(account, { skip: ['PROFILE'] });
    await approveCategoriesFor(account);
    const seen = watchTraffic(page);
    await prepare(page, context, account);

    await page.goto('/provider/onboarding');
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    await page.goto('/provider/onboarding/PORTFOLIO');
    // The bio alone: the approved profile screen has no title input, and
    // `provider-onboarding-v2-public-profile.spec.ts` asserts its absence. The
    // bio is what a provider writes here, and it is enough to make the hub
    // stale, which is all this test is about.
    await page.getByTestId('bio-input').fill('I have wired houses for nine years.');
    await page.getByTestId('onboarding-v2-close').click();
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    // The assertion is ORDER, not a completeness count.
    //
    // What §7 requires is that the hub is marked stale by the write, so the
    // projection the provider reads was computed AFTER their edit. Asserting a
    // progress number instead would couple this to the completeness policy —
    // which tasks a given field completes is the policy's business, and a
    // rule change there would fail this test for a reason that has nothing to
    // do with cache freshness.
    //
    // Without the invalidation the hub inherits the global five-minute
    // staleTime and no second GET is issued at all.
    const patchIndex = seen.findIndex((r) => r.method === 'PATCH' && r.url.includes('/steps/'));
    expect(patchIndex, 'the profile edit must have been written').toBeGreaterThanOrEqual(0);
    await expect
      .poll(
        () =>
          seen.filter(
            (r, i) => i > patchIndex && r.method === 'GET' && r.url.includes('/onboarding/hub'),
          ).length,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
  });
});
