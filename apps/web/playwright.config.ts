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
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

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
    command: `pnpm build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      // The production build refuses to run without this (see vite.config.ts).
      // The UI-level scenarios never reach the network; the persona workflow
      // spec points at a real API through E2E_API_URL.
      VITE_API_URL: process.env.E2E_API_URL ?? 'http://127.0.0.1:4010',
    },
  },
});
