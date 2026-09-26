import { expect, test } from '@playwright/test';

test('saving a product keeps expanded list and position, including a reload', async ({ page }) => {
  const branch = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Bulka',
    city: 'Актау',
    active: true,
  };
  const overrides: Record<string, Record<string, unknown>> = {};
  await page.addInitScript((id) => localStorage.setItem('adminSelectedBranchId', id), branch.id);
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { success: true };
    if (path.endsWith('/session'))
      data = { user: { username: 'owner', role: 'owner', branchIds: [] } };
    else if (path.endsWith('/scope'))
      data = { success: true, locations: [branch], selectedBranchId: branch.id };
    else if (path.endsWith('/menu/badges')) data = { badges: [], selected: [] };
    else if (path.endsWith('/menu/product/override')) {
      const patch = route.request().postDataJSON();
      overrides[patch.iikoProductId] = {
        ...overrides[patch.iikoProductId],
        ...patch.overrides,
      };
    } else if (path.endsWith('/menu'))
      data = {
        success: true,
        profileKey: 'default',
        rawMenu: {
          products: Array.from({ length: 75 }, (_, i) => ({
            id: `product-${i + 1}`,
            name: `Товар ${String(i + 1).padStart(3, '0')}`,
            price: 300,
          })),
          groups: [],
        },
        overrides: {
          products: Object.entries(overrides).map(([id, patch]) => ({
            iiko_product_id: id,
            ...patch,
          })),
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
  await page.getByRole('button', { name: /Показать ещё \(45 товаров\)/ }).click();
  await page.getByRole('button', { name: /Показать ещё \(15 товаров\)/ }).click();
  await expect(page.getByRole('button', { name: /Показать ещё/ })).toHaveCount(0);
  const product = page.getByRole('heading', { name: 'Товар 070', exact: true }).locator('..');
  await product.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await product.getByRole('button', { name: 'Изменить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Редактировать: Товар 070' });
  await dialog.getByRole('button', { name: 'KK', exact: true }).click();
  await dialog.locator('#edit-name-kk').fill('Тауар 070');
  await dialog.getByRole('button', { name: 'RU', exact: true }).click();
  await dialog.locator('#edit-description-ru').fill('Состав: мука и молоко');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Показать ещё/ })).toHaveCount(0);
  await expect(product.getByText('Неполное описание')).toBeVisible();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(100);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Товар 070', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Показать ещё/ })).toHaveCount(0);
});
