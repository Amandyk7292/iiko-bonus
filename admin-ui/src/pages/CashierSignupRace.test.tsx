import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import CashierSignupRace, { type CashierRaceItem } from './CashierSignupRace';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../lib/api', () => ({ request: mocks.request }));

const token = 'a'.repeat(64);
const item = (overrides: Partial<CashierRaceItem> = {}): CashierRaceItem => ({
  id: 'cashier-1',
  name: 'Алия Рублева',
  branchName: '19а ЖК Жасыл дала',
  city: 'Актау',
  completed: 4,
  rewardAmount: 1200,
  rank: 1,
  isArchived: false,
  inviteToken: token,
  url: `https://bulka.com.kz/cashier-invite/${token}`,
  ...overrides,
});
const response = (items: CashierRaceItem[] = [item()]) => ({
  success: true,
  items,
  totals: {
    completed: items.reduce((total, row) => total + row.completed, 0),
    rewardAmount: items.reduce((total, row) => total + row.rewardAmount, 0),
  },
});
const renderRace = () =>
  render(
    <I18nProvider>
      <CashierSignupRace />
    </I18nProvider>,
  );
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe('cashier registration race', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    mocks.request.mockReset().mockResolvedValue(response());
  });

  it('loads the current month globally without the branch competition or extra instructions', async () => {
    renderRace();
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем рейтинг');
    await screen.findByRole('rowheader', { name: /Алия Рублева/ });
    const from = (screen.getByLabelText('С даты') as HTMLInputElement).value;
    const to = (screen.getByLabelText('По дату') as HTMLInputElement).value;
    expect(from).toBe(`${to.slice(0, 7)}-01`);
    expect(mocks.request).toHaveBeenCalledWith(
      `/bonus/cashier-race?from=${from}&to=${to}`,
      { signal: expect.any(AbortSignal) },
      { branchScope: '' },
    );
    expect(screen.getByRole('heading', { name: 'Гонка кассиров' })).toBeInTheDocument();
    expect(screen.getByText('300 ₸ за завершённую регистрацию')).toBeInTheDocument();
    expect(screen.queryByText('Гонка филиалов')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Применить/ })).not.toBeInTheDocument();
  });

  it('orders registrations descending, assigns equal places for ties, and retains archived earnings', async () => {
    mocks.request.mockResolvedValue(
      response([
        item({ id: 'b', name: 'Баян', completed: 2, rewardAmount: 600, rank: 9 }),
        item({
          id: 'archive',
          name: 'Динара',
          completed: 5,
          rewardAmount: 1500,
          isArchived: true,
          inviteToken: null,
          url: null,
        }),
        item({ id: 'a', name: 'Алия', completed: 2, rewardAmount: 600, rank: 7 }),
        item({ id: 'zero', name: 'Сергей', completed: 0, rewardAmount: 0 }),
      ]),
    );
    renderRace();
    await screen.findByText('Динара');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'ДинараВ архиве19а ЖК Жасыл дала · Актау',
      'Алия19а ЖК Жасыл дала · Актау',
      'Баян19а ЖК Жасыл дала · Актау',
      'Сергей19а ЖК Жасыл дала · Актау',
    ]);
    expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      '1',
      '2',
      '2',
      '4',
    ]);
    expect(within(rows[0]).getAllByRole('cell')[2]).toHaveTextContent(/1\s500 ₸/);
    expect(within(rows[0]).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText(/2\s700 ₸/)).toBeInTheDocument();
  });

  it('filters by city and employee or branch name without another server request', async () => {
    mocks.request.mockResolvedValue(
      response([
        item(),
        item({
          id: 'astana',
          name: 'Ирина',
          city: 'Астана',
          branchName: 'Кабанбай батыра',
          completed: 7,
          rewardAmount: 2100,
        }),
        item({ id: 'aktau', name: 'Марат', completed: 3, rewardAmount: 900 }),
      ]),
    );
    renderRace();
    await screen.findByText('Ирина');
    fireEvent.change(screen.getByLabelText('Город'), { target: { value: 'Актау' } });
    expect(screen.queryByText('Ирина')).not.toBeInTheDocument();
    expect(screen.getByText('Марат')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Найти кассира'), { target: { value: '  АЛИЯ ' } });
    expect(screen.queryByText('Марат')).not.toBeInTheDocument();
    expect(screen.getByText('Алия Рублева')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Найти кассира'), { target: { value: 'Жасыл' } });
    expect(screen.getByText('Марат')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Найти кассира'), { target: { value: 'никого' } });
    expect(screen.getByText('Кассиры не найдены')).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('requests changed dates automatically and hides counts from the previous period while loading', async () => {
    const next = deferred<ReturnType<typeof response>>();
    mocks.request.mockResolvedValueOnce(response()).mockReturnValueOnce(next.promise);
    renderRace();
    await screen.findByText('Алия Рублева');
    fireEvent.change(screen.getByLabelText('С даты'), { target: { value: '2000-01-01' } });
    expect(screen.queryByText('Алия Рублева')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем рейтинг');
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(mocks.request.mock.calls[1][0]).toContain('from=2000-01-01&to=');
    await act(async () => next.resolve(response([item({ completed: 1, rewardAmount: 300 })])));
    expect(await screen.findByText('Алия Рублева')).toBeInTheDocument();
  });

  it('ignores and aborts an older date response even if it completes after the current one', async () => {
    const old = deferred<ReturnType<typeof response>>();
    const next = deferred<ReturnType<typeof response>>();
    mocks.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    renderRace();
    fireEvent.change(screen.getByLabelText('С даты'), { target: { value: '2000-01-01' } });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(mocks.request.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => next.resolve(response([item({ name: 'Текущая дата' })])));
    await screen.findByText('Текущая дата');
    await act(async () => old.resolve(response([item({ name: 'Устаревшая дата' })])));
    expect(screen.queryByText('Устаревшая дата')).not.toBeInTheDocument();
    expect(screen.getByText('Текущая дата')).toBeInTheDocument();
  });

  it('does not request an incomplete or reversed period and offers recovery after a server error', async () => {
    mocks.request
      .mockRejectedValueOnce(new Error('Сервис временно недоступен'))
      .mockResolvedValue(response());
    renderRace();
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Сервис временно недоступен');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByText('Алия Рублева');
    fireEvent.change(screen.getByLabelText('По дату'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Выберите начальную и конечную даты');
    expect(screen.queryByText('Алия Рублева')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('По дату'), { target: { value: '1999-01-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Выберите начальную и конечную даты');
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('shows only active personal QR, offers PNG download and copies the registration link', async () => {
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboard },
    });
    mocks.request.mockResolvedValue(
      response([
        item(),
        item({ id: 'old', name: 'Архивный', isArchived: true }),
        item({ id: 'missing', name: 'Без ссылки', inviteToken: null, url: null }),
      ]),
    );
    renderRace();
    const qr = await screen.findByRole('button', { name: 'QR: Алия Рублева' });
    expect(screen.getAllByRole('button', { name: /^QR:/ })).toHaveLength(1);
    fireEvent.click(qr);
    const dialog = screen.getByRole('dialog', { name: 'Алия Рублева' });
    const url = `/api/public/cashier-invites/${token}/qr`;
    expect(within(dialog).getByRole('img', { name: 'QR: Алия Рублева' })).toHaveAttribute(
      'src',
      url,
    );
    expect(within(dialog).getByRole('link', { name: 'Скачать QR' })).toHaveAttribute('href', url);
    expect(within(dialog).getByRole('link', { name: 'Скачать QR' })).toHaveAttribute(
      'download',
      'bulka-cashier-cashier-1.png',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Копировать ссылку' }));
    await within(dialog).findByRole('button', { name: 'Скопировано' });
    expect(clipboard).toHaveBeenCalledWith(item().url);
  });

  it('provides an editable selection fallback when clipboard access is unavailable and can retry QR loading', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    renderRace();
    fireEvent.click(await screen.findByRole('button', { name: 'QR: Алия Рублева' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Копировать ссылку' }));
    const input = await within(dialog).findByLabelText('Ссылка на регистрацию');
    expect(input).toHaveValue(item().url);
    expect(input).toHaveAttribute('readonly');
    fireEvent.error(within(dialog).getByRole('img'));
    expect(
      within(dialog).getByText('Не удалось загрузить QR').closest('[role="alert"]'),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Обновить QR' }));
    expect(within(dialog).getByRole('img')).toBeInTheDocument();
  });

  it('uses Kazakh labels and keeps empty city filters available across period changes', async () => {
    localStorage.setItem('adminLocale', 'kk');
    mocks.request.mockResolvedValueOnce(response()).mockResolvedValueOnce(response([]));
    renderRace();
    await screen.findByText('Алия Рублева');
    expect(screen.getByRole('heading', { name: 'Кассирлер жарысы' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Қала'), { target: { value: 'Актау' } });
    fireEvent.change(screen.getByLabelText('Басталу күні'), { target: { value: '2000-01-01' } });
    await screen.findByText('Кассирлер табылмады');
    expect(screen.getByLabelText('Қала')).toHaveValue('Актау');
    expect(screen.getByRole('option', { name: 'Актау' })).toBeInTheDocument();
  });
});
