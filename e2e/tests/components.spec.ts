import { test, expect } from '../helpers/extension-fixture';
import { waitForPageLoad } from '../helpers/extension-utils';

test.describe('Aurelia Components', () => {
  test('renders multiple custom elements', async ({ context }) => {
    const page = await context.newPage();

    await page.goto('/');
    await waitForPageLoad(page);

    const counters = await page.locator('counter').count();
    expect(counters).toBe(2);

    const userCards = await page.locator('user-card').count();
    expect(userCards).toBe(2);

    await page.close();
  });

  test('counter component has bindable properties', async ({ context }) => {
    const page = await context.newPage();

    await page.goto('/');
    await waitForPageLoad(page);

    const mainCounter = page.locator('counter').first();
    const label = await mainCounter.locator('.counter-label').textContent();
    expect(label).toContain('Main Counter');

    await page.close();
  });

  test('counter increment button works', async ({ context }) => {
    const page = await context.newPage();

    await page.goto('/');
    await waitForPageLoad(page);

    const counter = page.locator('counter').first();
    const valueBefore = await counter.locator('.counter-value').textContent();

    await counter.locator('.increment').click();

    const valueAfter = await counter.locator('.counter-value').textContent();
    expect(parseInt(valueAfter || '0')).toBe(parseInt(valueBefore || '0') + 1);

    await page.close();
  });

  test('user-card displays user information', async ({ context }) => {
    const page = await context.newPage();

    await page.goto('/');
    await waitForPageLoad(page);

    const firstCard = page.locator('user-card').first();

    const name = await firstCard.locator('.user-name').textContent();
    expect(name).toBe('John Doe');

    const email = await firstCard.locator('.user-email').textContent();
    expect(email).toBe('john@example.com');

    const role = await firstCard.locator('.user-role').textContent();
    expect(role).toBe('admin');

    await page.close();
  });

  test('user-card computed property shows initials', async ({ context }) => {
    const page = await context.newPage();

    await page.goto('/');
    await waitForPageLoad(page);

    const firstCard = page.locator('user-card').first();
    const initials = await firstCard.locator('.user-avatar').textContent();
    expect(initials).toBe('JD');

    await page.close();
  });

  test('add user button creates new user-card', async ({ context }) => {
    const page = await context.newPage();

    await page.goto('/');
    await waitForPageLoad(page);

    const initialCount = await page.locator('user-card').count();
    expect(initialCount).toBe(2);

    await page.locator('.add-user-btn').click();

    await page.waitForTimeout(500);
    const newCount = await page.locator('user-card').count();
    expect(newCount).toBe(3);

    await page.close();
  });

  test('all components have $au property', async ({ context }) => {
    const page = await context.newPage();

    await page.goto('/');
    await waitForPageLoad(page);

    const hasAuOnApp = await page.evaluate(() => {
      const app = document.querySelector('app');
      return app && '$au' in app;
    });
    expect(hasAuOnApp).toBe(true);

    const hasAuOnCounter = await page.evaluate(() => {
      const counter = document.querySelector('counter');
      return counter && '$au' in counter;
    });
    expect(hasAuOnCounter).toBe(true);

    const hasAuOnUserCard = await page.evaluate(() => {
      const card = document.querySelector('user-card');
      return card && '$au' in card;
    });
    expect(hasAuOnUserCard).toBe(true);

    await page.close();
  });

  test('component controllers are accessible via $au', async ({ context }) => {
    const page = await context.newPage();

    await page.goto('/');
    await waitForPageLoad(page);

    const controllerInfo = await page.evaluate(() => {
      const counter = document.querySelector('counter') as any;
      if (!counter || !counter.$au) return null;

      const controller = counter.$au['au:resource:custom-element'];
      return {
        hasController: !!controller,
        hasViewModel: !!controller?.viewModel,
        viewModelType: controller?.viewModel?.constructor?.name,
      };
    });

    expect(controllerInfo).toBeTruthy();
    expect(controllerInfo?.hasController).toBe(true);
    expect(controllerInfo?.hasViewModel).toBe(true);
    expect(controllerInfo?.viewModelType).toBe('Counter');

    await page.close();
  });
});
