import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './r27-tests',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [['line']],
  outputDir: './test-results/r27-private-runner',
  use: {
    baseURL: 'http://127.0.0.1:5327',
    browserName: 'chromium',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'desktop-en',
      metadata: { lang: 'en' },
      use: { viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile-ar', metadata: { lang: 'ar' }, use: { viewport: { width: 375, height: 812 } } },
    {
      name: 'desktop-ar',
      metadata: { lang: 'ar' },
      use: { viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile-en', metadata: { lang: 'en' }, use: { viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: 'node ../../scripts/perf/post-r18/browser-servers.mjs',
    url: 'http://127.0.0.1:5327/login',
    reuseExistingServer: false,
    timeout: 90_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
  },
});
