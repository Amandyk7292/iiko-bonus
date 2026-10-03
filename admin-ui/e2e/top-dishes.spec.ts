import { expect, test, type Locator, type Page } from '@playwright/test';

type Locale = 'ru' | 'kk';
type AnalyticsQuery = {
  view: string;
  serverId: string;
  from: string;
  to: string;
  department: string;
};
type ReportQuery = {
  serverId: string;
  reportType: string;
  from: string;
  to: string;
  groupBy: string[];
  aggregate: string[];
  filters: { field: string; values: (string | number | boolean)[]; exclude: boolean }[];
};

function responseGate<T>() {
  let receive!: (query: T) => void;
  let release!: () => void;
  const requested = new Promise<T>((resolve) => {
    receive = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { receive, release, requested, pending };
}

const dailyFixture = [
  {
    'OpenDate.Typed': '2026-09-01',
    Department: 'Основной цех',
    DishMeasureUnit: 'шт',
    DishAmountInt: 4.5,
    DishDiscountSumInt: 9000,
  },
  {
    'OpenDate.Typed': '2026-09-04',
    Department: 'Bulka 16 мкр 85 дом',
    DishMeasureUnit: 'шт',
    DishAmountInt: 3.5,
    DishDiscountSumInt: 7000,
  },
  {
    'OpenDate.Typed': '2026-09-02',
    Department: 'Основной цех',
    DishMeasureUnit: 'шт',
    DishAmountInt: 1.25,
    DishDiscountSumInt: 2500,
  },
  {
    'OpenDate.Typed': '2026-09-01',
    Department: 'Bulka 16 мкр 85 дом',
    DishMeasureUnit: 'шт',
    DishAmountInt: 2,
    DishDiscountSumInt: 4000,
  },
  {
    'OpenDate.Typed': '2026-09-04',
    Department: 'Bulka 16 мкр 85 дом',
    DishMeasureUnit: 'шт',
    DishAmountInt: -0.5,
    DishDiscountSumInt: -1000,
  },
  // A stable ID may be sold in another unit; that unit must stay separate.
  {
    'OpenDate.Typed': '2026-09-01',
    Department: 'Основной цех',
    DishMeasureUnit: 'кг',
    DishAmountInt: 999,
    DishDiscountSumInt: 999000,
  },
];

const from = '2026-09-01';
const to = '2026-09-15';
const initialPoint = 'Основной цех';
const nextPoint = 'Bulka 16 мкр 85 дом';
const labels = {
  ru: {
    title: 'Топ блюд',
    point: 'Точка',
    choosePeriod: 'Выбрать период',
    settings: 'Настройки',
    refresh: 'Обновить',
    allPoints: 'Все точки',
    close: 'Закрыть',
    presets: ['Сегодня', 'Вчера', '7 дней', 'Этот месяц'],
  },
  kk: {
    title: 'Үздік тағамдар',
    point: 'Нүкте',
    choosePeriod: 'Кезеңді таңдау',
    settings: 'Баптаулар',
    refresh: 'Жаңарту',
    allPoints: 'Барлық нүктелер',
    close: 'Жабу',
    presets: ['Бүгін', 'Кеше', '7 күн', 'Осы ай'],
  },
};
const longWord = { ru: 'Сливочнокарамельный', kk: 'Сүттікарамельді' };
const firstName = (locale: Locale) =>
  `Круассан ${longWord[locale]} с начинкой из ванильного крема и обжаренного миндаля`;

function fixture(locale: Locale, suffix = '') {
  const row = (id: string, name: string, quantity: number, unit = 'шт', group = 'Выпечка') => ({
    DishId: id,
    DishName: name + suffix,
    DishMeasureUnit: unit,
    DishGroup: group,
    DishAmountInt: quantity,
    DishDiscountSumInt: quantity * 490,
  });
  // More than ten unsorted products. One ID has renamed/grouped splits and a
  // signed cancellation; two different IDs intentionally share a display name.
  return [
    row('pizza', 'Пицца с сыром и томатами', 7),
    row('coffee-small', 'Капучино', 9.75, 'л', 'Напитки'),
    row('croissant', firstName(locale), 20.125),
    row('cancelled', 'Полностью отменённый товар', 100),
    row('tea', 'Чай с облепихой и мёдом', 20, 'л', 'Напитки'),
    row('roll', 'Булочка с корицей и сливочным кремом', 11.5),
    row('below-cutoff', 'Пирог за пределами десятки', 5.5),
    row('brownie', 'Шоколадный брауни с грецкими орехами', 24.125, 'кг'),
    row('croissant', 'Круассан после переименования', 13.5, 'шт', 'Новая группа'),
    row('coffee-large', 'Капучино', 27.5, 'л', 'Напитки'),
    row('pretzel', 'Крендель с морской солью', 15),
    row('zero', 'Товар с нулевым количеством', 10),
    row('juice', 'Свежевыжатый апельсиновый сок', 8.25, 'л', 'Напитки'),
    row('bread', 'Хлеб цельнозерновой на закваске', 18.5, 'кг'),
    row('eclair', 'Эклер с фисташковым кремом', 13.75),
    row('last', 'Печенье овсяное', 4),
    row('croissant', 'Круассан возврат', -3.375, 'шт', 'Возвраты'),
    row('cancelled', 'Полностью отменённый товар', -102),
    row('zero', 'Товар с нулевым количеством', -10),
  ];
}

async function assertDaily(
  dialog: Locator,
  locale: Locale,
  quantities: number[],
  revenues: number[],
) {
  const rows = dialog.locator('.id-top-dish-daily tbody tr');
  await expect(rows).toHaveCount(15);
  const numbers = await rows.evaluateAll((elements, locale) => {
    const parts = new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'kk-KZ').formatToParts(12345.6);
    const group = parts.find((part) => part.type === 'group')?.value || '';
    const decimal = parts.find((part) => part.type === 'decimal')?.value || '.';
    return elements.map((element) =>
      [...element.querySelectorAll('td')].map((cell) => {
        let value = cell.textContent!;
        if (group) value = value.split(group).join('');
        return Number(value.replace(decimal, '.').replace(/[^\d.\-]/gu, ''));
      }),
    );
  }, locale);
  expect(numbers).toEqual(
    Array.from({ length: 15 }, (_, index) => [quantities[index] || 0, revenues[index] || 0]),
  );
  const formattedDates = await dialog.evaluate(
    (_element, locale) =>
      Array.from({ length: 15 }, (_, index) =>
        new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'kk-KZ', {
          day: '2-digit',
          month: '2-digit',
          timeZone: 'UTC',
        }).format(new Date(`2026-09-${String(index + 1).padStart(2, '0')}T00:00:00Z`)),
      ),
    locale,
  );
  await expect(rows.locator('th')).toHaveText(formattedDates);
}

