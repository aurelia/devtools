import { test, expect } from '../helpers/extension-fixture';
import { waitForPageLoad } from '../helpers/extension-utils';

test.describe('Content Script', () => {
  test('Aurelia 2 app has $aurelia property on root element', async ({ context }) => {
    const page = await context.newPage();

    await page.goto('/');
    await waitForPageLoad(page);
    await page.waitForTimeout(2000);

    const hasAureliaProperty = await page.evaluate(() => {
      const app = document.querySelector('app');
      return app && '$aurelia' in app;
    });

    expect(hasAureliaProperty).toBe(true);

    await page.close();
  });

  test('extension service worker is active', async ({ context, extensionId }) => {
    expect(extensionId).toBeTruthy();
    expect(extensionId.length).toBeGreaterThan(10);
  });
});
