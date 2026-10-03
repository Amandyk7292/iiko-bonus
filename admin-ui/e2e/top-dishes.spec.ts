import { expect, test, type Locator, type Page } from '@playwright/test';

type Locale = 'ru' | 'kk';
type AnalyticsQuery = {
  view: string;
  serverId: string;
  from: string;
  to: string;
  department: string;
};

const from = '2026-09-01';
const to = '2026-09-15';
const initialPoint = 'Основной цех';
const nextPoint = 'Bulka 16 мкр 85 дом';
const labels = {
  ru: {
    title: 'Топ блюд',
    point: 'Точка',
    choosePeriod: 'Выбрать период',
    apply: 'Применить',
    settings: 'Настройки',
  },
  kk: {
    title: 'Үздік тағамдар',
    point: 'Нүкте',
    choosePeriod: 'Кезеңді таңдау',
    apply: 'Қолдану',
    settings: 'Баптаулар',
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
    const elements = [...document.querySelectorAll<HTMLElement>('.id-dashboard, .id-dashboard *')];
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
      await page.locator('.id-calendar-days button[data-date="2026-09-02"]').click();
      await page.locator('.id-calendar-days button[data-date="2026-09-10"]').click();
      const beforeDateName = await names.first().textContent();
      const dateGate = gateNextReport();
      try {
        await page.getByRole('button', { name: labels[locale].apply, exact: true }).click();
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
      } finally {
        dateGate.release();
      }
      await expect(items).toHaveCount(10);
      await expect(names.first()).toHaveText(firstName(locale) + suffixFor(requests.at(-1)!));
      await expect(report).toHaveAttribute('aria-busy', 'false');
      expect(new URL(page.url()).searchParams.get('department')).toBe(nextPoint);
      expect(new URL(page.url()).searchParams.get('from')).toBe('2026-09-02');
      expect(new URL(page.url()).searchParams.get('to')).toBe('2026-09-10');
      expect(requests).toHaveLength(3);

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