async function assertDetailReadable(page: Page, dialog: Locator, locale: Locale) {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    root: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(Math.max(widths.body, widths.root), JSON.stringify(widths)).toBeLessThanOrEqual(
    widths.viewport + 1,
  );
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  const close = dialog.getByRole('button', { name: labels[locale].close, exact: true });
  await expect(close).toBeVisible();
  const icon = await close.locator('svg').evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
  }));
  expect(icon.width).toBeGreaterThanOrEqual(12);
  expect(icon.height).toBeGreaterThanOrEqual(12);
  const wordLines = await dialog.locator('.modal-title').evaluate((element, word) => {
    const node = element.firstChild!;
    const start = node.textContent!.indexOf(word);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + word.length);
    return new Set([...range.getClientRects()].map((rect) => rect.top)).size;
  }, longWord[locale]);
  expect(wordLines).toBe(1);
  const values = await dialog
    .locator(
      '.modal-title, .id-top-dish-point-name, .id-top-dish-point-values > *, .id-top-dish-summary strong',
    )
    .evaluateAll((elements) =>
      elements.map((element) => ({
        text: element.textContent,
        ellipsis: getComputedStyle(element).textOverflow === 'ellipsis',
        heightFits: element.scrollHeight <= element.clientHeight + 1,
        widthReachable:
          element.scrollWidth <= element.clientWidth + 1 ||
          ['auto', 'scroll'].includes(getComputedStyle(element).overflowX),
      })),
    );
  expect(
    values.every((value) => !value.ellipsis && value.heightFits && value.widthReachable),
    JSON.stringify(values),
  ).toBe(true);
  const scroller = dialog.locator('.id-top-dish-daily-scroll');
  expect(
    await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth - element.clientWidth;
      const lastCell = element.querySelector('tbody tr td:last-child')!;
      const range = document.createRange();
      range.selectNodeContents(lastCell);
      const box = element.getBoundingClientRect();
      const rects = [...range.getClientRects()];
      const reachable = rects.every(
        (rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1,
      );
      element.scrollLeft = 0;
      return reachable;
    }),
  ).toBe(true);
}

