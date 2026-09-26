import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
const { PDFDocument, PDFDict, PDFName } = createRequire(import.meta.url)(
  'pdf-lib/dist/pdf-lib.js',
) as typeof import('pdf-lib');
import { readFile } from 'node:fs/promises';

test('bulk PDF uses fresh stops and prices, eight per A4, shared saved preferences', async ({
  page,
}, info) => {
  const branch = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Bulka',
    city: 'Актау',
    active: true,
  };
  let settings = {
    profileKey: 'default',
    background: '#792C14',
    textColor: '#FFFFFF',
    includeQr: false,
  };
  let fresh = false;
  await page.addInitScript((id) => localStorage.setItem('adminSelectedBranchId', id), branch.id);
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { success: true };
    if (path.endsWith('/session'))
      data = { user: { username: 'owner', role: 'owner', branchIds: [] } };
    else if (path.endsWith('/scope'))
      data = { success: true, locations: [branch], selectedBranchId: branch.id };
    else if (path.endsWith('/price-label-settings')) {
      if (route.request().method() === 'POST') {
        settings = route.request().postDataJSON();
        fresh = true;
      }
      data = { success: true, ...settings };
    } else if (path.endsWith('/menu'))
      data = {
        success: true,
        profileKey: 'default',
        rawMenu: {
          products: Array.from({ length: 11 }, (_, i) => ({
            id: `product-${i}`,
            name: i === 10 ? 'Бездрожжевой Овощной' : `Товар ${i}`,
            price: fresh ? 750 : 300,
            description:
              i === 10
                ? 'Состав: мука, вода, соль, растительное масло, орехи, смесь овощной муки, хлопья овсяные, семена льна масличного, семена сушёные, томаты сушёные, хлопья пшеницы.'
                : '',
          })),
          groups: [],
        },
        overrides: {
          products: [
            { iiko_product_id: 'product-0', is_stop_listed: true },
            {
              iiko_product_id: 'product-10',
              name_translations: { kk: 'Ашытқысыз көкөністі нан' },
              description_translations: {
                kk: 'Құрамы: ұн, су, тұз, өсімдік майы, жаңғақ, көкөніс қоспасы, сұлы үлпектері, майлы зығыр тұқымдары, кептірілген қызанақ, бидай үлпектері.',
              },
            },
            ...(fresh ? [{ iiko_product_id: 'product-1', is_stop_listed: true }] : []),
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
  await page.getByRole('button', { name: 'Общая печать ценников', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Общая печать ценников' });
  await expect(dialog.getByText(/К печати: 10/)).toBeVisible();
  await dialog.getByLabel('Фон всех ценников, HEX').fill('#792C14');
  await dialog.getByLabel('Цвет текста, HEX').fill('#F5D400');
  await expect(dialog.locator('.price-label-preview')).toContainText('пшеницы');
  await expect(dialog.locator('.price-label-preview')).toContainText('үлпектері');
  await dialog.getByRole('checkbox').check();
  const downloadReady = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать PDF' }).click();
  const download = await downloadReady;
  const path = info.outputPath('bulk-labels.pdf');
  await download.saveAs(path);
  await expect(dialog.getByRole('status')).toContainText('9 ценников, 2 стр.');
  await expect(dialog.locator('.price-label-preview')).toContainText('750');
  await expect(dialog.locator('.price-label-preview')).not.toContainText('пшеницы');
  await expect(dialog.locator('.price-label-preview')).not.toContainText('үлпектері');
  await expect(dialog.locator('svg[aria-label="QR-код товара"]')).toBeVisible();
  await expect(dialog.locator('.price-label-preview')).not.toContainText('…');
  const pdf = await PDFDocument.load(await readFile(path));
  expect(pdf.getPageCount()).toBe(2);
  const counts = pdf.getPages().map((page) => {
    expect((page.getWidth() / 72) * 25.4).toBeCloseTo(210);
    expect((page.getHeight() / 72) * 25.4).toBeCloseTo(297);
    return page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict).keys().length;
  });
  expect(counts).toEqual([8, 1]);
  await page.screenshot({ path: info.outputPath('bulk-editor.png'), fullPage: true });
  await dialog.getByRole('button', { name: /Закрыть/ }).click();
  await page.getByRole('button', { name: 'Общая печать ценников', exact: true }).click();
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  await dialog.getByRole('button', { name: /Закрыть/ }).click();
  await page.getByRole('button', { name: 'Ценник: Товар 2', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Включить QR-код товара в ценник' }),
  ).toBeChecked();
});

test('prints separate PDFs with the selected city prices', async ({ page }) => {
  const aktau = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Актау',
    city: 'Актау',
    active: true,
  };
  const astana = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Астана',
    city: 'Астана',
    active: true,
  };
  const menuRequests: string[] = [];
  await page.addInitScript((id) => localStorage.setItem('adminSelectedBranchId', id), aktau.id);
  await page.route('**/admin/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const branchId = route.request().headers()['x-bulka-branch-id'];
    const isAstana = branchId === astana.id;
    const profileKey = isAstana ? 'astana' : 'default';
    let data: unknown = { success: true };
    if (pathname.endsWith('/session'))
      data = { user: { username: 'owner', role: 'owner', branchIds: [] } };
    else if (pathname.endsWith('/scope'))
      data = { success: true, locations: [aktau, astana], selectedBranchId: aktau.id };
    else if (pathname.endsWith('/price-label-settings'))
      data = { success: true, profileKey, background: '#792C14', includeQr: false };
    else if (pathname.endsWith('/menu')) {
      menuRequests.push(branchId || '');
      data = {
        success: true,
        profileKey,
        rawMenu: {
          products: [
            {
              id: isAstana ? 'astana-product' : 'aktau-product',
              name: isAstana ? 'Товар Астана' : 'Товар Актау',
              price: isAstana ? 500 : 300,
            },
          ],
          groups: [],
        },
        overrides: { products: [], categories: [], customProducts: [] },
      };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });

  await page.goto('/admin/menu');
  const openBulk = () =>
    page.getByRole('button', { name: 'Общая печать ценников', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Общая печать ценников' });
  await openBulk();
  await expect(dialog.getByText(/Ценники города Актау/)).toBeVisible();
  await expect(dialog.locator('.price-label-preview')).toContainText('300');
  await expect(dialog.locator('.price-label-preview')).not.toContainText('500');
  let downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать PDF' }).click();
  expect((await downloading).suggestedFilename()).toContain('Актау');
  await dialog.getByRole('button', { name: /Закрыть/ }).click();

  await page.getByRole('button', { name: 'Редактировать меню города Астана, 1 филиал' }).click();
  await openBulk();
  await expect(dialog.getByText(/Ценники города Астана/)).toBeVisible();
  await expect(dialog.locator('.price-label-preview')).toContainText('500');
  await expect(dialog.locator('.price-label-preview')).not.toContainText('300');
  downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать PDF' }).click();
  expect((await downloading).suggestedFilename()).toContain('Астана');
  expect(menuRequests).toContain(aktau.id);
  expect(menuRequests).toContain(astana.id);
});

test('prints a locally supplied menu snapshot without changing production data', async ({
  page,
}, info) => {
  test.skip(!process.env.BULKA_LABEL_MENU_SNAPSHOT, 'Optional real menu rendering check');
  test.setTimeout(120000);
  const menu = JSON.parse(
    (await readFile(process.env.BULKA_LABEL_MENU_SNAPSHOT!, 'utf8')).replace(/^\uFEFF/, ''),
  );
  const branch = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Bulka',
    city: 'Актау',
    active: true,
  };
  await page.addInitScript((id) => localStorage.setItem('adminSelectedBranchId', id), branch.id);
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { success: true };
    if (path.endsWith('/session'))
      data = { user: { username: 'owner', role: 'owner', branchIds: [] } };
    else if (path.endsWith('/scope'))
      data = { success: true, locations: [branch], selectedBranchId: branch.id };
    else if (path.endsWith('/price-label-settings'))
      data = { success: true, profileKey: menu.profileKey, background: '#792C14', includeQr: true };
    else if (path.endsWith('/menu')) data = menu;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
  await page.goto('/admin/menu');
  await page.getByRole('button', { name: 'Общая печать ценников', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Общая печать ценников' });
  await expect(dialog.getByRole('button', { name: 'Скачать PDF' })).toBeEnabled();
  const started = Date.now();
  const downloading = page.waitForEvent('download', { timeout: 100000 });
  await dialog.getByRole('button', { name: 'Скачать PDF' }).click();
  await (await downloading).saveAs(info.outputPath('real-menu-labels.pdf'));
  await expect(dialog.getByRole('status')).toContainText('PDF готов');
  console.log(
    JSON.stringify({
      elapsedMs: Date.now() - started,
      result: await dialog.getByRole('status').textContent(),
    }),
  );
});
