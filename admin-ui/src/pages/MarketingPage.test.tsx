import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { BrowserRouter } from '../lib/router';
import { I18nProvider } from '../lib/i18n';
import MarketingPage from './MarketingPage';

const api = vi.hoisted(() => ({
  getPromotions: vi.fn(),
  getGiftCards: vi.fn(),
  getAutomations: vi.fn(),
  createPromotion: vi.fn(),
  updatePromotion: vi.fn(),
}));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../components/Feedback', () => ({ useFeedback: () => ({ toast: vi.fn() }) }));
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  localStorage.setItem('adminLocale', 'ru');
  window.history.replaceState({}, '', '/admin/marketing');
  vi.clearAllMocks();
  api.getPromotions.mockResolvedValue({ promotions: [] });
  api.getGiftCards.mockResolvedValue({ giftCards: [] });
  api.getAutomations.mockResolvedValue({ automations: [] });
  api.createPromotion.mockResolvedValue({ success: true });
});

it('creates a free delivery promotion without a fake goods discount or extra required fields', async () => {
  const user = userEvent.setup();
  render(
    <BrowserRouter basename="/admin">
      <I18nProvider>
        <MarketingPage />
      </I18nProvider>
    </BrowserRouter>,
  );
  await user.click(await screen.findByRole('button', { name: 'Создать' }));
  expect(screen.getByText('Дополнительные условия').closest('details')).not.toHaveAttribute('open');
  await user.type(screen.getByRole('textbox', { name: 'Код' }), 'delivery');
  await user.click(screen.getByRole('combobox', { name: 'Тип промокода' }));
  await user.click(screen.getByRole('option', { name: 'Бесплатная доставка' }));
  expect(screen.queryByRole('spinbutton', { name: /Скидка/ })).not.toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent('Покупатель не платит за доставку');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() =>
    expect(api.createPromotion).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'DELIVERY',
        discountType: 'free_delivery',
        discountValue: 0,
        maxDiscount: null,
        minOrder: 0,
        perCustomerLimit: 1,
        customerIds: [],
        customerTags: [],
      }),
    ),
  );
});
