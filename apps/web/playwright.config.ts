import { defineConfig, devices } from '@playwright/test';

// Phase 12 — real-browser RTL and Admin/Provider UI tests.
//
// These run in an actual Chromium, not jsdom/happy-dom. That distinction is the
// whole point: `html.dir="rtl"`, bidi text layout, container overflow, focus
// outlines, and clipping are properties of a real layout engine, and a DOM
// shim reports whatever it is told. The component suite (vitest) stays where it
// is; this is the layer that can see geometry.
//
// The web server is started by Playwright itself so a developer running
// `pnpm --filter @homeservicemarketplace/web test:e2e` gets the same setup CI
// does, with no manual "start the app first" step to forget.

const PORT = Number(process.env.E2E_PORT ?? 4173);
const HOST = process.env.E2E_HOST ?? '127.0.0.1';
const BASE_URL = process.env.E2E_BASE_URL ?? `http://${HOST}:${PORT}`;

// CI builds the app in its own step so the build does not eat the server's
// startup budget (and so a build failure is reported as a build failure).
const PREBUILT = process.env.E2E_PREBUILT === '1';

// The real-API auth suite talks ONLY to the API origin. Its two navigations
// are `${E2E_REAL_API}/health/live` and the cross-site variant of the same
// URL; it never uses baseURL, never requests a relative path, and never loads
// the SPA at all. Starting vite preview for that run would build and serve a
// bundle nothing ever fetches — and, because the job sets E2E_PREBUILT with no
// build step, it did exactly what an unbuilt preview does:
//
//   [WebServer] Error: The directory "dist" does not exist.
//
// Adding a build step would have silenced that, at the cost of a minute of CI
// per run to produce an artifact with no reader. Not starting the server is
// the actual fix.
const REAL_API_RUN = Boolean(process.env.E2E_REAL_API);

// Sprint 09B.29 — the pixel-exact prototype reference capture is a LOCAL
// visual-acceptance instrument, and opt-in for that reason.
//
// It compares a screenshot byte-for-byte against baselines committed under
// `e2e/__screenshots__/reference/`. Those baselines were captured on the
// developer's Windows host, and CI runs Linux. Vendoring the fonts and pinning
// the icon script removes every source of drift ABOVE the rasterizer, but not
// the rasterizer itself: Skia's glyph hinting and antialiasing differ between
// the two platforms, so the same DOM renders a different bitmap. The first CI
// run of this spec proved it — 12 failures, all of them the snapshot
// comparison, across all three viewports and both languages.
//
// So this gate cannot be made green in CI by fixing the code; it would need
// Linux baselines committed beside the Windows ones. Until those exist the
// honest arrangement is the one this config already argues for elsewhere: a
// spec that is deliberately not in the run, rather than one that silently
// skips or is loosened with a pixel tolerance until it stops meaning anything.
//
// Run it where its baselines are valid:  E2E_VISUAL_REFERENCE=1 pnpm exec playwright test
const VISUAL_REFERENCE_RUN = Boolean(process.env.E2E_VISUAL_REFERENCE);

// Sprint 09B.29 Phase 5A — the eighteen-state visual migration gate.
//
// Opt-in for the SAME reason as VISUAL_REFERENCE_RUN above, plus one more: it
// writes evidence into `test-results/phase5-visual/`, which the ledger then
// reads to decide what each task screen is credited with. A gate that wrote
// its own evidence on every unrelated CI run would keep resurrecting stale
// artifacts from a build nobody was measuring.
//
// It is also single-project by construction — the canonical comparison is only
// geometrically valid at 390x844 — so running it in the three-viewport matrix
// would produce two-thirds duplicate work and three writers racing for one
// artifact path.
//
// Run:  E2E_PHASE5=1 E2E_PREBUILT=1 pnpm exec playwright test phase5- --project=chromium-desktop
const PHASE5_RUN = Boolean(process.env.E2E_PHASE5);

