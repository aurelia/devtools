import { test as base, chromium, BrowserContext } from '@playwright/test';
import path from 'path';

export type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
};

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    const extensionPath = path.join(__dirname, '..', '..', 'dist');

    const args = [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-default-apps',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ];

    if (process.env.CI) {
      args.push('--headless=new');
    }

    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args,
    });

    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 30000 });
    }

    const extensionId = serviceWorker.url().split('/')[2];
    await use(extensionId);
  },
});

export { expect } from '@playwright/test';
