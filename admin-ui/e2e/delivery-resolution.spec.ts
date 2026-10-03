import { expect, test } from '@playwright/test';

const branchId = '11111111-1111-4111-8111-111111111111';
const resolutionId = 'a8710c5c-a61c-45db-8aa1-6ac854c7db0a';
const fixture = () => ({
  id: '22222222-2222-4222-8222-222222222222',
  number: 100071,
  paymentStatus: 'paid',
  paymentProvider: 'forte',
  orderStatus: 'ready',
  kitchenStatus: 'ready',
  fulfillmentStatus: 'ready',
  orderType: 'delivery',
  fulfillmentType: 'delivery',
  effectiveFulfillmentType: 'delivery',
  amount: 4200,
  subtotal: 3900,
  discount: 0,
  earnedBonus: 39,
  deliveryFee: 300,
  branch: 'ЖК Дукат',
  branchId,
  items: [{ name: 'Круассан с шоколадом', quantity: 2, price: 1950 }],
  createdAt: '2026-10-03T05:00:00Z',
  updatedAt: '2026-10-03T05:40:00Z',
  acceptedAt: '2026-10-03T05:01:00Z',
  acceptedBy: 'Айжан',
  customer: { name: 'Алия', phone: '+77000000000' },
  deliveryStatus: 'unassigned',
  refundStatus: null as string | null,
  deliveryResolution: {
    id: resolutionId,
    status: 'pickup_pending_approval',
    reason: 'courier_not_found',
    requestedAt: '2026-10-03T05:40:00Z',
    pickupTime: '2026-10-03T12:00:00Z',
  },
});
const words = {
  ru: {
    badge: 'Замена доставки',
    pending: 'Клиент выбрал самовывоз',
    accept: 'Принять самовывоз',
    reject: 'Отклонить самовывоз',
    confirm: 'Подтвердить',
    refresh: 'Обновить',
    processing: 'Проверяем возврат стоимости доставки',
    accepted: 'Самовывоз подтверждён',
    rejected: 'Самовывоз отклонён',
    ready: 'Готовые',
    handover: 'Выдать клиенту',
  },
  kk: {
    badge: 'Жеткізуді ауыстыру',
    pending: 'Клиент алып кетуді таңдады',
    accept: 'Алып кетуді қабылдау',
    reject: 'Алып кетуді қабылдамау',
    confirm: 'Растау',
    refresh: 'Жаңарту',
    processing: 'Жеткізу ақысын қайтару тексерілуде',
    accepted: 'Алып кету расталды',
    rejected: 'Алып кету қабылданбады',
    ready: 'Дайын',
    handover: 'Клиентке беру',
  },
};

