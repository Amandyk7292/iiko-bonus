import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const campaignId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const wheel = [
  { id: 'gift', label: 'Кофе в подарок', color: '#FFB600' },
  { id: 'none', label: 'Удача в следующий раз', color: '#FAF1E2' },
];

for (const firstKind of ['gift', 'none'] as const) {
  test(`another fortune receipt is available after ${firstKind}, preserving unclaimed gifts`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let receipts = 0;
    let wheelLoads = 0;
    const spins: string[] = [];
    const firstClaimToken = 'A'.repeat(43);
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const endpoint = `/api/fortune/${campaignId}/${branchId}`;
      if (url.pathname === endpoint) {
        wheelLoads++;
        return route.fulfill({ json: { enabled: true, campaign: { title: 'Подарки Bulka', prizes: wheel }, branch: { name: 'Актау' } } });
      }
      if (url.pathname === `${endpoint}/receipt`) {
        receipts++;
        return route.fulfill({ json: { receiptToken: `receipt-${receipts}`, receipt: { number: receipts, total: 1210 } } });
      }
      if (url.pathname === `${endpoint}/spin`) {
        spins.push(route.request().postDataJSON().receiptToken);
        const kind = spins.length === 1 ? firstKind : firstKind === 'gift' ? 'none' : 'gift';
        return route.fulfill({ json: {
          wheel,
          win: { prizeId: kind, prizeKind: kind, prizeLabel: kind === 'gift' ? wheel[0].label : wheel[1].label, expiresAt: '2099-01-01T00:00:00Z' },
          ...(kind === 'gift' ? { claimToken: spins.length === 1 ? firstClaimToken : 'B'.repeat(43) } : {}),
        } });
      }
      const file = url.pathname === `/fortune/${campaignId}/${branchId}`
        ? 'index.html'
        : url.pathname.startsWith('/fortune-assets/') ? url.pathname.slice('/fortune-assets/'.length) : '';
      if (['index.html', 'fortune.mjs', 'wheel.mjs', 'fortune.css', 'bulka-logo.svg', 'fonts/montserrat-regular.woff2', 'fonts/montserrat-bold.woff2'].includes(file))
        return route.fulfill({
          body: await readFile(path.resolve('../public/fortune', file)),
          contentType: file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html',
        });
      return route.fulfill({ status: 404 });
    });

    await page.goto(`/fortune/${campaignId}/${branchId}`);
    await expect(page.locator('#receipt-step')).toBeVisible();
    const receiptPhoto = { name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('synthetic test receipt') };
    await page.locator('#photo').setInputFiles(receiptPhoto);
    await page.getByRole('button', { name: 'Крутить колесо', exact: true }).click();
    await expect(page.locator('#result-step')).toBeVisible();
    await page.getByRole('button', { name: 'Другой чек', exact: true }).click();
    await expect(page.locator('#receipt-step')).toBeVisible();
    await expect(page.locator('#spin-step')).toBeHidden();
    await expect(page.locator('#result-step')).toBeHidden();
    expect(wheelLoads).toBe(2);

    await page.reload();
    await expect(page.locator('#receipt-step')).toBeVisible();
    if (firstKind === 'gift') {
      await page.getByText('Мои подарки', { exact: true }).click();
      await expect(page.locator('#previous-prize-list').getByRole('link', { name: wheel[0].label })).toHaveAttribute('href', `/profile?register=1#fortune=${firstClaimToken}`);
    }
    await page.locator('#photo').setInputFiles(receiptPhoto);
    await page.getByRole('button', { name: 'Крутить колесо', exact: true }).click();
    await expect(page.locator('#result-step')).toBeVisible();
    expect(spins).toEqual(['receipt-1', 'receipt-2']);
    if (firstKind === 'gift')
      await expect(page.locator('#previous-prize-list').getByRole('link', { name: wheel[0].label })).toHaveAttribute('href', `/profile?register=1#fortune=${firstClaimToken}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}
