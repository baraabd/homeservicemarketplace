import { defineConfig, devices } from '@playwright/test';
import { isAbsolute, join, sep } from 'node:path';

// Dedicated real-service proof. No inherited default-suite intercepts, web
// server, global setup, retries or automatic artifacts containing auth data.
const baseURL = process.env.R31_BROWSER_BASE_URL;
const apiURL = process.env.R31_BROWSER_API_URL;
const privateDir = process.env.R31_BROWSER_PRIVATE_DIR;
const credentials = process.env.R31_BROWSER_CREDENTIALS_FILE;
const reportDir = process.env.R31_BROWSER_REPORT_DIR;
if (
  process.env.RUN_DB_INTEGRATION !== '1' ||
  process.env.NODE_ENV !== 'test' ||
  process.env.APP_ENV !== 'test' ||
  !baseURL ||
  !apiURL ||
  !privateDir ||
  !credentials ||
  !reportDir
) {
  throw new Error('Run R31 through scripts/production/subscriptions/verify-my-plan.cjs.');
}
const url = new URL(baseURL);
const api = new URL(apiURL);
if (
  url.protocol !== 'http:' ||
  url.hostname !== '127.0.0.1' ||
  url.origin !== baseURL ||
  api.protocol !== 'http:' ||
  api.hostname !== '127.0.0.1' ||
  api.origin !== apiURL ||
  ![privateDir, credentials, reportDir].every(isAbsolute)
) {
  throw new Error('R31 browser proof requires private absolute paths and a loopback origin.');
}
if (
  credentials !== join(privateDir, 'credentials.json') ||
  reportDir === privateDir ||
  reportDir.startsWith(privateDir + sep) ||
  privateDir.startsWith(reportDir + sep)
) {
  throw new Error(
    'R31 private authentication files and public evidence must have disjoint directories.',
  );
}

export default defineConfig({
  testDir: './e2e/r31-subscriptions',
  testMatch: 'my-plan.real-api.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: join(privateDir, 'playwright-output'),
  reporter: [['list'], ['json', { outputFile: join(privateDir, 'playwright-report.json') }]],
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    viewport: { width: 390, height: 844 },
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'r31-chromium' }],
});
