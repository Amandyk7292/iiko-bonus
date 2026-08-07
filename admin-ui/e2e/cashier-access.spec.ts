import { expect, test } from '@playwright/test';

const locations = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Bulka — Актау 17',
    address: '17-й микрорайон, 55',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Bulka — Актау 4',
    address: '4-й микрорайон, 71',
  },
];

test('owner creates a password cashier for exactly one branch', async ({ page }, testInfo) => {
  const profiles: Array<Record<string, unknown>> = [
    {
      username: 'admin',
      display_name: 'Владелец',
      role: 'owner',
      branch_ids: [],
      active: true,
      authMethod: 'environment',
      passwordConfigured: true,
    },
  ];
  let createdBody: Record<string, unknown> | null = null;

  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === '/admin/api/session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'admin', role: 'owner', branchIds: [] } }),
      });
    }
    if (path === '/admin/api/scope') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, locations, selectedBranchId: null }),
      });
    }
    if (path === '/admin/api/access' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          profiles,
          configuredUsers: profiles.map((profile) => profile.username),
        }),
      });
    }
    if (path === '/admin/api/access' && method === 'POST') {
      createdBody = request.postDataJSON() as Record<string, unknown>;
      profiles.push({
        username: createdBody.username,
        display_name: createdBody.displayName,
        role: 'cashier',
        branch_ids: createdBody.branchIds,
        active: true,
        authMethod: 'password',
        passwordConfigured: true,
      });
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, profile: profiles.at(-1) }),
      });
    }
    if (path === '/admin/api/locations' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, locations }),
      });
    }
    if (path === '/admin/api/online-ordering' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, config: { disabled: false } }),
      });
    }
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: `not mocked: ${method} ${path}` }),
    });
  });

  await page.goto('/admin/access');
  await page.getByRole('button', { name: 'Добавить сотрудника' }).click();

  const dialog = page.getByRole('dialog', { name: 'Новый сотрудник' });
  await expect(dialog.getByRole('button', { name: 'Кассир по логину' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog.getByLabel('Логин').fill('cashier.aktau.17');
  await dialog.getByLabel('Имя сотрудника').fill('Алия Актау 17');
  await dialog.getByRole('textbox', { name: 'Пароль', exact: true }).fill('BulkaCashier17');
  await dialog.getByLabel(/Bulka — Актау 17/).check();

  await expect(dialog.getByLabel(/Bulka — Актау 4/)).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Добавить сотрудника' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Алия Актау 17', exact: true })).toBeVisible();
  await expect(page.getByText('Вход по логину и паролю', { exact: true })).toBeVisible();
  expect(createdBody).toEqual({
    username: 'cashier.aktau.17',
    password: 'BulkaCashier17',
    displayName: 'Алия Актау 17',
    role: 'cashier',
    branchIds: [locations[0].id],
  });

  await page.screenshot({
    path: testInfo.outputPath('cashier-access.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
