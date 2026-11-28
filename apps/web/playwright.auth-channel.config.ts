import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Presentation-only fixtures. Real identity and delivery acceptance runs separately. */
export default defineConfig({
  ...base,
  testMatch: '**/auth-channel.visual.spec.ts',
  projects: [
    {
      name: 'auth-channel-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        launchOptions: process.env.HSM_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.HSM_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
  workers: 2,
  use: { ...base.use, video: 'off' },
  outputDir: 'test-results/auth-channel-visual',
});
