import { expect, test } from '@playwright/test';

test('product label previews both languages and prints a 100 by 60 mm page', async ({
  page,
  context,
}, testInfo) => {
  const branch = {
    id: '11111111-1111-4111-8111-111111111111',
    city: 'Актау',
    name: 'Bulka',
    address: 'Дом 1',
    active: true,
    pickupEnabled: true,
  };
  await page.addInitScript((id) => localStorage.setItem('adminSelectedBranchId', id), branch.id);
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: object = { success: true };
    if (path.endsWith('/session'))
      data = { user: { username: 'owner', role: 'owner', branchIds: [] } };
    else if (path.endsWith('/scope'))
      data = { success: true, locations: [branch], selectedBranchId: branch.id };
    else if (path.endsWith('/price-label-settings'))
      data = { success: true, profileKey: 'aktau', background: '#792C14', includeQr: false };
    else if (path.endsWith('/menu'))
      data = {
        success: true,
        profileKey: 'aktau',
        rawMenu: { products: [{ id: 'kozhe', name: 'Название из iiko', price: 300 }], groups: [] },
        overrides: {
          products: [
            {
              iiko_product_id: 'kozhe',
              custom_name: 'Коже',
              custom_price: 500,
              name_translations: { ru: 'Старый перевод', kk: 'Көже' },
              ingredients: 'Кукуруза, кефир, рис, вода.',
              ingredients_translations: { ru: 'Старый состав', kk: 'Жүгері, айран, күріш, су.' },
              custom_description: 'Состав: кукуруза, кефир, рис, вода.',
              description_translations: { kk: 'Құрамы: жүгері, айран, күріш, су.' },
            },
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
  await context.addInitScript(() => {
    window.print = () => {};
  });
  await page.goto('/admin/menu');
  await page.getByRole('button', { name: 'Ценник: Коже', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ценник 10 × 6 см' });
  await expect(dialog.getByLabel('Название на казахском')).toHaveValue('Көже');
  await expect(dialog.getByLabel('Название на русском')).toHaveValue('Коже');
  await expect(dialog.getByLabel('Цена, ₸')).toHaveValue('500');
  await expect(dialog.getByLabel('Описание на русском')).toHaveValue(
    'Состав: кукуруза, кефир, рис, вода.',
  );
  await expect(dialog.getByLabel('Описание на казахском')).toHaveValue(
    'Құрамы: жүгері, айран, күріш, су.',
  );
  const preview = dialog.getByTestId('price-label-preview');
  await expect(preview).toContainText('500');
  await expect(preview).toContainText('Құрамы:');
  await expect(preview).not.toContainText('Старый состав');
  await dialog.getByLabel('Цвет фона, HEX').fill('792c14');
  await dialog.getByLabel('Цена, ₸').click();
  await expect(dialog.getByLabel('Цвет фона, HEX')).toHaveValue('#792C14');
  await expect(dialog.getByRole('button', { name: 'Печать', exact: true })).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('label-editor.png'), fullPage: true });
  const toggle = dialog.getByRole('checkbox', { name: 'Включить QR-код товара в ценник' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  const qr = preview.locator('svg[aria-label="QR-код товара"]');
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute('x', '820');
  await expect(qr).toHaveAttribute('y', '20');
  await page.screenshot({ path: testInfo.outputPath('label-with-qr.png'), fullPage: true });
  await toggle.uncheck();
  await expect(qr).toHaveCount(0);
  await toggle.check();
  const popupReady = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: 'Печать', exact: true }).click();
  const popup = await popupReady;
  await expect(popup.locator('body > svg')).toBeVisible();
  await expect(popup.locator('svg[aria-label="QR-код товара"]')).toBeVisible();
  await popup.emulateMedia({ media: 'print' });
  const dimensions = await popup.locator('body > svg').boundingBox();
  expect(dimensions!.width).toBeCloseTo((100 * 96) / 25.4, 0);
  expect(dimensions!.height).toBeCloseTo((60 * 96) / 25.4, 0);
  await popup.screenshot({ path: testInfo.outputPath('label-print.png') });
  if (testInfo.project.name === 'desktop') {
    await popup.pdf({
      path: testInfo.outputPath('price-label-10x6.pdf'),
      preferCSSPageSize: true,
      printBackground: true,
    });
  }
  await popup.close();
  await dialog.getByLabel('Цвет фона, HEX').fill('wrong');
  await dialog.getByRole('button', { name: 'Печать', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('HEX-код');
  await dialog.getByLabel('Цвет фона, HEX').fill('#792C14');
  await dialog.getByLabel('Название на казахском').fill('');
  const partialPopupReady = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: 'Печать', exact: true }).click();
  const partialPopup = await partialPopupReady;
  await expect(partialPopup.locator('body > svg')).toContainText('Состав: кукуруза');
  await expect(partialPopup.locator('body > svg')).not.toContainText('Көже');
  await partialPopup.close();
});
