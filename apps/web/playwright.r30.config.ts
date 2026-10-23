import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixturePath = process.env.R30_BROWSER_FIXTURE;
if (!fixturePath || process.env.RUN_R30_BROWSER !== '1') {
  throw new Error('R30 browser acceptance requires the isolated real-service harness.');
}
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { apiUrl: string };
const api = new URL(fixture.apiUrl);
if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || !api.port) {
  throw new Error('R30 browser acceptance only connects to its disposable loopback API.');
}

export default defineConfig({
  testDir: './e2e/r30-manual-payments',
  testMatch: 'manual-payments.real-api.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 360_000,
  expect: { timeout: 20_000 },
  reporter: [['line'], ['json', { outputFile: 'test-results/r30-manual-results.json' }]],
  outputDir: 'test-results/r30-manual-browser',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5324',
    locale: 'en-US',
    timezoneId: 'UTC',
    // Credential headers and private bytes must never enter public traces.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5324 --strictPort',
    url: 'http://127.0.0.1:5324',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { VITE_API_URL: fixture.apiUrl, VITE_PROVIDER_ONBOARDING_V2: '' },
  },
});
