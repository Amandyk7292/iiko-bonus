import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { FeedbackProvider } from '../components/Feedback';
import { api } from '../lib/api';
import BonusPage from './BonusPage';
import { BrowserRouter } from '../lib/router';

it('loads and saves both referral rewards through the existing settings API', async () => {
  localStorage.setItem('adminLocale', 'ru');
  window.history.replaceState({}, '', '/bonus');
  const get = vi.spyOn(api, 'getSettings').mockResolvedValue({
    bonus_referral: {
      enabled: true,
      inviter_bonus: 1000,
      friend_bonus: 500,
      min_first_order: 0,
    },
  });
  const save = vi.spyOn(api, 'updateSettings').mockResolvedValue({ success: true });
  try {
    render(
      <I18nProvider>
        <FeedbackProvider>
          <BrowserRouter>
            <BonusPage />
          </BrowserRouter>
        </FeedbackProvider>
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки' }));
    const inviter = await screen.findByLabelText('Пригласившему, ₸ бонусами');
    expect(inviter).toHaveValue(1000);
    expect(screen.getByLabelText('Новому клиенту, ₸ бонусами')).toHaveValue(500);
    expect(screen.queryByText('Приглашений в день на клиента')).not.toBeInTheDocument();
    const terms = screen.getByText('Условия программы').closest('details');
    expect(terms).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Условия программы'));
    expect(terms).toHaveAttribute('open');
    expect(screen.getByText(/Приглашения и реферальные награды — без/)).toBeVisible();
    fireEvent.change(inviter, { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        bonus_referral: {
          enabled: true,
          inviter_bonus: 1500,
          friend_bonus: 500,
          min_first_order: 0,
          max_invites_per_day: 0,
          max_rewards_per_month: 0,
          max_reward_amount_per_month: 0,
          review_same_device: true,
        },
      }),
    );
  } finally {
    get.mockRestore();
    save.mockRestore();
  }
});
