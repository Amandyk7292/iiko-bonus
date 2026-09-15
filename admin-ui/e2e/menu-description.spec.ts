import { test, expect } from '@playwright/test';

test('requires Russian and Kazakh only and copies source text without overwriting translations', async ({
  page,
}) => {
  const branch = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Bulka',
    city: 'Актау',
    active: true,
  };
  let translationRequests = 0;
  await page.addInitScript((id) => {
    localStorage.setItem('adminSelectedBranchId', id);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).copiedDescription = text;
        },
      },
    });
  }, branch.id);
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { success: true };
    if (path.endsWith('/session'))
      data = { user: { username: 'owner', role: 'owner', branchIds: [] } };
    else if (path.endsWith('/scope'))
      data = { success: true, locations: [branch], selectedBranchId: branch.id };
    else if (path.endsWith('/translate')) translationRequests++;
    else if (path.endsWith('/menu'))
      data = {
        success: true,
        profileKey: 'default',
        rawMenu: {
          products: [
            { id: 'complete', name: 'Полное', price: 300 },
            { id: 'ru', name: 'Только русский', price: 300 },
            { id: 'kk', name: 'Только казахский', price: 300 },
            { id: 'en', name: 'Только английский', price: 300 },
          ],
          groups: [],
        },
        overrides: {
          products: [
            {
              iiko_product_id: 'complete',
              custom_description: 'Русское описание',
              description_translations: { kk: 'Қазақша сипаттама' },
            },
            { iiko_product_id: 'ru', custom_description: 'Русское описание' },
            { iiko_product_id: 'kk', description_translations: { kk: 'Қазақша сипаттама' } },
            { iiko_product_id: 'en', description_translations: { en: 'Description' } },
          ],
          categories: [],
          customProducts: [],
        },
      };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
  await page.goto('/admin/menu');
  const complete = page.getByRole('heading', { name: 'Полное', exact: true }).locator('..');
  await expect(complete).toBeVisible();
  await expect(complete.getByText('Неполное описание')).toHaveCount(0);
  await expect(page.getByText('Неполное описание', { exact: true })).toHaveCount(3);
  await complete.getByRole('button', { name: 'Изменить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'KK', exact: true }).click();
  await expect(dialog.locator('#edit-description-kk')).toHaveValue('Қазақша сипаттама');
  await dialog.getByRole('button', { name: 'Скопировать русское описание', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).copiedDescription))
    .toBe('Русское описание');
  await expect(dialog.locator('#edit-description-kk')).toHaveValue('Қазақша сипаттама');
  await expect(dialog.getByRole('link', { name: 'Яндекс Переводчик' })).toHaveAttribute(
    'href',
    'https://translate.yandex.ru/',
  );
  expect(translationRequests).toBe(0);
});
