import { expect, test } from '@playwright/test';
import path from 'node:path';

test('editing tier rewards preserves existing artwork and both supported translations', async ({
  page,
}, testInfo) => {
  const custom = 'https://images.example.test/custom.webp';
  const tier = {
    id: 'platinum',
    code: 'platinum',
    names: { ru: 'Платина', kk: 'Платина', en: 'Platinum' },
    descriptions: { ru: 'Условия', kk: 'Шарттар', en: 'Terms' },
    minSpend: 20000,
    cashbackPercent: 5,
    sortOrder: 0,
    isActive: true,
    backgroundImageUrl: custom,
  };
  const saves: Record<string, unknown>[] = [];
  await page.addInitScript(() => localStorage.setItem('adminLocale', 'ru'));
  await page.route(custom, (route) =>
    route.fulfill({
      contentType: 'image/webp',
      path: path.resolve('../public/assets/loyalty/platinum-v1.webp'),
    }),
  );
  await page.route('**/admin/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/events'))
      return route.fulfill({ contentType: 'text/event-stream', body: '' });
    if (pathname.endsWith('/loyalty-tiers/platinum')) {
      const payload = route.request().postDataJSON();
      saves.push(payload);
      Object.assign(tier, payload);
      return route.fulfill({ json: { success: true, tier } });
    }
    const responses: Record<string, unknown> = {
      '/admin/api/session': {
        user: { username: 'owner', role: 'owner', branchIds: [], actions: ['*'] },
      },
      '/admin/api/scope': { success: true, locations: [], selectedBranchId: null },
      '/admin/api/operations/summary': {
        success: true,
        counts: {},
        capabilities: {},
        orders: [],
        support: [],
        whatsapp: [],
      },
      '/admin/api/loyalty-tiers': { tiers: [tier] },
    };
    return route.fulfill({
      status: pathname in responses ? 200 : 404,
      json: responses[pathname] ?? {},
    });
  });
  await page.goto('/admin/tiers');
  const preview = page.locator('.tier-preview-card');
  await expect(preview).toHaveCSS('background-image', /custom.webp/);
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  const dialog = page.getByRole('dialog');
  // Artwork is retained on reward edits; the current form exposes RU and KK content.
  await expect(dialog.locator('input[type="file"]')).toHaveCount(0);
  await expect(dialog.getByRole('tab')).toHaveCount(2);
  await dialog.locator('#tier-cashback').fill('7');
  await dialog.locator('#tier-name-ru').fill('Платина плюс');
  await dialog.getByRole('tab', { name: 'Казахский' }).click();
  await dialog.locator('#tier-name-kk').fill('Платина плюс KZ');
  expect(
    await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(saves[0]).toMatchObject({
    backgroundImageUrl: custom,
    cashbackPercent: 7,
    minSpend: 20000,
    names: { ru: 'Платина плюс', kk: 'Платина плюс KZ' },
  });
  await expect(preview).toHaveCSS('background-image', /custom.webp/);
  await expect(preview).toContainText('7%');
  await page.reload();
  await expect(preview).toHaveCSS('background-image', /custom.webp/);
  await expect(preview).toContainText('Платина плюс');
  await expect(preview).toContainText('7%');
  await page.screenshot({ path: testInfo.outputPath('tier-reward-edit.png'), fullPage: true });
});