for (const width of [320, 1280]) {
  for (const locale of ['ru', 'kk'] as const) {
    test(`Top dish details show point and daily sales at ${width}px in ${locale}`, async ({
      page,
    }, testInfo) => {
      const detailRequests: ReportQuery[] = [];
      const errors: string[] = [];
      const failures: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('requestfailed', (request) => {
        if (new URL(request.url()).pathname === '/admin/api/iiko-dashboard/report')
          failures.push(request.failure()?.errorText || 'failed');
      });
      let rejectNextDetail = true;
      let nextDetailGate: ReturnType<typeof responseGate<ReportQuery>> | undefined =
        responseGate<ReportQuery>();
      const firstGate = nextDetailGate;
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((locale) => {
        localStorage.setItem('adminLocale', locale);
        localStorage.setItem(
          'bulka-iiko-dashboard-v1',
          JSON.stringify({ auto: false, cards: [], templates: [] }),
        );
      }, locale);
      await page.route('**/admin/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = (body: unknown) => route.fulfill({ status: 200, json: body });
        if (path === '/admin/api/session')
          return json({ user: { username: 'qa', role: 'iiko_dashboard', branchIds: [] } });
        if (path === '/admin/api/scope')
          return json({ success: true, locations: [], selectedBranchId: null });
        if (path === '/admin/api/iiko-dashboard/servers')
          return json({
            servers: [
              {
                id: 'aktau-chain',
                city: 'aktau',
                kind: 'chain',
                configured: true,
                active: true,
                host: 'aktau.example.com',
              },
            ],
          });
        if (path === '/admin/api/iiko-dashboard/departments')
          return json({
            serverId: 'aktau-chain',
            departments: [
              { id: 'workshop', name: initialPoint },
              { id: 'point-16', name: nextPoint },
            ],
          });
        if (path === '/admin/api/iiko-dashboard/analytics')
          return json({
            serverId: 'aktau-chain',
            fetchedAt: '2026-10-03T08:00:00Z',
            columns: {},
            rows: fixture(locale),
          });
        if (path === '/admin/api/iiko-dashboard/report') {
          const query = route.request().postDataJSON() as ReportQuery;
          detailRequests.push(query);
          const gate = nextDetailGate;
          const reject = rejectNextDetail;
          if (gate) {
            gate.receive(query);
            await gate.pending;
          }
          if (reject)
            return route.fulfill({
              status: 503,
              json: { error: 'Temporary reporting failure', code: 'IIKO_UNAVAILABLE' },
            });
          return json({
            serverId: 'aktau-chain',
            fetchedAt: '2026-10-03T08:00:00Z',
            period: { from: query.from, to: query.to },
            columns: {},
            rows: dailyFixture,
          });
        }
        if (path === '/admin/api/events')
          return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
        return route.fulfill({ status: 404, json: {} });
      });
      await page.goto(
        `/admin/iiko-dashboard?tab=topDishes&server=aktau-chain&from=${from}&to=${to}`,
      );
      const report = page.getByRole('region', { name: labels[locale].title, exact: true });
      const rows = report.locator('ol.id-top-dishes-list li');
      const openRow = report.locator('button.id-top-dishes-row').first();
      const dialog = page.getByRole('dialog', { name: firstName(locale), exact: true });
      const detail = dialog.locator('.id-top-dish-details');
      const point = page
        .locator('.id-primary-filters')
        .getByRole('combobox', { name: labels[locale].point, exact: true });
      await expect(rows).toHaveCount(10);
      await openRow.focus();
      try {
        await openRow.press('Enter');
        const query = await firstGate.requested;
        expect(query).toEqual({
          serverId: 'aktau-chain',
          reportType: 'SALES',
          from,
          to,
          groupBy: ['OpenDate.Typed', 'Department', 'DishMeasureUnit'],
          aggregate: ['DishAmountInt', 'DishDiscountSumInt'],
          filters: [
            { field: 'OrderDeleted', values: ['NOT_DELETED'], exclude: false },
            { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'], exclude: false },
            { field: 'DishId', values: ['croissant'], exclude: false },
          ],
        });
        await expect(dialog).toBeVisible();
        await expect(detail).toHaveAttribute('aria-busy', 'true');
        await expect(dialog.getByRole('status')).toBeVisible();
        await expect(dialog.locator('.id-top-dish-daily tbody tr')).toHaveCount(0);
      } finally {
        firstGate.release();
        nextDetailGate = undefined;
        rejectNextDetail = false;
      }
      await expect(dialog.getByRole('alert')).toBeVisible();
      await dialog.screenshot({ path: testInfo.outputPath('top-dish-details-error.png') });

      const retryGate = responseGate<ReportQuery>();
      nextDetailGate = retryGate;
      try {
        await dialog.getByRole('button', { name: labels[locale].refresh, exact: true }).click();
        expect(await retryGate.requested).toEqual(detailRequests[0]);
        await expect(detail).toHaveAttribute('aria-busy', 'true');
        await expect(dialog.getByRole('alert')).toHaveCount(0);
        await expect(dialog.getByRole('status')).toBeVisible();
      } finally {
        retryGate.release();
        nextDetailGate = undefined;
      }
      await expect(detail).toHaveAttribute('aria-busy', 'false');
      await assertDaily(dialog, locale, [6.5, 1.25, 0, 3], [13000, 2500, 0, 6000]);
      const summaries = dialog.locator('.id-top-dish-summary strong');
      const formatted = await page.evaluate(
        ({ locale }) => {
          const number = new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'kk-KZ', {
            maximumFractionDigits: 6,
          });
          return [
            number.format(10.75) + ' шт',
            number.format(21500) + ' ₸',
            number.format(5.75) + ' шт',
            number.format(11500) + ' ₸',
            number.format(5) + ' шт',
            number.format(10000) + ' ₸',
          ];
        },
        { locale },
      );
      await expect(summaries).toHaveText(formatted.slice(0, 2));
      const points = dialog.locator('.id-top-dish-points');
      const workshop = points.getByRole('button', { name: new RegExp(initialPoint) });
      const shop = points.getByRole('button', { name: new RegExp(nextPoint) });
      await expect(points.locator('ul li')).toHaveCount(2);
      await expect(workshop.locator('.id-top-dish-point-values > *')).toHaveText(
        formatted.slice(2, 4),
      );
      await expect(shop.locator('.id-top-dish-point-values > *')).toHaveText(formatted.slice(4, 6));
      const requestsBeforePointSelection = detailRequests.length;
      await workshop.click();
      await expect(workshop).toHaveAttribute('aria-pressed', 'true');
      await assertDaily(dialog, locale, [4.5, 1.25], [9000, 2500]);
      await shop.click();
      await expect(shop).toHaveAttribute('aria-pressed', 'true');
      await assertDaily(dialog, locale, [2, 0, 0, 3], [4000, 0, 0, 6000]);
      await points.getByRole('button', { name: labels[locale].allPoints, exact: true }).click();
      await assertDaily(dialog, locale, [6.5, 1.25, 0, 3], [13000, 2500, 0, 6000]);
      await page.evaluate(() => document.fonts.ready);
      await dialog.screenshot({ path: testInfo.outputPath('top-dish-details.png') });
      await assertDetailReadable(page, dialog, locale);
      expect(detailRequests).toHaveLength(requestsBeforePointSelection);
      await dialog.getByRole('button', { name: labels[locale].close, exact: true }).focus();
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(openRow).toBeFocused();
      await openRow.press('Space');
      await expect(dialog.locator('.id-top-dish-daily tbody tr')).toHaveCount(15);
      await dialog.getByRole('button', { name: labels[locale].close, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(openRow).toBeFocused();

      // Browser history changes shared scope while the dialog request is held.
      // The old detail closes immediately and its network request is aborted.
      await point.selectOption(nextPoint);
      await expect(report).toHaveAttribute('aria-busy', 'false');
      const scopeGate = responseGate<ReportQuery>();
      nextDetailGate = scopeGate;
      try {
        await openRow.click();
        const query = await scopeGate.requested;
        expect(query.filters.at(-1)).toEqual({
          field: 'Department',
          values: [nextPoint],
          exclude: false,
        });
        const cancelled = page.waitForEvent('requestfailed', {
          predicate: (request) =>
            new URL(request.url()).pathname === '/admin/api/iiko-dashboard/report',
        });
        await page.goBack();
        await expect(point).toHaveValue('');
        await expect(dialog).toHaveCount(0);
        await cancelled;
      } finally {
        scopeGate.release();
        nextDetailGate = undefined;
      }
      await expect(rows).toHaveCount(10);

      await page.locator('.id-period-disclosure > summary').click();
      await page.getByRole('button', { name: labels[locale].choosePeriod, exact: true }).click();
      await page.locator('.id-calendar-days button[data-date="2026-09-02"]').click();
      expect(new URL(page.url()).searchParams.get('from')).toBe(from);
      await expect(page.locator('.id-calendar')).toBeVisible();
      await page.locator('.id-calendar-days button[data-date="2026-09-10"]').click();
      await expect(page.locator('.id-calendar')).toHaveCount(0);
      await expect(page.locator('.id-period-disclosure')).toHaveJSProperty('open', false);
      await expect(report).toHaveAttribute('aria-busy', 'false');
      const dateGate = responseGate<ReportQuery>();
      nextDetailGate = dateGate;
      try {
        await openRow.click();
        expect(await dateGate.requested).toMatchObject({ from: '2026-09-02', to: '2026-09-10' });
        const cancelled = page.waitForEvent('requestfailed', {
          predicate: (request) =>
            new URL(request.url()).pathname === '/admin/api/iiko-dashboard/report',
        });
        await page.goBack();
        expect(new URL(page.url()).searchParams.get('from')).toBe(from);
        expect(new URL(page.url()).searchParams.get('to')).toBe(to);
        await expect(dialog).toHaveCount(0);
        await cancelled;
      } finally {
        dateGate.release();
        nextDetailGate = undefined;
      }
      expect(
        failures.filter((failure) => /ABORTED|CANCELLED/iu.test(failure)).length,
      ).toBeGreaterThanOrEqual(2);
      await expect(rows).toHaveCount(10);

      if (width === 320) {
        for (const factor of [1.5, 2]) {
          await page.reload();
          await expect(rows).toHaveCount(10);
          await openRow.click();
          await expect(dialog.locator('.id-top-dish-daily tbody tr')).toHaveCount(15);
          await page.evaluate(() => document.fonts.ready);
          await scaleText(page, factor);
          await assertDetailReadable(page, dialog, locale);
          await dialog.screenshot({
            path: testInfo.outputPath(`top-dish-details-text-${factor}.png`),
          });
          await dialog.getByRole('button', { name: labels[locale].close, exact: true }).click();
          await expect(dialog).toHaveCount(0);
          await expect(openRow).toBeFocused();
        }
      }
      expect(errors).toEqual([]);
    });
  }
}

const expectedQuantities = [30.25, 27.5, 24.125, 20, 18.5, 15, 13.75, 11.5, 9.75, 8.25];
const expectedUnits = ['шт', 'л', 'кг', 'л', 'кг', 'шт', 'шт', 'шт', 'л', 'л'];
const expectedNames = (locale: Locale) => [
  firstName(locale),
  'Капучино',
  'Шоколадный брауни с грецкими орехами',
  'Чай с облепихой и мёдом',
  'Хлеб цельнозерновой на закваске',
  'Крендель с морской солью',
  'Эклер с фисташковым кремом',
  'Булочка с корицей и сливочным кремом',
  'Капучино',
  'Свежевыжатый апельсиновый сок',
];

async function scaleText(page: Page, factor: number) {
  // Match the existing layout suite: scale text once without zooming the page.
  await page.evaluate((factor) => {
    const elements = [
      ...document.querySelectorAll<HTMLElement>(
        '.id-dashboard, .id-dashboard *, .modal-panel, .modal-panel *',
      ),
    ];
    const sizes = elements.map((element) => parseFloat(getComputedStyle(element).fontSize));
    document.documentElement.style.fontSize = `${16 * factor}px`;
    elements.forEach((element, index) => {
      element.style.fontSize = `${sizes[index] * factor}px`;
    });
  }, factor);
}

async function assertReadable(page: Page, report: Locator, locale: Locale) {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    root: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(Math.max(widths.body, widths.root), JSON.stringify(widths)).toBeLessThanOrEqual(
    widths.viewport + 1,
  );
  expect(await report.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  const products = await report.locator('.id-top-dishes-product strong').evaluateAll((elements) =>
    elements.map((element) => ({
      name: element.textContent,
      ellipsis: getComputedStyle(element).textOverflow === 'ellipsis',
      heightFits: element.scrollHeight <= element.clientHeight + 1,
      widthReachable:
        element.scrollWidth <= element.clientWidth + 1 ||
        getComputedStyle(element).overflowX === 'auto',
    })),
  );
  expect(
    products.every((product) => !product.ellipsis && product.heightFits && product.widthReachable),
    JSON.stringify(products),
  ).toBe(true);
  const word = await report
    .locator('.id-top-dishes-product strong')
    .first()
    .evaluate((element, word) => {
      const node = element.firstChild!;
      const start = node.textContent!.indexOf(word);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + word.length);
      const rects = [...range.getClientRects()];
      const box = element.getBoundingClientRect();
      const fits = rects.every((rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1);
      element.scrollLeft = element.scrollWidth - element.clientWidth;
      range.setStart(node, start + word.length - 1);
      const lastLetter = range.getBoundingClientRect();
      const endReachable = lastLetter.right <= box.right + 1 && lastLetter.left >= box.left - 1;
      element.scrollLeft = 0;
      return {
        lines: new Set(rects.map((rect) => rect.top)).size,
        fits,
        endReachable,
        overflow: getComputedStyle(element).overflowX,
      };
    }, longWord[locale]);
  expect(word.lines).toBe(1);
  expect(word.fits || (word.overflow === 'auto' && word.endReachable)).toBe(true);
}

for (const width of [320, 1280]) {
  for (const locale of ['ru', 'kk'] as const) {
    test(`Top dishes ranks and scopes sales at ${width}px in ${locale}`, async ({
      page,
    }, testInfo) => {
      const role = width === 320 && locale === 'kk' ? 'iiko_dashboard' : 'owner';
      const requests: AnalyticsQuery[] = [];
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let gate: { received: (query: AnalyticsQuery) => void; release: Promise<void> } | undefined;
      function gateNextReport() {
        let received!: (query: AnalyticsQuery) => void;
        let release!: () => void;
        const requested = new Promise<AnalyticsQuery>((resolve) => {
          received = resolve;
        });
        const pending = new Promise<void>((resolve) => {
          release = resolve;
        });
        gate = { received, release: pending };
        return { requested, release };
      }
      const suffixFor = (query: AnalyticsQuery) =>
        query.department === initialPoint && query.from === from && query.to === to
          ? ''
          : ` · ${query.department} ${query.from}–${query.to}`;

      await page.clock.setFixedTime(new Date('2026-10-03T08:00:00Z'));
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((locale) => {
        localStorage.setItem('adminLocale', locale);
        localStorage.setItem(
          'bulka-iiko-dashboard-v1',
          JSON.stringify({ auto: false, cards: [], templates: [] }),
        );
      }, locale);
      await page.route('**/admin/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = (body: unknown) => route.fulfill({ status: 200, json: body });
        if (path === '/admin/api/session')
          return json({ user: { username: 'qa', role, branchIds: [], actions: ['*'] } });
        if (path === '/admin/api/scope')
          return json({ success: true, locations: [], selectedBranchId: null });
        if (path === '/admin/api/iiko-dashboard/servers')
          return json({
            servers: [
              {
                id: 'aktau-chain',
                city: 'aktau',
                kind: 'chain',
                configured: true,
                active: true,
                host: 'aktau.example.com',
              },
            ],
          });
        if (path === '/admin/api/iiko-dashboard/departments')
          return json({
            serverId: 'aktau-chain',
            departments: [
              { id: 'workshop', name: initialPoint },
              { id: 'point-16', name: nextPoint },
            ],
          });
        if (path === '/admin/api/iiko-dashboard/analytics') {
          const query = route.request().postDataJSON() as AnalyticsQuery;
          requests.push(query);
          const currentGate = gate;
          gate = undefined;
          if (currentGate) {
            currentGate.received(query);
            await currentGate.release;
          }
          return json({
            serverId: 'aktau-chain',
            fetchedAt: '2026-10-03T08:00:00Z',
            columns: {},
            rows: fixture(locale, suffixFor(query)),
          });
        }
        if (path === '/admin/api/events')
          return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
        return route.fulfill({ status: 404, json: {} });
      });
      await page.goto(
        `/admin/iiko-dashboard?tab=topDishes&server=aktau-chain&from=${from}&to=${to}&department=${encodeURIComponent(initialPoint)}`,
      );
      const nav = page.getByRole('navigation', { name: 'Dashboard', exact: true });
      await expect(nav).toBeVisible();
      await expect(
        nav.getByRole('button', { name: labels[locale].title, exact: true }),
      ).toHaveAttribute('aria-current', 'page');
      if (role === 'iiko_dashboard')
        await expect(
          nav.getByRole('button', { name: labels[locale].settings, exact: true }),
        ).toHaveCount(0);
      const report = page.getByRole('region', { name: labels[locale].title, exact: true });
      const items = report.locator('ol.id-top-dishes-list li');
      const names = report.locator('.id-top-dishes-product strong');
      const quantities = report.locator('.id-top-dishes-quantity strong');
      await expect(items).toHaveCount(10);
      await expect(names).toHaveText(expectedNames(locale));
      // Chromium and Node can ship different CLDR versions for Kazakh decimal
      // separators. Use the actual browser's locale formatter for display text.
      const formattedQuantities = await page.evaluate(
        ({ locale, values }) =>
          values.map((quantity) =>
            new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'kk-KZ', {
              maximumFractionDigits: 6,
            }).format(quantity),
          ),
        { locale, values: expectedQuantities },
      );
      await expect(quantities).toHaveText(formattedQuantities);
      await expect(report.locator('.id-top-dishes-unit')).toHaveText(expectedUnits);
      await expect(report.locator('.id-top-dishes-rank')).toHaveText(
        Array.from({ length: 10 }, (_, index) => String(index + 1)),
      );
      expect(requests[0]).toEqual({
        view: 'products',
        serverId: 'aktau-chain',
        from,
        to,
        department: initialPoint,
      });
      const point = page.getByRole('combobox', { name: labels[locale].point, exact: true });
      await expect(point).toHaveValue(initialPoint);
      await expect(point.getByRole('option', { name: initialPoint, exact: true })).toHaveCount(1);
      await expect(point.getByRole('option', { name: nextPoint, exact: true })).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready);
      await assertReadable(page, report, locale);
      await page.screenshot({ path: testInfo.outputPath('top-dishes.png'), fullPage: true });

      const refreshGate = gateNextReport();
      try {
        await page.getByRole('button', { name: labels[locale].refresh, exact: true }).click();
        expect(await refreshGate.requested).toEqual(requests[0]);
        await expect(report).toHaveAttribute('aria-busy', 'true');
        await expect(items).toHaveCount(10);
        await expect(names).toHaveText(expectedNames(locale));
      } finally {
        refreshGate.release();
      }
      await expect(report).toHaveAttribute('aria-busy', 'false');

      const pointGate = gateNextReport();
      try {
        await point.selectOption(nextPoint);
        const query = await pointGate.requested;
        expect(query).toEqual({
          view: 'products',
          serverId: 'aktau-chain',
          from,
          to,
          department: nextPoint,
        });
        await expect(report).toHaveAttribute('aria-busy', 'true');
        await expect(items).toHaveCount(0);
        await expect(report.getByText(firstName(locale), { exact: true })).toHaveCount(0);
      } finally {
        pointGate.release();
      }
      await expect(items).toHaveCount(10);
      await expect(names.first()).toHaveText(firstName(locale) + suffixFor(requests.at(-1)!));

      await page.locator('.id-period-disclosure > summary').click();
      await page.getByRole('button', { name: labels[locale].choosePeriod, exact: true }).click();
      const beforeDateRequests = requests.length;
      await page.locator('.id-calendar-days button[data-date="2026-09-02"]').click();
      expect(new URL(page.url()).searchParams.get('from')).toBe(from);
      expect(requests).toHaveLength(beforeDateRequests);
      await expect(items).toHaveCount(10);
      await expect(page.locator('.id-calendar')).toBeVisible();
      const beforeDateName = await names.first().textContent();
      const dateGate = gateNextReport();
      try {
        await page.locator('.id-calendar-days button[data-date="2026-09-10"]').click();
        const query = await dateGate.requested;
        expect(query).toEqual({
          view: 'products',
          serverId: 'aktau-chain',
          from: '2026-09-02',
          to: '2026-09-10',
          department: nextPoint,
        });
        await expect(report).toHaveAttribute('aria-busy', 'true');
        await expect(items).toHaveCount(0);
        await expect(report.getByText(beforeDateName!, { exact: true })).toHaveCount(0);
        await expect(page.locator('.id-calendar')).toHaveCount(0);
        await expect(page.locator('.id-period-disclosure')).toHaveJSProperty('open', false);
      } finally {
        dateGate.release();
      }
      await expect(items).toHaveCount(10);
      await expect(names.first()).toHaveText(firstName(locale) + suffixFor(requests.at(-1)!));
      await expect(report).toHaveAttribute('aria-busy', 'false');
      expect(new URL(page.url()).searchParams.get('department')).toBe(nextPoint);
      expect(new URL(page.url()).searchParams.get('from')).toBe('2026-09-02');
      expect(new URL(page.url()).searchParams.get('to')).toBe('2026-09-10');
      expect(requests).toHaveLength(4);

      const presetDates = [
        ['2026-10-03', '2026-10-03'],
        ['2026-10-02', '2026-10-02'],
        ['2026-09-27', '2026-10-03'],
        ['2026-10-01', '2026-10-03'],
      ];
      for (const [index, preset] of labels[locale].presets.entries()) {
        await page.locator('.id-period-disclosure > summary').click();
        const presetGate = gateNextReport();
        try {
          await page
            .locator('.id-presets')
            .getByRole('button', { name: preset, exact: true })
            .click();
          expect(await presetGate.requested).toEqual({
            view: 'products',
            serverId: 'aktau-chain',
            from: presetDates[index][0],
            to: presetDates[index][1],
            department: nextPoint,
          });
          await expect(page.locator('.id-period-disclosure')).toHaveJSProperty('open', false);
          await expect(report).toHaveAttribute('aria-busy', 'true');
          await expect(items).toHaveCount(0);
        } finally {
          presetGate.release();
        }
        await expect(items).toHaveCount(10);
        await expect(report).toHaveAttribute('aria-busy', 'false');
      }
      expect(requests).toHaveLength(8);

      if (width === 320) {
        // Reload between sizes so inherited font sizes are never compounded.
        for (const factor of [1.5, 2]) {
          await page.reload();
          await expect(items).toHaveCount(10);
          await page.evaluate(() => document.fonts.ready);
          await scaleText(page, factor);
          await assertReadable(page, report, locale);
          await page.screenshot({
            path: testInfo.outputPath(`top-dishes-text-${factor}.png`),
            fullPage: true,
          });
        }
      }
      expect(errors).toEqual([]);
    });
  }
}
