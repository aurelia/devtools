import { BrowserContext, Page } from '@playwright/test';

export async function getExtensionPopup(
  context: BrowserContext,
  extensionId: string,
  popupPath: string
): Promise<Page> {
  const popupUrl = `chrome-extension://${extensionId}/${popupPath}`;
  const page = await context.newPage();
  await page.goto(popupUrl);
  return page;
}

export async function waitForAureliaDetection(
  page: Page,
  expectedVersion: number = 2,
  timeout: number = 10000
): Promise<void> {
  await page.waitForFunction(
    (version) => (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__ === version,
    expectedVersion,
    { timeout }
  );
}

export async function getDetectionState(page: Page): Promise<{
  version: number | null;
  state: string | null;
}> {
  return page.evaluate(() => ({
    version: (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__ ?? null,
    state: (window as any).__AURELIA_DEVTOOLS_DETECTION_STATE__ ?? null,
  }));
}

export async function waitForPageLoad(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle');
}
