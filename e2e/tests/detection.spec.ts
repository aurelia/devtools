import { test, expect } from '../helpers/extension-fixture';
import { waitForAureliaDetection, getDetectionState, waitForPageLoad } from '../helpers/extension-utils';

test.describe('Aurelia Detection Flow', () => {
  test('Aurelia fixture app renders correctly', async ({ context }) => {
    const page = await context.newPage();

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('h1', { timeout: 15000 });
    const heading = await page.locator('h1').textContent();
    expect(heading).toBe('Aurelia 2 E2E Test App');

    await page.close();
  });

  test('Aurelia 2 app has $au property on custom element', async ({ context }) => {
    const page = await context.newPage();

    await page.goto('/');
    await waitForPageLoad(page);

    await page.waitForTimeout(2000);

    const hasAuProperty = await page.evaluate(() => {
      const app = document.querySelector('app');
      return app && '$au' in app;
    });

    expect(hasAuProperty).toBe(true);

    await page.close();
  });

  test('Aurelia 2 bootstraps successfully', async ({ context }) => {
    const page = await context.newPage();

    await page.goto('/');
    await waitForPageLoad(page);

    const isBootstrapped = await page.evaluate(() => {
      const app = document.querySelector('app');
      return app && ('$au' in app || '$aurelia' in app);
    });

    expect(isBootstrapped).toBe(true);

    await page.close();
  });

  test('does not detect Aurelia on non-Aurelia page', async ({ context }) => {
    const page = await context.newPage();

    await page.goto('about:blank');
    await page.waitForTimeout(1000);

    const state = await getDetectionState(page);
    expect(state.version).toBeNull();

    await page.close();
  });
});
