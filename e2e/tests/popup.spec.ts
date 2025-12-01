import { test, expect } from '../helpers/extension-fixture';
import { getExtensionPopup } from '../helpers/extension-utils';

test.describe('Extension Popup', () => {
  test('shows "Aurelia not detected" popup by default', async ({ context, extensionId }) => {
    const popup = await getExtensionPopup(context, extensionId, 'popups/missing.html');

    const content = await popup.locator('h3').textContent();
    expect(content).toContain('Aurelia not detected');

    await popup.close();
  });

  test('enabled-v2 popup has correct content', async ({ context, extensionId }) => {
    const popup = await getExtensionPopup(context, extensionId, 'popups/enabled-v2.html');

    const heading = await popup.locator('h3').textContent();
    expect(heading).toContain('Aurelia 2 detected');

    const instructions = await popup.locator('p').textContent();
    expect(instructions).toContain('DevTools');

    await popup.close();
  });
});
