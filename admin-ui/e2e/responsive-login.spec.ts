import { expect, test } from '@playwright/test';

test('login is Russian, responsive, and uses bundled assets', async ({ page }) => {
  await page.route('**/admin/api/session', route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ success: false }),
  }));
  await page.goto('/admin/');

  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('textbox', { name: 'Имя пользователя', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Пароль', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Способ входа' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Управление Bulka' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const logoLoaded = await page.locator('.login-logo').evaluate((image: HTMLImageElement) => (
    image.complete && image.naturalWidth > 0
  ));
  expect(logoLoaded).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
