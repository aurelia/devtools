import { test, expect } from '../helpers/extension-fixture';
import { waitForPageLoad } from '../helpers/extension-utils';

test.describe('Background Script', () => {
  test('service worker is running', async ({ context, extensionId }) => {
    const serviceWorker = context.serviceWorkers()[0];
    expect(serviceWorker).toBeTruthy();
    expect(serviceWorker.url()).toContain(extensionId);
    expect(serviceWorker.url()).toContain('background.js');
  });

  test('extension has correct manifest permissions', async ({ context, extensionId }) => {
    const manifestPage = await context.newPage();
    await manifestPage.goto(`chrome-extension://${extensionId}/manifest.json`);

    const manifestText = await manifestPage.locator('body').textContent();
    const manifest = JSON.parse(manifestText || '{}');

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.content_scripts).toHaveLength(2);

    await manifestPage.close();
  });

  test('extension icon files exist', async ({ context, extensionId }) => {
    const iconPage = await context.newPage();

    const response = await iconPage.goto(`chrome-extension://${extensionId}/images/16.png`);
    expect(response?.status()).toBe(200);

    const greyResponse = await iconPage.goto(`chrome-extension://${extensionId}/images/16-GREY.png`);
    expect(greyResponse?.status()).toBe(200);

    await iconPage.close();
  });

  test('content scripts are defined in manifest', async ({ context, extensionId }) => {
    const manifestPage = await context.newPage();
    await manifestPage.goto(`chrome-extension://${extensionId}/manifest.json`);

    const manifestText = await manifestPage.locator('body').textContent();
    const manifest = JSON.parse(manifestText || '{}');

    const contentScripts = manifest.content_scripts;
    expect(contentScripts).toBeDefined();

    const scriptPaths = contentScripts.flatMap((cs: any) => cs.js);
    expect(scriptPaths).toContain('build/detector.js');
    expect(scriptPaths).toContain('build/contentscript.js');

    await manifestPage.close();
  });
});
