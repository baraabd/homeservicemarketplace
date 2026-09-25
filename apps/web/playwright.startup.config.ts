import { defineConfig } from '@playwright/test';

// Unlike the main E2E suite (production preview), this gate exercises the
// actual development command with a stale generated vite.config.js present.
export default defineConfig({
  testDir: './startup-tests',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  globalTimeout: 600_000,
  expect: { timeout: 30_000 },
  outputDir: './test-results/startup',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/startup-report', open: 'never' }],
  ],
  use: { browserName: 'chromium' },
});
