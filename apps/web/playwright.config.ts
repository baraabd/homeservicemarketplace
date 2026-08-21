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

// The three viewports the acceptance criteria name. Declared once so a
// scenario cannot silently run at only one size.
export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

export default defineConfig({
  testDir: './e2e',
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
    },
  },
});
