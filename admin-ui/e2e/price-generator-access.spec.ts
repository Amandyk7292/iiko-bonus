import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, admin = false) {
  let unlocked = false;
  const products = [
    {
      id: 'bun',
      name: 'Булочка',
      price: '500',
      composition: 'Состав: мука.',
      expiry: '1',
      expiryUnit: 'days',
      barcode: '2101430000016',
    },
  ];
  const writes: unknown[] = [];
  const assets = new Set([
    'index.html',
    'app.js',
    'style.css',
    'edit-access.js',
    'edit-access.css',
  ]);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/admin/api/pricegenerator/access') {
      if (route.request().method() === 'POST') {
        if (route.request().postDataJSON().code !== '0123')
          return route.fulfill({ status: 401, json: { error: 'Неверный код.' } });
        unlocked = true;
      } else if (route.request().method() === 'DELETE') unlocked = false;
      return route.fulfill({
        json: { canEdit: admin || unlocked, via: admin ? 'admin' : unlocked ? 'code' : null },
      });
    }
    if (url.pathname === '/api/pricegenerator/template')
      return route.fulfill({ json: { template: null } });
    if (url.pathname === '/api/pricegenerator/products')
      return route.fulfill({ json: { products } });
    if (url.pathname === '/admin/api/pricegenerator/history')
      return route.fulfill({ json: { history: [] } });
    if (url.pathname === '/admin/api/pricegenerator/products') {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { success: true } });
    }
    const file =
      url.pathname === '/pricegenerator' ? 'index.html' : url.pathname.split('/').at(-1)!;
    if (url.pathname.startsWith('/pricegenerator') && assets.has(file))
      return route.fulfill({
        body: await readFile(path.resolve('../public/pricegenerator', file)),
        contentType: file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : 'text/html',
      });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('/pricegenerator');
  await expect(page.locator('#product-select')).toContainText('Булочка');
  return writes;
}

test('guest unlocks and locks editing; desktop also saves a product', async ({
  page,
}, testInfo) => {
  const writes = await setup(page);
  await expect(page.locator('#add-product')).toBeHidden();
  await expect(page.locator('#made-date')).toBeVisible();
  await expect(page.locator('#print-xprinter')).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать по коду', exact: true }).click();
  await page.getByLabel('Код доступа', { exact: true }).fill('9999');
  await page.getByRole('button', { name: 'Открыть редактирование' }).click();
  await expect(page.getByRole('alert')).toHaveText('Неверный код.');
  await expect(page.locator('#add-product')).toBeHidden();
  await page.getByLabel('Код доступа', { exact: true }).fill('0123');
  await page.getByRole('button', { name: 'Открыть редактирование' }).click();
  await expect(page.locator('#add-product')).toBeVisible();
  await expect(page.locator('#edit-access-dialog')).not.toBeVisible();
  if (testInfo.project.name === 'desktop') {
    await page.locator('[data-edit="price"]').fill('550');
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Сохранено', exact: true })).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ products: [{ id: 'bun', price: '550' }] });
  }
  await page.reload();
  await expect(page.locator('#add-product')).toBeVisible();
  await page.getByRole('button', { name: 'Завершить редактирование' }).click();
  await expect(page.locator('#add-product')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Редактировать по коду', exact: true }),
  ).toBeVisible();
});

test('existing administrator can edit without entering a code', async ({ page }) => {
  await setup(page, true);
  await expect(page.locator('#add-product')).toBeVisible();
  await expect(page.locator('#edit-access-status')).toHaveText('Вход администратора');
  await expect(page.locator('#edit-access-open')).toBeHidden();
  await expect(page.locator('#edit-access-lock')).toBeHidden();
});
