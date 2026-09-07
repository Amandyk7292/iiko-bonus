import { expect, test } from '@playwright/test';
import path from 'node:path';

test('tier artwork can be previewed, uploaded, saved and reset without changing rewards', async ({
  page,
}, testInfo) => {
  const names = ['Бронза', 'Серебро', 'Платина'];
  const tiers = ['bronze', 'silver', 'platinum'].map((code, i) => ({
    id: code,
    code,
    names: { ru: names[i], kk: names[i], en: code },
    descriptions: { ru: names[i], kk: names[i], en: code },
    minSpend: i * 10000,
    cashbackPercent: i + 3,
    sortOrder: i,
    isActive: true,
    backgroundImageUrl: null as string | null,
  }));
  const saves: Record<string, unknown>[] = [];
  let finishUpload: () => void = () => {};
  const uploadReady = new Promise<void>((resolve) => {
    finishUpload = resolve;
  });
  const custom = 'https://images.example.test/custom.webp';
  const artwork = path.resolve('../public/assets/loyalty/platinum-v1.webp');
  await page.addInitScript(() => localStorage.setItem('adminLocale', 'ru'));
  await page.route('**/assets/loyalty/*.webp', (route) =>
    route.fulfill({
      contentType: 'image/webp',
      path: path.resolve('../public', new URL(route.request().url()).pathname.slice(1)),
    }),
  );
  await page.route(custom, (route) => route.fulfill({ contentType: 'image/webp', path: artwork }));
  await page.route('**/admin/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/events'))
      return route.fulfill({ contentType: 'text/event-stream', body: '' });
    if (pathname.endsWith('/loyalty-tiers/upload-image')) {
      await uploadReady;
      return route.fulfill({ json: { success: true, imageUrl: custom } });
    }
    if (pathname.endsWith('/loyalty-tiers/platinum')) {
      const payload = route.request().postDataJSON();
      saves.push(payload);
      Object.assign(tiers[2], payload);
      return route.fulfill({ json: { success: true, tier: tiers[2] } });
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
      '/admin/api/loyalty-tiers': { tiers },
    };
    return route.fulfill({
      status: pathname in responses ? 200 : 404,
      json: responses[pathname] ?? {},
    });
  });
  await page.goto('/admin/tiers');
  await page.getByRole('button', { name: 'Редактировать', exact: true }).nth(2).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Серебро', exact: true }).click();
  await expect(dialog.locator('.tier-form-preview')).toHaveCSS('background-image', /silver-v1/);
  await dialog.getByLabel('Загрузить свой фон').setInputFiles(artwork);
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  finishUpload();
  await expect(dialog.locator('.tier-form-preview')).toHaveCSS('background-image', /custom.webp/);
  await dialog.locator('.tier-form-preview').scrollIntoViewIfNeeded();
  expect(
    await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  await expect(dialog.locator('.tier-form-preview')).toHaveCSS('color', 'rgb(255, 255, 255)');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('tier-background-editor.png'),
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(saves[0]).toMatchObject({
    backgroundImageUrl: custom,
    cashbackPercent: 5,
    minSpend: 20000,
  });
  await page.getByRole('button', { name: 'Редактировать', exact: true }).nth(2).click();
  await expect(dialog.locator('.tier-form-preview')).toHaveCSS('background-image', /custom.webp/);
  await dialog.getByRole('button', { name: 'Фон по умолчанию', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Платина', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(saves[1]).toMatchObject({ backgroundImageUrl: null, cashbackPercent: 5, minSpend: 20000 });
});