for (const locale of ['ru', 'kk'] as const)
  for (const width of [320, 1280]) {
    test(`cashier delivery replacement waits for approval and fee verification ${locale} ${width}`, async ({
      page,
    }, testInfo) => {
      const text = words[locale];
      let order = fixture();
      const decisions: unknown[] = [];
      let releaseReview!: () => void;
      let reviewStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        reviewStarted = resolve;
      });
      const pendingReply = new Promise<void>((resolve) => {
        releaseReview = resolve;
      });
      await page.setViewportSize({ width, height: 960 });
      await page.addInitScript(
        ({ locale }) => {
          localStorage.setItem('adminLocale', locale);
          localStorage.setItem('adminOrderSoundEnabled', 'false');
        },
        { locale },
      );
      await page.route('**/admin/api/**', async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const reply = (body: unknown) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
          });
        if (path.endsWith('/session'))
          return reply({ user: { username: 'cashier', role: 'cashier', branchIds: [branchId] } });
        if (path.endsWith('/scope'))
          return reply({
            success: true,
            locations: [
              { id: branchId, name: 'ЖК Дукат', city: 'Актау', address: 'Актау', active: true },
            ],
            selectedBranchId: branchId,
          });
        if (path.endsWith('/kitchen')) return reply({ success: true, orders: [order] });
        if (path.endsWith('/orders'))
          return reply({ orders: [order], total: 1, page: 1, pageSize: 50 });
        if (path.endsWith('/delivery-resolution')) {
          const body = request.postDataJSON();
          decisions.push(body);
          reviewStarted();
          if (body.action === 'accept') {
            await pendingReply;
            order = {
              ...order,
              deliveryResolution: { ...order.deliveryResolution, status: 'pickup_accepting' },
            };
          } else {
            order = {
              ...order,
              orderStatus: 'cancelled',
              kitchenStatus: 'cancelled',
              refundStatus: 'processing',
              deliveryResolution: { ...order.deliveryResolution, status: 'pickup_rejected' },
            };
          }
          return reply({ success: true, order });
        }
        if (path.endsWith('/events'))
          return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: `unmocked ${path}` }),
        });
      });
      await page.goto('/admin/kitchen');
      const ticket = page.locator('.kitchen-ticket').filter({ hasText: '№100071' });
      await expect(ticket.getByText(text.badge, { exact: true })).toBeVisible();
      await expect(ticket.getByText(text.pending, { exact: true })).toBeVisible();
      const assertNoticeFits = async () => {
        expect(
          await ticket.locator('.delivery-resolution-notice').evaluate((notice) => {
            const bounds = notice.getBoundingClientRect();
            return Array.from(notice.querySelectorAll('strong, span, small, button')).every(
              (child) => {
                const box = child.getBoundingClientRect();
                return (
                  box.left >= bounds.left - 1 &&
                  box.right <= bounds.right + 1 &&
                  child.scrollWidth <= child.clientWidth + 1
                );
              },
            );
          }),
        ).toBe(true);
      };
      const assertHeaderFits = async () => {
        expect(
          await page.locator('.topbar-actions').evaluate((header) =>
            Array.from(
              header.querySelectorAll(
                '.cashier-connection, .cashier-connection strong, .cashier-sound-toggle, .topbar-logout',
              ),
            ).every((control) => {
              const box = control.getBoundingClientRect();
              return (
                box.left >= 0 &&
                box.right <= innerWidth + 1 &&
                control.scrollWidth <= control.clientWidth + 1
              );
            }),
          ),
        ).toBe(true);
      };
      await assertNoticeFits();
      await assertHeaderFits();
      await expect(ticket.getByRole('button', { name: text.handover, exact: true })).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath('cashier-pickup-pending.png'),
        fullPage: true,
        animations: 'disabled',
      });
      if (width === 320) {
        await page.addStyleTag({ content: 'html { font-size: 24px !important; }' });
        await expect(ticket.getByRole('button', { name: text.accept, exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth + 1)).toBe(true);
        await assertNoticeFits();
        await assertHeaderFits();
        await page.screenshot({
          path: testInfo.outputPath('cashier-pickup-pending-text150.png'),
          fullPage: true,
          animations: 'disabled',
        });
      }
      await ticket.getByRole('button', { name: text.accept, exact: true }).click();
      await started;
      expect(decisions).toEqual([{ action: 'accept', resolutionId }]);
      await expect(ticket.getByRole('button', { name: text.reject, exact: true })).toBeDisabled();
      await expect(ticket.getByText(text.accepted, { exact: true })).toHaveCount(0);
      releaseReview();
      await expect(page.getByText(text.processing, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: text.accept, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: text.handover, exact: true })).toHaveCount(0);
      order = {
        ...order,
        orderType: 'pickup',
        fulfillmentType: 'pickup',
        effectiveFulfillmentType: 'pickup',
        deliveryResolution: { ...order.deliveryResolution, status: 'pickup_accepted' },
      };
      await page.getByRole('button', { name: text.refresh, exact: true }).click();
      if (width === 320)
        await page.getByRole('tab', { name: new RegExp(`^${text.ready} 1$`) }).click();
      await expect(page.getByText(text.accepted, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: text.handover, exact: true })).toBeVisible();
      await page.goto('/admin/orders');
      await expect(page.getByText(text.badge, { exact: true })).toBeVisible();
      await expect(page.getByText(text.accepted, { exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('cashier-pickup-accepted.png'),
        fullPage: true,
        animations: 'disabled',
      });
      order = fixture();
      await page.getByRole('button', { name: text.refresh, exact: true }).click();
      await page.getByRole('button', { name: text.reject, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: text.reject, exact: true });
      await expect(dialog).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('cashier-pickup-reject-confirmation.png'),
        fullPage: true,
        animations: 'disabled',
      });
      await dialog.getByRole('button', { name: text.confirm, exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(text.rejected, { exact: true })).toBeVisible();
      expect(decisions).toEqual([
        { action: 'accept', resolutionId },
        { action: 'reject', resolutionId },
      ]);
      expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  }
