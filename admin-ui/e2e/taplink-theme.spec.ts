import { expect, test } from '@playwright/test';
import type { TaplinkDocument } from '../src/lib/api-types';

const documentConfig = (): TaplinkDocument => ({
  schemaVersion: 1,
  defaultLocale: 'kk',
  enabledLocales: ['kk', 'ru'],
  profile: {
    title: { kk: 'Bulka жаныңызда', ru: 'Bulka рядом' },
    description: {
      kk: 'Күн сайын балғын пісірме',
      ru: 'Свежая выпечка каждый день',
    },
    footer: { kk: 'Bulka наубайханасы', ru: 'Семейная пекарня Bulka' },
    logoUrl: '/taplink/assets/brand/bulka_logo.png',
  },
  seo: {
    title: { kk: 'Bulka жеткізу', ru: 'Доставка Bulka' },
    description: { kk: 'Жеткізу және мекенжайлар', ru: 'Доставка и адреса' },
  },
  theme: {
    preset: 'bulka',
    backgroundMode: 'brand',
    backgroundColor: '#FFB814',
    gradientFrom: '#FFD56A',
    gradientTo: '#F4A916',
    gradientDirection: 'bottom-right',
    backgroundImageUrl: '/taplink/assets/mobile-background.png?v=20260806-1',
    backgroundOverlayColor: '#532814',
    backgroundOverlayOpacity: 0,
    textColor: '#532814',
    mutedTextColor: '#78665D',
    surfaceColor: '#FFFFFF',
    buttonBackgroundColor: '#FFFFFF',
    buttonTextColor: '#532814',
    primaryButtonBackgroundColor: '#FFB814',
    primaryButtonTextColor: '#3F1D0E',
    buttonStyle: 'soft',
    animation: 'stagger',
    buttonEffect: 'shine',
    radius: 22,
  },
  blocks: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'link',
      enabled: true,
      style: 'primary',
      labels: { kk: 'Жеткізуге тапсырыс беру', ru: 'Заказать доставку' },
      subtitles: { kk: '+7 701 277 22 33', ru: '+7 701 277 22 33' },
      ariaLabels: { kk: 'Жеткізуге тапсырыс беру', ru: 'Заказать доставку' },
      icon: 'phone',
      target: { type: 'whatsapp', value: '77012772233' },
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      type: 'section',
      enabled: true,
      labels: { kk: 'Біздің филиалдар', ru: 'Наши филиалы' },
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      type: 'link',
      enabled: true,
      style: 'city',
      labels: { kk: 'Bulka Ақтауда', ru: 'Bulka в Актау' },
      subtitles: { kk: 'Мекенжайлар', ru: 'Адреса и маршруты' },
      ariaLabels: { kk: 'Ақтаудағы Bulka', ru: 'Открыть Bulka в Актау' },
      icon: '2gis',
      target: { type: 'url', value: 'https://2gis.kz/aktau' },
    },
  ],
});

test('owner customizes a professional Taplink theme with a live preview', async ({
  page,
}, testInfo) => {
  let draft = documentConfig();
  let draftRevision = 3;
  let savedConfig: TaplinkDocument | null = null;

  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === '/admin/api/session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'owner', role: 'owner', branchIds: [] } }),
      });
    }
    if (url.pathname === '/admin/api/scope') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, locations: [], selectedBranchId: null }),
      });
    }
    if (url.pathname === '/admin/api/taplink' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          page: {
            slug: 'main',
            draft,
            published: documentConfig(),
            draftRevision,
            publishedRevision: 2,
            updatedAt: '2026-08-07T10:00:00.000Z',
            updatedBy: 'owner',
            publishedAt: '2026-08-07T09:00:00.000Z',
            publishedBy: 'owner',
          },
        }),
      });
    }
    if (url.pathname === '/admin/api/taplink/draft' && method === 'PUT') {
      const body = request.postDataJSON() as {
        config: TaplinkDocument;
        expectedRevision: number;
      };
      savedConfig = body.config;
      draft = body.config;
      draftRevision = body.expectedRevision + 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          page: {
            slug: 'main',
            draft,
            published: documentConfig(),
            draftRevision,
            publishedRevision: 2,
            updatedAt: '2026-08-07T10:10:00.000Z',
            updatedBy: 'owner',
            publishedAt: '2026-08-07T09:00:00.000Z',
            publishedBy: 'owner',
          },
        }),
      });
    }
    if (url.pathname === '/admin/api/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: `not mocked: ${method} ${url.pathname}` }),
    });
  });

  await page.goto('/admin/taplink');
  await expect(page.getByTestId('taplink-theme-editor')).toBeVisible();

  await page.getByRole('radio', { name: 'Градиент' }).check();
  await page.getByLabel('Начальный цвет', { exact: true }).fill('#214A3A');
  await page.getByLabel('Конечный цвет', { exact: true }).fill('#F2C14E');
  await page.getByLabel('Направление градиента').selectOption('top-right');
  const overlayOpacity = page.getByLabel(/Плотность затемнения/);
  await overlayOpacity.press('Home');
  for (let step = 0; step < 12; step += 1) {
    await overlayOpacity.press('ArrowRight');
  }
  await page.getByLabel('Появление страницы').selectOption('fade');
  await page.getByLabel('Эффект кнопок').selectOption('glow');

  const preview = page.getByTestId('taplink-live-preview');
  await expect(preview).toHaveClass(/taplink-background-gradient/);
  await expect(preview).toHaveClass(/taplink-animation-fade/);
  await expect(preview).toHaveClass(/taplink-effect-glow/);
  await expect(preview).toHaveCSS('background-color', 'rgb(255, 184, 20)');
  expect(await preview.evaluate((element) => element.getAttribute('style'))).toContain('#214A3A');
  await expect(page.getByTestId('taplink-contrast-status')).toContainText('WCAG AA');

  await page.getByTestId('taplink-replay-animation').click();
  await page.getByRole('button', { name: 'Сохранить черновик' }).click();

  await expect
    .poll(() => savedConfig?.theme.backgroundMode)
    .toBe('gradient');
  expect(savedConfig?.theme).toMatchObject({
    gradientFrom: '#214A3A',
    gradientTo: '#F2C14E',
    gradientDirection: 'top-right',
    backgroundOverlayOpacity: 12,
    animation: 'fade',
    buttonEffect: 'glow',
  });

  await page.screenshot({
    path: testInfo.outputPath('taplink-theme.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
