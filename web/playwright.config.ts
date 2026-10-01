import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '../test/scratch/playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:4175/preview/',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/static-server.mjs',
    url: 'http://127.0.0.1:4175/preview/',
    reuseExistingServer: true,
  },
});
