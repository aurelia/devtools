import { defineConfig } from '@playwright/test';
import path from 'path';

const fixtureAppPath = path.join(__dirname, 'fixtures', 'aurelia-app');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 30000,

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },

  webServer: {
    command: 'npm run build && npm run preview',
    cwd: fixtureAppPath,
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },

  projects: [
    {
      name: 'chromium-extension',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
