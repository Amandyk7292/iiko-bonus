import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const conflict = () =>
  Object.assign(new Error('Настройки уже изменились. Откройте их заново'), {
    code: 'FORTUNE_VERSION_CONFLICT',
    status: 409,
  });
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
  prizes: newCampaign(text).prizes.map((prize, index) => ({
    ...prize,
    id: `44444444-4444-4444-8444-44444444444${index}`,
  })),
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
async function chooseCampaignDate(label: string, value: string) {
  fireEvent.click(screen.getByLabelText(label));
  const calendar = screen.getByRole('dialog', { name: 'Выбрать дату' });
  fireEvent.change(within(calendar).getByLabelText('Год'), { target: { value: value.slice(0, 4) } });
  fireEvent.change(within(calendar).getByLabelText('Месяц'), { target: { value: value.slice(5, 7) } });
  fireEvent.click(calendar.querySelector(`[data-date="${value.slice(0, 10)}"]`)!);
  fireEvent.change(within(calendar).getByLabelText('Время'), { target: { value: value.slice(11, 16) } });
  fireEvent.click(within(calendar).getByRole('button', { name: 'Применить' }));
  await waitFor(() => expect(calendar).not.toBeInTheDocument());
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
  it('saves campaign dates and times selected in the shared calendar as the same UTC instants', async () => {
    const onSaved = vi.fn();
    wrap(<CampaignEditor campaign={campaign()} branches={[branch]} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByText('Период акции'));
    await chooseCampaignDate('Начало', '2026-10-20T10:15');
    await chooseCampaignDate('Окончание', '2026-10-21T21:45');
    expect(screen.getByLabelText('Начало')).toHaveTextContent('20.10.2026 · 10:15');
    expect(screen.getByLabelText('Окончание')).toHaveTextContent('21.10.2026 · 21:45');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    await waitFor(() => expect(mocks.saveCampaign).toHaveBeenCalledWith(campaign().id, expect.objectContaining({
      startsAt: new Date('2026-10-20T10:15').toISOString(),
      endsAt: new Date('2026-10-21T21:45').toISOString(),
    }), expect.any(AbortSignal)));
    expect(onSaved).toHaveBeenCalledOnce();
  });
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
  it('refreshes settings at save time and preserves unrelated newer edits', async () => {
    const current = campaign(),
      latest = structuredClone(current),
      onSaved = vi.fn(),
      user = userEvent.setup();
    latest.version = 4;
    latest.prizes[0].color = '#782b0e';
    latest.prizes[0].issuedCount = 2;
    mocks.loadFortune.mockResolvedValue({ campaigns: [latest], branches: [branch] });
    wrap(
      <CampaignEditor campaign={current} branches={[branch]} onClose={vi.fn()} onSaved={onSaved} />,
    );
    expect(mocks.loadFortune).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Минимальная сумма чека, ₸'), {
      target: { value: '10' },
    });
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.loadFortune).toHaveBeenCalledOnce();
    expect(mocks.saveCampaign).toHaveBeenCalledOnce();
    const payload = mocks.saveCampaign.mock.calls[0][1];
    expect(payload).toMatchObject({ minReceiptAmount: 10, expectedVersion: 4 });
    expect(payload.prizes[0].color).toBe('#782b0e');
    expect(payload.prizes[0]).not.toHaveProperty('issuedCount');
  });
  it('retries a save race once after merging the newly fetched revision', async () => {
    const current = campaign(),
      latest = structuredClone(current),
      onSaved = vi.fn(),
      user = userEvent.setup();
    latest.version = 4;
    latest.prizes[0].color = '#d28023';
    mocks.loadFortune
      .mockResolvedValueOnce({ campaigns: [current], branches: [branch] })
      .mockResolvedValueOnce({ campaigns: [latest], branches: [branch] });
    mocks.saveCampaign
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce({ campaign: latest });
    wrap(
      <CampaignEditor campaign={current} branches={[branch]} onClose={vi.fn()} onSaved={onSaved} />,
    );
    fireEvent.change(screen.getByLabelText('Минимальная сумма чека, ₸'), {
      target: { value: '10' },
    });
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.loadFortune).toHaveBeenCalledTimes(2);
    expect(mocks.saveCampaign).toHaveBeenCalledTimes(2);
    expect(mocks.saveCampaign.mock.calls[0][1]).toMatchObject({
      minReceiptAmount: 10,
      expectedVersion: 3,
    });
    expect(mocks.saveCampaign.mock.calls[1][1]).toMatchObject({
      minReceiptAmount: 10,
      expectedVersion: 4,
    });
    expect(mocks.saveCampaign.mock.calls[1][1].prizes[0].color).toBe('#d28023');
  });
  it.each([
    ['Оставить мои правки', 10],
    ['Принять новые значения', 20],
  ])('requires an explicit conflicting-field choice: %s', async (choice, expectedAmount) => {
    const current = campaign(),
      latest = structuredClone(current),
      onSaved = vi.fn(),
      user = userEvent.setup();
    latest.version = 4;
    latest.minReceiptAmount = 20;
    latest.prizes[0].color = '#d28023';
    mocks.loadFortune.mockResolvedValue({ campaigns: [latest], branches: [branch] });
    wrap(
      <CampaignEditor campaign={current} branches={[branch]} onClose={vi.fn()} onSaved={onSaved} />,
    );
    fireEvent.change(screen.getByLabelText('Название акции'), { target: { value: 'Моя акция' } });
    fireEvent.change(screen.getByLabelText('Минимальная сумма чека, ₸'), {
      target: { value: '10' },
    });
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    const choose = await screen.findByRole('button', { name: choice });
    expect(mocks.saveCampaign).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Минимальная сумма чека, ₸')).toHaveValue(10);
    expect(screen.getByRole('button', { name: 'Сохранить настройки' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/сумм/i);
    await user.click(choose);
    expect(screen.getByLabelText('Минимальная сумма чека, ₸')).toHaveValue(expectedAmount);
    expect(screen.getByLabelText('Название акции')).toHaveValue('Моя акция');
    expect(mocks.saveCampaign).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.saveCampaign).toHaveBeenCalledOnce();
    expect(mocks.saveCampaign.mock.calls[0][1]).toMatchObject({
      title: 'Моя акция',
      minReceiptAmount: expectedAmount,
      expectedVersion: 4,
    });
    expect(mocks.saveCampaign.mock.calls[0][1].prizes[0].color).toBe('#d28023');
  });
  it('keeps a real field conflict blocked when a newly issued deleted prize is also restored', async () => {
    const current = campaign(),
      latest = structuredClone(current),
      onSaved = vi.fn(),
      user = userEvent.setup();
    latest.title = 'Серверная акция';
    latest.version = 4;
    latest.prizes[0].issuedCount = 1;
    mocks.loadFortune.mockResolvedValue({ campaigns: [latest], branches: [branch] });
    wrap(
      <CampaignEditor campaign={current} branches={[branch]} onClose={vi.fn()} onSaved={onSaved} />,
    );
    fireEvent.change(screen.getByLabelText('Название акции'), {
      target: { value: 'Моя новая акция' },
    });
    fireEvent.change(screen.getByLabelText('Минимальная сумма чека, ₸'), {
      target: { value: '10' },
    });
    await user.click(screen.getByRole('button', { name: 'Удалить сектор 1' }));
    expect(screen.getAllByLabelText('Название приза')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    const keepMine = await screen.findByRole('button', { name: 'Оставить мои правки' });
    expect(mocks.saveCampaign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Сохранить настройки' })).toBeDisabled();
    expect(screen.getAllByLabelText('Название приза')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Удалить сектор 1' })).toBeDisabled();
    const row = within(screen.getByRole('table'))
      .getByRole('rowheader', { name: 'Название акции' })
      .closest('tr')!;
    expect(within(row).getByRole('cell', { name: 'Моя новая акция' })).toBeInTheDocument();
    expect(within(row).getByRole('cell', { name: 'Серверная акция' })).toBeInTheDocument();
    await user.click(keepMine);
    expect(mocks.saveCampaign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Сохранить настройки' })).toBeEnabled();
    expect(screen.getByLabelText('Название акции')).toHaveValue('Моя новая акция');
    expect(screen.getByLabelText('Минимальная сумма чека, ₸')).toHaveValue(10);
    expect(screen.getByRole('button', { name: 'Удалить сектор 1' })).toBeDisabled();
    expect(screen.getAllByLabelText('Всего призов')[0]).toHaveAttribute('min', '1');
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.saveCampaign).toHaveBeenCalledOnce();
    const payload = mocks.saveCampaign.mock.calls[0][1];
    expect(payload).toMatchObject({
      title: 'Моя новая акция',
      minReceiptAmount: 10,
      expectedVersion: 4,
    });
    expect(payload.prizes).toHaveLength(3);
    expect(payload.prizes[0].id).toBe(current.prizes[0].id);
    expect(payload.prizes[0]).not.toHaveProperty('issuedCount');
  });
  it('stops after a second save conflict and keeps the draft available for retry', async () => {
    const current = campaign(),
      latest = { ...structuredClone(current), version: 4 },
      onSaved = vi.fn(),
      user = userEvent.setup();
    mocks.loadFortune
      .mockResolvedValueOnce({ campaigns: [current], branches: [branch] })
      .mockResolvedValueOnce({ campaigns: [latest], branches: [branch] });
    mocks.saveCampaign.mockRejectedValue(conflict());
    wrap(
      <CampaignEditor campaign={current} branches={[branch]} onClose={vi.fn()} onSaved={onSaved} />,
    );
    fireEvent.change(screen.getByLabelText('Минимальная сумма чека, ₸'), {
      target: { value: '10' },
    });
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сохранить настройки' })).toBeEnabled(),
    );
    expect(mocks.loadFortune).toHaveBeenCalledTimes(2);
    expect(mocks.saveCampaign).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Минимальная сумма чека, ₸')).toHaveValue(10);
    expect(onSaved).not.toHaveBeenCalled();
  });
  it('does not treat a server failure as a version conflict or retry the save', async () => {
    const user = userEvent.setup(),
      onSaved = vi.fn();
    mocks.saveCampaign.mockRejectedValue(
      Object.assign(new Error('Сервер временно недоступен.'), { status: 500 }),
    );
    wrap(
      <CampaignEditor
        campaign={campaign()}
        branches={[branch]}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByLabelText('Минимальная сумма чека, ₸'), {
      target: { value: '10' },
    });
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер временно недоступен.');
    expect(mocks.loadFortune).toHaveBeenCalledOnce();
    expect(mocks.saveCampaign).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Минимальная сумма чека, ₸')).toHaveValue(10);
    expect(onSaved).not.toHaveBeenCalled();
  });
  it('retains draft without writing when the save preflight cannot load authoritative settings', async () => {
    const user = userEvent.setup();
    mocks.loadFortune.mockRejectedValue(new Error('Не удалось загрузить настройки.'));
    wrap(
      <CampaignEditor
        campaign={campaign()}
        branches={[branch]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Минимальная сумма чека, ₸'), {
      target: { value: '10' },
    });
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить настройки.');
    expect(mocks.saveCampaign).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Минимальная сумма чека, ₸')).toHaveValue(10);
  });
  it('creates a new campaign without a revision refresh', async () => {
    const current = { ...campaign(), id: '', version: 0 },
      onSaved = vi.fn(),
      user = userEvent.setup();
    wrap(
      <CampaignEditor campaign={current} branches={[branch]} onClose={vi.fn()} onSaved={onSaved} />,
    );
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.loadFortune).not.toHaveBeenCalled();
    expect(mocks.saveCampaign).toHaveBeenCalledOnce();
    expect(mocks.saveCampaign.mock.calls[0][0]).toBe('');
    expect(mocks.saveCampaign.mock.calls[0][1]).not.toHaveProperty('expectedVersion');
  });
  it('cancels a pending refresh on unmount without posting its late result', async () => {
    const current = campaign(),
      user = userEvent.setup(),
      onSaved = vi.fn();
    let finish!: (value: Dashboard) => void;
    mocks.loadFortune.mockReturnValue(
      new Promise<Dashboard>((resolve) => {
        finish = resolve;
      }),
    );
    const view = wrap(
      <CampaignEditor campaign={current} branches={[branch]} onClose={vi.fn()} onSaved={onSaved} />,
    );
    fireEvent.change(screen.getByLabelText('Минимальная сумма чека, ₸'), {
      target: { value: '10' },
    });
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    expect(mocks.loadFortune).toHaveBeenCalledOnce();
    const signal = mocks.loadFortune.mock.calls[0][0] as AbortSignal;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ campaigns: [current], branches: [branch] }));
    expect(mocks.saveCampaign).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
  it('guards repeated submission while authoritative settings are still loading', async () => {
    const current = campaign(),
      onSaved = vi.fn();
    let finish!: (value: Dashboard) => void;
    mocks.loadFortune.mockReturnValue(
      new Promise<Dashboard>((resolve) => {
        finish = resolve;
      }),
    );
    wrap(
      <CampaignEditor campaign={current} branches={[branch]} onClose={vi.fn()} onSaved={onSaved} />,
    );
    const form = screen.getByLabelText('Название акции').closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.loadFortune).toHaveBeenCalledOnce();
    await act(async () => finish({ campaigns: [current], branches: [branch] }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.saveCampaign).toHaveBeenCalledOnce();
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
