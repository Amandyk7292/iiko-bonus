import { expect, test, type Page } from '@playwright/test';

const widths = [320, 375, 768, 1440];
const words = { ru: 'Сливочнокарамельный', kk: 'Сүттікарамельді' };
const summary = {
  DishDiscountSumInt: 999999.9,
  UniqOrderId: 1,
  DiscountSum: -999999.9,
};

async function scaleText(page: Page, factor: number) {
  // Simulate larger text without shrinking it or zooming the whole interface.
  // Capture sizes first so inherited font sizes are scaled exactly once.
  await page.evaluate((factor) => {
    const elements = [...document.querySelectorAll<HTMLElement>('.id-dashboard, .id-dashboard *')];
    const sizes = elements.map((element) => parseFloat(getComputedStyle(element).fontSize));
    document.documentElement.style.fontSize = `${16 * factor}px`;
    elements.forEach((element, index) => {
      element.style.fontSize = `${sizes[index] * factor}px`;
    });
  }, factor);
  await page.addStyleTag({
    content: `.id-dashboard .id-table td::before { font-size: ${12 * factor}px; }`,
  });
}

for (const width of widths) {
  for (const locale of ['ru', 'kk'] as const) {
    test(`iiko text stays readable at ${width}px in ${locale}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((locale) => {
        localStorage.setItem('adminLocale', locale);
        localStorage.setItem(
          'bulka-iiko-dashboard-v1',
          JSON.stringify({
            cards: ['revenue', 'checks', 'average', 'discount'],
            templates: [],
            auto: false,
          }),
        );
      }, locale);
      await page.route('**/admin/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = (body: unknown) => route.fulfill({ status: 200, json: body });
        if (path === '/admin/api/session')
          return json({
            user: { username: 'owner', role: 'owner', branchIds: [], actions: ['*'] },
          });
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
          return json({ serverId: 'aktau-chain', departments: [] });
        const report = { serverId: 'aktau-chain', fetchedAt: '2026-10-03T08:00:00Z' };
        if (path === '/admin/api/iiko-dashboard/report') {
          const query = route.request().postDataJSON();
          return json({
            ...report,
            columns: { DishDiscountSumInt: { name: 'Выручка', type: 'MONEY' } },
            rows: [
              {
                ...summary,
                ...(query.groupBy.includes('OpenDate.Typed')
                  ? { 'OpenDate.Typed': '2026-10-02' }
                  : {}),
              },
            ],
          });
        }
        if (path === '/admin/api/iiko-dashboard/analytics')
          return json({
            ...report,
            columns: {
              DishName: { name: 'Товар', type: 'STRING' },
              DishDiscountSumInt: { name: 'Выручка', type: 'MONEY' },
            },
            rows: [
              {
                DishName: `Круассан ${words[locale]}`,
                DishDiscountSumInt: 999999.99,
              },
            ],
          });
        if (path === '/admin/api/events')
          return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
        return route.fulfill({ status: 404, json: {} });
      });

      for (const scale of [1, 1.5, 2]) {
        const query = 'server=aktau-chain&from=2026-10-01&to=2026-10-02&comparison=none';
        await page.goto(`/admin/iiko-dashboard?tab=overview&${query}`);
        const amounts = page.locator('.id-metric strong');
        await expect(amounts).toHaveCount(4);
        await page.evaluate(() => document.fonts.ready);
        if (scale !== 1) await scaleText(page, scale);
        const metrics = await amounts.evaluateAll((elements) =>
          elements.map((element) => {
            const card = element.closest('.id-metric')!;
            const box = card.getBoundingClientRect();
            const style = getComputedStyle(card);
            const range = document.createRange();
            range.selectNodeContents(element);
            const rects = [...range.getClientRects()];
            range.selectNodeContents(card.querySelector('.id-metric-label > span')!);
            rects.push(...range.getClientRects());
            return {
              text: element.textContent,
              fits: rects.every(
                (rect) =>
                  rect.left >= box.left + parseFloat(style.paddingLeft) - 1 &&
                  rect.right <= box.right - parseFloat(style.paddingRight) + 1,
              ),
            };
          }),
        );
        expect(
          metrics.every((metric) => metric.fits),
          JSON.stringify(metrics),
        ).toBe(true);
        expect(metrics[0].text).toContain('₸');
        expect(metrics[3].text).toContain('-');
        await page
          .locator('.id-metric-grid')
          .screenshot({ path: testInfo.outputPath(`metrics-${scale}.png`) });

        await page.goto(`/admin/iiko-dashboard?tab=rankings&${query}`);
        const value = page.locator('.id-table td[data-field="DishName"] > span');
        await expect(value).toHaveText(`Круассан ${words[locale]}`);
        await page.evaluate(() => document.fonts.ready);
        if (scale !== 1) await scaleText(page, scale);
        const word = await value.evaluate((element, word) => {
          const node = element.firstChild!;
          const start = node.textContent!.indexOf(word);
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + word.length);
          const rects = [...range.getClientRects()];
          const box = element.getBoundingClientRect();
          const fits = rects.every(
            (rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1,
          );
          // An unusually long word at large text size can scroll within its value;
          // it must never be split or lost behind a clipped card/page.
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
        }, words[locale]);
        expect(word.lines).toBe(1);
        if (scale === 1) expect(word.fits).toBe(true);
        else expect(word.fits || (word.overflow === 'auto' && word.endReachable)).toBe(true);
        const number = page.locator('.id-table td[data-field="DishDiscountSumInt"] > span');
        expect(
          await number.evaluate((element) => {
            const box = element.closest('td')!.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(element);
            return [...range.getClientRects()].every(
              (rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1,
            );
          }),
        ).toBe(true);
        const controls = await page
          .locator('.id-table-tools > span, .id-columns > summary, .id-table td > button')
          .evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
              const rects: DOMRect[] = [];
              while (walker.nextNode()) {
                const range = document.createRange();
                range.selectNodeContents(walker.currentNode);
                rects.push(
                  ...[...range.getClientRects()].filter(
                    (rect) => rect.width > 0 && rect.height > 0,
                  ),
                );
              }
              return {
                text: element.textContent,
                box: { left: box.left, right: box.right },
                rects: rects.map((rect) => ({ left: rect.left, right: rect.right })),
                fits: rects.every(
                  (rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1,
                ),
              };
            }),
          );
        expect(
          controls.every((control) => control.fits),
          JSON.stringify(controls),
        ).toBe(true);
        await page
          .locator('.id-table-section')
          .screenshot({ path: testInfo.outputPath(`table-${scale}.png`) });
      }
    });
  }
}