// The three viewports the acceptance criteria name. Declared once so a
// scenario cannot silently run at only one size.
export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

export default defineConfig({
  testDir: './e2e',
  // The two real-API suites are excluded from the default run. They need a
  // booted API, Postgres, Redis and a mail catcher, none of which the
  // stub-everything browser job has — and a spec that silently skips is worse
  // than one that is deliberately not here. `auth-cookies` runs in its own CI
  // job (see `browser-auth-e2e` in ci.yml); the V2 onboarding journey needs a
  // served SPA as well, so it additionally expects E2E_BASE_URL to point at a
  // preview built with VITE_PROVIDER_ONBOARDING_V2=true. Both run locally with
  // E2E_REAL_API set — see docs/sprint-09b26/PROVIDER_ONBOARDING_V2_RELEASE.md.
  testIgnore: [
    // Platform-specific baselines; see VISUAL_REFERENCE_RUN above.
    ...(VISUAL_REFERENCE_RUN ? [] : ['**/prototype-reference.spec.ts']),
    // Evidence-writing visual gate; see PHASE5_RUN above.
    ...(PHASE5_RUN ? [] : ['**/phase5-reference.spec.ts', '**/phase5-visual.spec.ts']),
    ...(REAL_API_RUN
      ? []
      : [
          '**/auth-cookies.spec.ts',
          '**/provider-onboarding-v2-real-api.spec.ts',
          // Sprint 9B.28 — the persistence journey. Same rule and same reason:
          // it reads the draft back through an independent API client and a
          // second browser context, so a stubbed run could not prove anything
          // it claims to.
          '**/provider-onboarding-v2-persistence.spec.ts',
          // Sprint 09B.29 — the activation / session-synchronization journey.
          // Same rule and same reason: it drives a real upgrade and a real
          // session rotation, and asserts that the PRE-upgrade credential is
          // still refused afterwards. Against a stub that proves nothing.
          '**/provider-activation-session.real-api.spec.ts',
          '**/provider-activation-visual.real-api.spec.ts',
          // Sprint 09B.29 — the accessibility gate for the same two screens. It
          // drives the real upgrade to reach the synchronization states, so it
          // belongs with the other real-API specs rather than the stubbed run.
          '**/provider-activation-a11y.real-api.spec.ts',
          // The temporary measurement harness. Skips itself without the real
          // stack, but listing it keeps the default run's spec count honest.
          '**/_diagnostic-visual.real-api.spec.ts',
          // Sprint 09B.29 Phase 3 — the browser acceptance journeys and the
          // running-API activation chain. Same rule and same reason as every
          // entry above: they register real accounts, poll a real mail catcher
          // and drive real admin decisions, none of which exists in the
          // stub-everything run.
          //
          // `phase3-activation-chain` in particular has no `test.skip` guard of
          // its own — it is API-only, so there is no page to skip on — and
          // without this line the default matrix ran it against an unset
          // E2E_REAL_API and failed three times over. Listing it here is the fix;
          // adding a skip would have made it silently do nothing, which this
          // config's own comment argues against.
          '**/phase3-activation-chain.real-api.spec.ts',
          '**/phase3-v2-journey.real-api.spec.ts',
          '**/phase3-v1-flag-off.real-api.spec.ts',
        ]),
  ],
  // Sprint 09B.29 — one stable snapshot location, shared by the spec that
  // captures the approved prototype and the spec that captures the
  // implementation.
  //
  // The default template embeds the project name and the platform, which would
  // give those two specs different files and make the comparison compare
  // nothing. Dropping the project is the point and stays.
  //
  // Dropping the PLATFORM was justified here by the claim that these captures
  // are "deterministic by construction (pinned icon script, vendored fonts,
  // fixed viewport, animations off), so the platform suffix would only hide
  // drift". CI has since disproved the second half of that: pinning removes
  // every source of drift above the rasterizer, but Skia hints and antialiases
  // glyphs differently on Linux than on Windows, so the same DOM produces a
  // different bitmap and a Windows baseline can never match a Linux run.
  //
  // The template is left as it is — one shared location is what lets the
  // reference and implementation captures be compared at all — and the
  // consequence is handled where it belongs, by making the pixel-exact spec
  // opt-in (see VISUAL_REFERENCE_RUN). Committing per-platform baselines would
  // restore it as a CI gate and is the recorded follow-up.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  // Playwright's own per-test artifacts (traces, videos, failure shots) get
  // their own subdirectory.
  //
  // The default is `test-results/` itself, which Playwright CLEANS at the start
  // of a run — and `test-results/phase5-visual/` is where the Phase 5 evidence
  // ledger reads its artifacts from. That path is fixed by the ledger and is
  // not ours to move, so the runner's scratch space moves instead. Without
  // this, a run that happened to be filtered could delete the evidence of the
  // states it was not running.
  outputDir: 'test-results/playwright',
  // Deterministic: no test may depend on another's leftovers, and a flake
  // must fail rather than be retried into a pass locally.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Anti-aliasing and font hinting differ between machines; a small
      // tolerance keeps the snapshots meaningful without making them a
      // machine-identity test. Snapshots are a SUPPLEMENT here — every visual
      // scenario also carries explicit DOM/geometry assertions.
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']]
    : [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
  use: {
    baseURL: BASE_URL,
    // Artefacts ONLY on failure — a green run should not litter CI storage,
    // and a red one should carry everything needed to diagnose it without a
    // re-run.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // The app is bilingual; pin the browser locale so a developer machine's
    // locale cannot change what the UI decides to render.
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.desktop },
    },
    {
      name: 'chromium-tablet',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.tablet },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.mobile, isMobile: false },
    },
  ],
  // Omitted entirely for the real-API run — see REAL_API_RUN above.
  ...(REAL_API_RUN
    ? {}
    : {
        webServer: {
          // `vite preview` serves the production build, so these tests exercise what
          // ships rather than the dev server's transformed output.
          //
          // `--host ${HOST}` is load-bearing. Without an explicit host, vite preview
          // binds `localhost`, which on the CI runner resolves to the IPv6 loopback
          // and listens on [::1] ONLY. Playwright then polled `http://127.0.0.1:4173`
          // — a different interface — got connection-refused every time, and gave up
          // with "Timed out waiting 300000ms from config.webServer" while a perfectly
          // healthy server sat there answering on [::1]. Binding the same host the
          // `url` below names removes the mismatch entirely.
          command: [
            PREBUILT ? null : 'pnpm build',
            `pnpm exec vite preview --host ${HOST} --port ${PORT} --strictPort`,
          ]
            .filter(Boolean)
            .join(' && '),
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          // Serving an already-built app is a couple of seconds, so CI gets a tight
          // budget: a bad bind now reports itself in one minute instead of taking the
          // full five it used to. The local path still compiles the app inside this
          // window, so it keeps the generous budget a cold build needs.
          timeout: PREBUILT ? 60_000 : 300_000,
          // Surface vite's own output. Previously the timeout message was all CI
          // printed, so "which port did it actually bind?" was unanswerable from the
          // log — the single fact needed to diagnose this.
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            // The production build refuses to run without this (see vite.config.ts).
            // The UI-level scenarios never reach the network; the persona workflow
            // spec points at a real API through E2E_API_URL.
            VITE_API_URL: process.env.E2E_API_URL ?? 'http://127.0.0.1:4010',
            // Feature flags start UNSET here, whatever the developer has in
            // apps/web/.env — CI has no .env, so inheriting one makes a local
            // run disagree with CI about which surface the bundle serves. The
            // specs that need V2 seed the per-browser override themselves, in
            // both directions, which is what makes both states provable
            // against one bundle.
            VITE_PROVIDER_ONBOARDING_V2: '',
          },
        },
      }),
});
