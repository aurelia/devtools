import { test, expect } from '../helpers/extension-fixture';

test.describe('Sidebar Panel', () => {
  test('sidebar HTML loads correctly', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });

    const root = await page.locator('sidebar-app');
    await expect(root).toBeVisible();

    await page.close();
  });

  test('sidebar CSS is loaded', async ({ context, extensionId }) => {
    const page = await context.newPage();

    const cssResponse = await page.goto(`chrome-extension://${extensionId}/build/sidebar.css`);
    expect(cssResponse?.status()).toBe(200);

    await page.close();
  });

  test('sidebar JS is loaded', async ({ context, extensionId }) => {
    const page = await context.newPage();

    const jsResponse = await page.goto(`chrome-extension://${extensionId}/build/sidebar.js`);
    expect(jsResponse?.status()).toBe(200);

    await page.close();
  });

  test('sidebar shows detection state initially', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });
    await page.waitForTimeout(1000);

    const checkingState = await page.locator('text=Detecting Aurelia').count();
    const notFoundState = await page.locator('text=No Aurelia detected').count();
    const detectedContent = await page.locator('.sidebar-content').count();

    expect(checkingState + notFoundState + detectedContent).toBeGreaterThan(0);

    await page.close();
  });

  test('sidebar has toolbar when Aurelia detected', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });

    await page.evaluate(() => {
      const appElement = document.querySelector('sidebar-app') as any;
      const app = appElement?.$controller?.viewModel || appElement?.$au?.['au:resource:custom-element']?.viewModel;
      if (app) {
        app.detectionState = 'detected';
        app.aureliaDetected = true;
      }
    });

    await page.waitForTimeout(500);

    const toolbar = page.locator('.toolbar');
    await expect(toolbar).toBeVisible();

    await page.close();
  });

  test('sidebar has search input', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });

    await page.evaluate(() => {
      const appElement = document.querySelector('sidebar-app') as any;
      const app = appElement?.$controller?.viewModel || appElement?.$au?.['au:resource:custom-element']?.viewModel;
      if (app) {
        app.detectionState = 'detected';
        app.aureliaDetected = true;
      }
    });

    await page.waitForTimeout(500);

    const searchInput = page.locator('.search-input');
    await expect(searchInput).toBeVisible();

    await page.close();
  });

  test('sidebar shows empty state when no element selected', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });

    await page.evaluate(() => {
      const appElement = document.querySelector('sidebar-app') as any;
      const app = appElement?.$controller?.viewModel || appElement?.$au?.['au:resource:custom-element']?.viewModel;
      if (app) {
        app.detectionState = 'detected';
        app.aureliaDetected = true;
        app.selectedElement = null;
      }
    });

    await page.waitForTimeout(500);

    const emptyState = page.locator('.empty-state');
    await expect(emptyState).toBeVisible();

    await page.close();
  });

  test('sidebar displays component info when element is selected', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });

    const mockComponent = {
      name: 'my-component',
      key: 'au:resource:custom-element:my-component',
      bindables: [
        { name: 'value', value: 42, type: 'number' },
        { name: 'label', value: 'Test', type: 'string' },
      ],
      properties: [
        { name: 'count', value: 10, type: 'number' },
      ],
    };

    await page.evaluate((component) => {
      const appElement = document.querySelector('sidebar-app') as any;
      const app = appElement?.$controller?.viewModel || appElement?.$au?.['au:resource:custom-element']?.viewModel;
      if (app) {
        app.detectionState = 'detected';
        app.aureliaDetected = true;
        app.selectedElement = component;
        app.selectedNodeType = 'custom-element';
      }
    }, mockComponent);

    await page.waitForTimeout(500);

    const componentName = page.locator('.component-name');
    await expect(componentName).toHaveText('my-component');

    await page.close();
  });

  test('sidebar sections can be expanded and collapsed', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });

    const mockComponent = {
      name: 'test-component',
      key: 'au:resource:custom-element:test-component',
      bindables: [{ name: 'value', value: 1, type: 'number' }],
      properties: [{ name: 'prop', value: 'test', type: 'string' }],
    };

    await page.evaluate((component) => {
      const appElement = document.querySelector('sidebar-app') as any;
      const app = appElement?.$controller?.viewModel || appElement?.$au?.['au:resource:custom-element']?.viewModel;
      if (app) {
        app.detectionState = 'detected';
        app.aureliaDetected = true;
        app.selectedElement = component;
        app.selectedNodeType = 'custom-element';
      }
    }, mockComponent);

    await page.waitForTimeout(500);

    const bindablesSection = page.locator('.section-header:has-text("Bindables")');
    await expect(bindablesSection).toBeVisible();

    await bindablesSection.click();
    await page.waitForTimeout(200);

    await bindablesSection.click();
    await page.waitForTimeout(200);

    await page.close();
  });

  test('sidebar displays property values correctly', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });

    const mockComponent = {
      name: 'prop-test',
      key: 'au:resource:custom-element:prop-test',
      bindables: [
        { name: 'stringVal', value: 'hello', type: 'string' },
        { name: 'numberVal', value: 42, type: 'number' },
        { name: 'boolVal', value: true, type: 'boolean' },
      ],
      properties: [],
    };

    await page.evaluate((component) => {
      const appElement = document.querySelector('sidebar-app') as any;
      const app = appElement?.$controller?.viewModel || appElement?.$au?.['au:resource:custom-element']?.viewModel;
      if (app) {
        app.detectionState = 'detected';
        app.aureliaDetected = true;
        app.selectedElement = component;
        app.selectedNodeType = 'custom-element';
        app.expandedSections.bindables = true;
      }
    }, mockComponent);

    await page.waitForTimeout(500);

    const stringProperty = page.locator('.property-name:has-text("stringVal")');
    await expect(stringProperty).toBeVisible();

    const numberProperty = page.locator('.property-name:has-text("numberVal")');
    await expect(numberProperty).toBeVisible();

    const boolProperty = page.locator('.property-name:has-text("boolVal")');
    await expect(boolProperty).toBeVisible();

    await page.close();
  });

  test('sidebar shows binding context indicator for non-component elements', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });

    const mockComponent = {
      name: 'parent-component',
      key: 'au:resource:custom-element:parent-component',
      bindables: [],
      properties: [],
    };

    await page.evaluate((component) => {
      const appElement = document.querySelector('sidebar-app') as any;
      const app = appElement?.$controller?.viewModel || appElement?.$au?.['au:resource:custom-element']?.viewModel;
      if (app) {
        app.detectionState = 'detected';
        app.aureliaDetected = true;
        app.selectedElement = component;
        app.selectedNodeType = 'custom-element';
        app.selectedElementTagName = 'div';
        app.isShowingBindingContext = true;
      }
    }, mockComponent);

    await page.waitForTimeout(500);

    const bindingContextLabel = page.locator('.binding-context-label');
    await expect(bindingContextLabel).toBeVisible();

    const selectedElement = page.locator('.selected-element');
    await expect(selectedElement).toContainText('div');

    await page.close();
  });

  test('sidebar shows extension invalidated state', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });

    await page.evaluate(() => {
      const appElement = document.querySelector('sidebar-app') as any;
      const app = appElement?.$controller?.viewModel || appElement?.$au?.['au:resource:custom-element']?.viewModel;
      if (app) {
        app.extensionInvalidated = true;
      }
    });

    await page.waitForTimeout(500);

    const invalidatedMessage = page.locator('.state-message.error');
    await expect(invalidatedMessage).toBeVisible();

    const reloadText = page.locator('text=reload DevTools');
    await expect(reloadText).toBeVisible();

    await page.close();
  });

  test('sidebar element picker button exists', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });

    await page.evaluate(() => {
      const appElement = document.querySelector('sidebar-app') as any;
      const app = appElement?.$controller?.viewModel || appElement?.$au?.['au:resource:custom-element']?.viewModel;
      if (app) {
        app.detectionState = 'detected';
        app.aureliaDetected = true;
      }
    });

    await page.waitForTimeout(500);

    const pickerButton = page.locator('.tool-btn').first();
    await expect(pickerButton).toBeVisible();

    await page.close();
  });

  test('sidebar follow selection button exists', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });

    await page.evaluate(() => {
      const appElement = document.querySelector('sidebar-app') as any;
      const app = appElement?.$controller?.viewModel || appElement?.$au?.['au:resource:custom-element']?.viewModel;
      if (app) {
        app.detectionState = 'detected';
        app.aureliaDetected = true;
      }
    });

    await page.waitForTimeout(500);

    const toolButtons = await page.locator('.tool-btn').count();
    expect(toolButtons).toBeGreaterThanOrEqual(2);

    await page.close();
  });
});

