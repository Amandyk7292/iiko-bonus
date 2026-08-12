import { expect, test } from '@playwright/test';

const branchId = '11111111-1111-4111-8111-111111111111';

test('cashier explicitly enables, restores and disables iPad push without leaking the token', async ({
  page,
}) => {
  let enabled = false;
  let registrations = 0;
  let removals = 0;
  let tests = 0;

  await page.addInitScript(() => {
    type BridgeRequest = {
      version: 1;
      requestId: string;
      action: 'register' | 'unregister' | 'status';
    };
    const browserWindow = window as typeof window & {
      BulkaStaffPushBridge?: { request: (request: BridgeRequest) => boolean };
    };
    browserWindow.BulkaStaffPushBridge = {
      request: (request) => {
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent('bulka:staff-push-response', {
              detail: {
                version: 1,
                requestId: request.requestId,
                action: request.action,
                ok: true,
                permission: 'authorized',
                platform: 'ios',
                installationId: 'ipad-kitchen-1',
                ...(request.action === 'register' ? { fcmToken: 'secret-fcm-token' } : {}),
              },
            }),
          );
        });
        return true;
      },
    };
  });

  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/admin/api/session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { username: 'cashier.aktau', role: 'cashier', branchIds: [branchId] },
        }),
      });
    }
    if (path === '/admin/api/scope') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          locations: [
            {
              id: branchId,
              name: '19-й микрорайон',
              address: 'Актау',
              city: 'Актау',
              active: true,
            },
          ],
          selectedBranchId: branchId,
        }),
      });
    }
    if (path === '/admin/api/staff/push-token' && request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          enabled,
          device: enabled
            ? { platform: 'ios', installationId: 'ipad-kitchen-1' }
            : null,
        }),
      });
    }
    if (path === '/admin/api/staff/push-token' && request.method() === 'POST') {
      const body = request.postDataJSON();
      expect(body).toEqual({
        fcmToken: 'secret-fcm-token',
        installationId: 'ipad-kitchen-1',
        platform: 'ios',
      });
      enabled = true;
      registrations += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          device: { platform: 'ios', installationId: 'ipad-kitchen-1' },
        }),
      });
    }
    if (path === '/admin/api/staff/push-token' && request.method() === 'DELETE') {
      enabled = false;
      removals += 1;
      return route.fulfill({ status: 204, body: '' });
    }
    if (path === '/admin/api/staff/push-test' && request.method() === 'POST') {
      tests += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          delivery: { status: 'sent', attempted: 1, delivered: 1 },
        }),
      });
    }
    if (path === '/admin/api/kitchen') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, orders: [] }),
      });
    }
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: `not mocked: ${request.method()} ${path}` }),
    });
  });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/admin/kitchen?embedded=app');
  const pushOff = page.getByRole('button', { name: 'Push выключен' });
  await expect(pushOff).toBeVisible();
  await expect(pushOff).toHaveAttribute('aria-pressed', 'false');
  expect(registrations).toBe(0);

  await pushOff.click();
  await expect(page.getByRole('button', { name: 'Push включён' })).toBeVisible();
  expect(registrations).toBe(1);
  expect(await page.locator('body').textContent()).not.toContain('secret-fcm-token');

  expect(tests).toBe(0);
  await page.getByRole('button', { name: 'Проверить push' }).click();
  await expect(page.getByRole('button', { name: 'Тест отправлен' })).toBeVisible();
  expect(tests).toBe(1);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Push включён' })).toBeVisible();
  expect(registrations).toBe(2);

  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1180, height: 820 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const selectors = [
        '.cashier-branch',
        '.cashier-connection',
        '.cashier-sound-toggle',
        '.cashier-push-toggle',
        '.cashier-push-test',
        '.topbar-logout',
      ];
      const controls = selectors.map((selector) => document.querySelector(selector));
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        controlsInsideViewport: controls.every((element) => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= window.innerWidth;
        }),
        buttonHeight: document
          .querySelector('.cashier-push-toggle')
          ?.getBoundingClientRect().height,
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.controlsInsideViewport).toBe(true);
    expect(layout.buttonHeight).toBeGreaterThanOrEqual(48);
  }

  await page.getByRole('button', { name: 'Push включён' }).click();
  await expect(page.getByRole('button', { name: 'Push выключен' })).toBeVisible();
  expect(removals).toBe(1);
});

test('browser cashier does not see a misleading push action', async ({ page }) => {
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/admin/api/session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { username: 'cashier.aktau', role: 'cashier', branchIds: [branchId] },
        }),
      });
    }
    if (path === '/admin/api/scope') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, locations: [], selectedBranchId: null }),
      });
    }
    if (path === '/admin/api/kitchen') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, orders: [] }),
      });
    }
    if (path === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/admin/kitchen');
  await expect(page.locator('.kitchen-board')).toBeVisible();
  await expect(page.getByRole('button', { name: /Push/ })).toHaveCount(0);
});
