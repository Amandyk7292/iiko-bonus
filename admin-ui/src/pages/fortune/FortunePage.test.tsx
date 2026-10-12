import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import { BrowserRouter } from '../../lib/router';
import FortunePage from './FortunePage';
import CampaignEditor from './CampaignEditor';
import WinnersPanel from './WinnersPanel';
import {
  campaignInput,
  newCampaign,
  validationMessage,
  type Campaign,
  type Dashboard,
  type Winner,
} from './model';

const mocks = vi.hoisted(() => ({
  loadFortune: vi.fn(),
  saveCampaign: vi.fn(),
  loadWinners: vi.fn(),
  redeemWinner: vi.fn(),
  loadQr: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('./api', () => ({
  loadFortune: mocks.loadFortune,
  saveCampaign: mocks.saveCampaign,
  loadWinners: mocks.loadWinners,
  redeemWinner: mocks.redeemWinner,
  loadQr: mocks.loadQr,
}));
vi.mock('../../components/Feedback', () => ({
  useFeedback: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));
const text = (ru: string) => ru;
const branch = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '19а ЖК Жасыл дала',
  city: 'Актау',
  address: '19а/3',
  active: true,
};
const campaign = (): Campaign => ({
  ...newCampaign(text),
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Подарки октября',
  branchIds: [branch.id],
  version: 3,
  createdAt: '2026-10-11T00:00:00Z',
  updatedAt: '2026-10-11T00:00:00Z',
});
const dashboard = (): Dashboard => ({ campaigns: [campaign()], branches: [branch] });
const winner = (
  status: Winner['status'] = 'claimed',
  prizeKind: Winner['prizeKind'] = 'gift',
): Winner => ({
  id: '33333333-3333-4333-8333-333333333333',
  campaignId: campaign().id,
  branchId: branch.id,
  branchName: branch.name,
  prizeLabel: 'Круассан',
  prizeKind,
  status,
  wonAt: '2026-10-11T08:00:00Z',
  expiresAt: '2026-10-18T08:00:00Z',
  customerName: 'Алия',
  receiptNumber: '387',
  receiptTotal: 3007.5,
});
function wrap(children: React.ReactNode) {
  return render(
    <BrowserRouter basename="/admin">
      <I18nProvider>{children}</I18nProvider>
    </BrowserRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('adminLocale', 'ru');
  window.history.replaceState({}, '', '/admin/fortune');
  mocks.loadFortune.mockResolvedValue(dashboard());
  mocks.saveCampaign.mockResolvedValue({ campaign: campaign() });
  mocks.confirm.mockResolvedValue(true);
  mocks.loadWinners.mockResolvedValue({ items: [winner()], page: 1, total: 1 });
  mocks.redeemWinner.mockResolvedValue({ winner: winner('redeemed') });
});

describe('Fortune administration', () => {
  it('only loads campaign controls for owner/admin', async () => {
    wrap(<FortunePage role="viewer" />);
    expect(screen.getByText('Раздел доступен администратору')).toBeInTheDocument();
    expect(mocks.loadFortune).not.toHaveBeenCalled();
  });
  it('shows campaigns, branches and prize QR action without exposing edit fields upfront', async () => {
    const user = userEvent.setup();
    wrap(<FortunePage role="admin" />);
    expect(await screen.findByRole('heading', { name: 'Подарки октября' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'QR филиалов' })).toBeEnabled();
    expect(screen.queryByLabelText('Вероятность, %')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Настройки' }));
    const dialog = screen.getByRole('dialog', { name: 'Настройки рулетки' });
    expect(within(dialog).getByLabelText('Название акции')).toHaveValue('Подарки октября');
    expect(within(dialog).getAllByLabelText('Вероятность, %')).toHaveLength(3);
  });
  it('offers a clear first campaign and creates it as a draft', async () => {
    mocks.loadFortune.mockResolvedValue({ campaigns: [], branches: [branch] });
    const user = userEvent.setup();
    wrap(<FortunePage role="owner" />);
    expect(await screen.findByRole('heading', { name: 'Ваша первая рулетка' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Создать рулетку' }));
    expect(screen.getByLabelText('Статус')).toHaveValue('draft');
    expect(screen.getByText('100 / 100%')).toBeInTheDocument();
  });
  it('saves an edited campaign with revision and without writable issued counters', async () => {
    const onSaved = vi.fn(),
      current = campaign();
    const user = userEvent.setup();
    wrap(
      <CampaignEditor campaign={current} branches={[branch]} onClose={vi.fn()} onSaved={onSaved} />,
    );
    await user.clear(screen.getByLabelText('Название акции'));
    await user.type(screen.getByLabelText('Название акции'), 'Новая акция');
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const payload = mocks.saveCampaign.mock.calls[0][1];
    expect(payload).toMatchObject({
      title: 'Новая акция',
      expectedVersion: 3,
      status: 'draft',
      branchIds: [branch.id],
    });
    expect(payload.prizes).toHaveLength(3);
    expect(payload.prizes[0]).not.toHaveProperty('issuedCount');
  });
  it('retains draft and shows backend activation errors', async () => {
    mocks.saveCampaign.mockRejectedValue(new Error('Фискальная проверка пока недоступна.'));
    const onSaved = vi.fn(),
      user = userEvent.setup();
    wrap(
      <CampaignEditor
        campaign={campaign()}
        branches={[branch]}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    await user.selectOptions(screen.getByLabelText('Статус'), 'active');
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Фискальная проверка пока недоступна.',
    );
    expect(screen.getByLabelText('Статус')).toHaveValue('active');
    expect(onSaved).not.toHaveBeenCalled();
  });
  it('blocks activation with invalid probability sum', async () => {
    const user = userEvent.setup();
    wrap(
      <CampaignEditor
        campaign={campaign()}
        branches={[branch]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await user.selectOptions(screen.getByLabelText('Статус'), 'active');
    fireEvent.change(screen.getAllByLabelText('Вероятность, %')[0], { target: { value: '20' } });
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    expect(screen.getByRole('alert')).toHaveTextContent('100%');
    expect(mocks.saveCampaign).not.toHaveBeenCalled();
  });
  it('preserves issued prize records and exposes expiry/cap controls', () => {
    const current = campaign();
    current.prizes[0].issuedCount = 2;
    wrap(
      <CampaignEditor campaign={current} branches={[branch]} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Удалить сектор 1' })).toBeDisabled();
    expect(screen.getAllByLabelText('Всего призов')[0]).toHaveAttribute('min', '2');
    expect(screen.getAllByLabelText('Срок получения, дней')[0]).toHaveValue(7);
  });
  it('redeems only claimed gift prizes with staff confirmation', async () => {
    const user = userEvent.setup();
    wrap(<WinnersPanel campaign={campaign()} onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Выдать приз' }));
    await waitFor(() => expect(mocks.redeemWinner).toHaveBeenCalledWith(winner().id));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Выдать приз?' }));
  });
  it.each([
    ['pending', 'gift'],
    ['claimed', 'bonus'],
    ['redeemed', 'gift'],
  ] as const)('does not allow staff redemption for %s %s', async (status, kind) => {
    mocks.loadWinners.mockResolvedValue({ items: [winner(status, kind)], page: 1, total: 1 });
    wrap(<WinnersPanel campaign={campaign()} onClose={vi.fn()} />);
    await screen.findByText('Круассан');
    expect(screen.queryByRole('button', { name: 'Выдать приз' })).not.toBeInTheDocument();
  });
  it('rejects missing branches and missing fallback before launch', () => {
    const current = campaign();
    current.branchIds = [];
    expect(validationMessage(current, text)).toContain('филиал');
    current.branchIds = [branch.id];
    current.status = 'active';
    current.prizes[2].kind = 'gift';
    expect(validationMessage(current, text)).toContain('без приза');
    current.prizes[2].kind = 'none';
    current.prizes[2].stockLimit = 5;
    expect(campaignInput(current).prizes[2].stockLimit).toBeNull();
  });
});
