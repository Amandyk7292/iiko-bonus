import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../components/Feedback';
import type { TaplinkAdminPage, TaplinkAdminResponse, TaplinkDocument } from '../lib/api-types';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';

const apiMocks = vi.hoisted(() => ({
  getTaplink: vi.fn(),
  saveTaplinkDraft: vi.fn(),
  publishTaplink: vi.fn(),
}));

vi.mock('../lib/api', () => {
  class ApiError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return { ApiError, api: apiMocks };
});

import TaplinkPage from './TaplinkPage';

const sampleDocument = (): TaplinkDocument => ({
  schemaVersion: 1,
  defaultLocale: 'kk',
  enabledLocales: ['kk', 'ru'],
  profile: {
    title: { kk: 'Bulka жаныңызда', ru: 'Bulka рядом' },
    description: { kk: 'Күн сайын балғын', ru: 'Свежая выпечка каждый день' },
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
    radius: 20,
  },
  blocks: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'link',
      enabled: true,
      style: 'primary',
      labels: { kk: 'Жеткізу', ru: 'Заказать доставку' },
      subtitles: { kk: '+7 701 277 22 33', ru: '+7 701 277 22 33' },
      ariaLabels: { kk: 'Жеткізуге тапсырыс', ru: 'Заказать доставку' },
      icon: 'whatsapp',
      target: { type: 'whatsapp', value: '77012772233' },
    },
  ],
});

const pageWith = (
  draft = sampleDocument(),
  overrides: Partial<TaplinkAdminPage> = {},
): TaplinkAdminPage => ({
  slug: 'main',
  draft,
  published: sampleDocument(),
  draftRevision: 3,
  publishedRevision: 2,
  updatedAt: '2026-08-07T10:00:00.000Z',
  updatedBy: 'owner',
  publishedAt: '2026-08-07T09:00:00.000Z',
  publishedBy: 'owner',
  ...overrides,
});

const response = (page: TaplinkAdminPage): TaplinkAdminResponse => ({
  success: true,
  page,
});

const renderPage = (canPublish = true) =>
  render(
    <BrowserRouter basename="/admin">
      <I18nProvider>
        <FeedbackProvider>
          <TaplinkPage canPublish={canPublish} />
        </FeedbackProvider>
      </I18nProvider>
    </BrowserRouter>,
  );

describe('TaplinkPage', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('adminLocale', 'ru');
    window.history.replaceState({}, '', '/admin/taplink');
    apiMocks.getTaplink.mockReset().mockResolvedValue(response(pageWith()));
    apiMocks.saveTaplinkDraft
      .mockReset()
      .mockImplementation((config: TaplinkDocument) =>
        Promise.resolve(response(pageWith(config, { draftRevision: 4 }))),
      );
    apiMocks.publishTaplink
      .mockReset()
      .mockResolvedValue(
        response(pageWith(sampleDocument(), { draftRevision: 4, publishedRevision: 4 })),
      );
  });

  it('updates the phone preview immediately and saves the explicit draft', async () => {
    const user = userEvent.setup();
    renderPage();

    const title = await screen.findByLabelText('Главный заголовок · Казахский');
    await user.clear(title);
    await user.type(title, 'Жаңа Bulka');

    expect(
      within(screen.getByTestId('taplink-live-preview')).getByRole('heading', {
        name: 'Жаңа Bulka',
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }));

    await waitFor(() => expect(apiMocks.saveTaplinkDraft).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveTaplinkDraft.mock.calls[0][0].profile.title.kk).toBe('Жаңа Bulka');
    expect(apiMocks.saveTaplinkDraft.mock.calls[0][1]).toBe(3);
  });

  it('previews and saves custom background colors, animation, and button effect', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('radio', { name: 'Градиент' }));
    const gradientFrom = screen.getByLabelText('Начальный цвет');
    await user.clear(gradientFrom);
    await user.type(gradientFrom, '#224466');
    await user.selectOptions(screen.getByLabelText('Появление страницы'), 'fade');
    await user.selectOptions(screen.getByLabelText('Эффект кнопок'), 'glow');

    const preview = screen.getByTestId('taplink-live-preview');
    expect(preview).toHaveClass(
      'taplink-background-gradient',
      'taplink-animation-fade',
      'taplink-effect-glow',
    );
    expect(preview.style.getPropertyValue('--taplink-preview-gradient-from')).toBe('#224466');
    expect(screen.getByTestId('taplink-contrast-status')).toBeInTheDocument();
    expect(screen.getByTestId('taplink-replay-animation')).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    await waitFor(() => expect(apiMocks.saveTaplinkDraft).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveTaplinkDraft.mock.calls[0][0].theme).toMatchObject({
      backgroundMode: 'gradient',
      gradientFrom: '#224466',
      animation: 'fade',
      buttonEffect: 'glow',
    });
  });

  it('saves dirty content before publishing the resulting revision', async () => {
    const user = userEvent.setup();
    renderPage();

    const title = await screen.findByLabelText('Главный заголовок · Казахский');
    await user.clear(title);
    await user.type(title, 'Жарияланатын Bulka');
    await user.click(screen.getByRole('button', { name: 'Опубликовать' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Опубликовать',
      }),
    );

    await waitFor(() => expect(apiMocks.publishTaplink).toHaveBeenCalledWith(4));
    expect(apiMocks.saveTaplinkDraft).toHaveBeenCalledTimes(1);
  });

  it('shows a recoverable conflict instead of overwriting another draft', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('../lib/api');
    apiMocks.saveTaplinkDraft.mockRejectedValueOnce(
      new ApiError('Conflict', 409, 'TAPLINK_VERSION_CONFLICT'),
    );
    renderPage();

    const title = await screen.findByLabelText('Главный заголовок · Казахский');
    await user.type(title, '!');
    await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }));

    expect(
      await screen.findByRole('button', { name: 'Загрузить актуальную версию' }),
    ).toBeEnabled();
  });

  it('keeps global publishing owner-only while allowing draft editing', async () => {
    const user = userEvent.setup();
    renderPage(false);

    await user.type(await screen.findByLabelText('Главный заголовок · Казахский'), '!');
    expect(screen.getByRole('button', { name: 'Сохранить черновик' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toHaveAttribute(
      'title',
      'Публикация доступна только владельцу',
    );
  });
});
