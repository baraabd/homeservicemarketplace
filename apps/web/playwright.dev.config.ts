import { defineConfig, devices } from '@playwright/test';

// Production preview cannot detect native-ESM failures unique to Vite dev.
// Use a separate, cold server and never reuse an unrelated process on the port.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'dev-startup.spec.ts',
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/dev-startup',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5179',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'dev-desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'dev-mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'pnpm dev:reset --host 127.0.0.1 --port 5179',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { VITE_API_URL: 'http://127.0.0.1:4010', VITE_PROVIDER_ONBOARDING_V2: '' },
  },
});
