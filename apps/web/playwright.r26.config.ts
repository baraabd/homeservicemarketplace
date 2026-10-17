import { defineConfig, devices } from '@playwright/test';

if (
  process.env.R26_ACCEPTANCE_SCOPE !== 'isolated-ci' ||
  process.env.E2E_REAL_API !== 'http://127.0.0.1:4326' ||
  process.env.E2E_BASE_URL !== 'http://127.0.0.1:5326'
) {
  throw new Error('R26 requires its disposable stack on the reserved API/web ports');
}
export default defineConfig({
  testDir: './e2e',
  testMatch: 'r26-security.real-api.spec.ts',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  forbidOnly: true,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  // Raw traces contain cookie headers and identity bytes; retain only the
  // explicitly authored synthetic screenshot/result attachments in the spec.
  reporter: [['line'], ['json', { outputFile: 'test-results/r26-results.json' }]],
  outputDir: 'test-results/r26-browser',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL,
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
