import { test, expect } from '@playwright/test';

test('kitchen displays the chosen size and supplement without changing the product count', async ({
  page,
}) => {
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { success: true };
    if (path.endsWith('/session'))
      data = { user: { username: 'owner', role: 'owner', branchIds: [] } };
    if (path.endsWith('/scope')) data = { success: true, locations: [], selectedBranchId: '' };
    if (path.endsWith('/kitchen'))
      data = {
        success: true,
        orders: [
          {
            id: 'fixture',
            number: 123456,
            branch: 'Тестовая пекарня',
            kitchenStatus: 'queued',
            fulfillmentType: 'pickup',
            createdAt: new Date().toISOString(),
            items: [
              {
                name: 'Кофе',
                quantity: 2,
                optionSummary: 'Размер: Большой (+300 ₸); Добавки: Сироп (+100 ₸)',
              },
            ],
          },
        ],
      };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
  await page.goto('/admin/kitchen');
  await expect(page.getByText('Размер: Большой (+300 ₸); Добавки: Сироп (+100 ₸)')).toBeVisible();
  await expect(page.getByText('2×', { exact: true })).toBeVisible();
  await expect(page.getByText('[object Object]', { exact: false })).toHaveCount(0);
});