test.describe('Sidebar Expression Evaluator', () => {
  test('expression evaluator section exists', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });

    const mockComponent = {
      name: 'eval-test',
      key: 'au:resource:custom-element:eval-test',
      bindables: [],
      properties: [],
    };

    await page.evaluate((component) => {
      const appElement = document.querySelector('sidebar-app') as any;
      const app = appElement?.$controller?.viewModel || appElement?.$au?.['au:resource:custom-element']?.viewModel;
      if (app) {
        app.detectionState = 'detected';
        app.aureliaDetected = true;
        app.selectedElement = component;
        app.selectedNodeType = 'custom-element';
      }
    }, mockComponent);

    await page.waitForTimeout(500);

    const evaluateSection = page.locator('.section-header:has-text("Evaluate")');
    await expect(evaluateSection).toBeVisible();

    await page.close();
  });

  test('expression input and run button exist', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.waitForSelector('sidebar-app', { timeout: 10000 });

    const mockComponent = {
      name: 'eval-test',
      key: 'au:resource:custom-element:eval-test',
      bindables: [],
      properties: [],
    };

    await page.evaluate((component) => {
      const appElement = document.querySelector('sidebar-app') as any;
      const app = appElement?.$controller?.viewModel || appElement?.$au?.['au:resource:custom-element']?.viewModel;
      if (app) {
        app.detectionState = 'detected';
        app.aureliaDetected = true;
        app.selectedElement = component;
        app.selectedNodeType = 'custom-element';
        app.expandedSections.expression = true;
      }
    }, mockComponent);

    await page.waitForTimeout(500);

    const expressionInput = page.locator('.expression-input');
    await expect(expressionInput).toBeVisible();

    const runButton = page.locator('.eval-btn');
    await expect(runButton).toBeVisible();

    await page.close();
  });
});
