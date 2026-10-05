import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  pointId: 'point-19a',
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
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
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

  it('requires a city before choosing a point and filters by stable point ID', async () => {
    mocks.request.mockResolvedValue(response([
      item(),
      item({ id: 'second', name: 'Марат', pointId: 'point-5', branchName: '5-й микрорайон' }),
      item({ id: 'same-name', name: 'Баян', pointId: 'point-5-new', branchName: '5-й микрорайон' }),
      item({ id: 'astana', name: 'Ирина', pointId: 'astana-5', branchName: '5-й микрорайон', city: 'Астана' }),
    ]));
    renderRace();
    await screen.findByText('Ирина');
    const point = screen.getByLabelText('Точка');
    expect(point).toBeDisabled();
    expect(within(point).getByRole('option')).toHaveTextContent('Сначала выберите город');
    fireEvent.change(screen.getByLabelText('Город'), { target: { value: 'Актау' } });
    expect(point).not.toBeDisabled();
    expect(within(point).getAllByRole('option')).toHaveLength(4);
    expect(within(point).getByRole('option', { name: '5-й микрорайон · № point-5' })).toBeInTheDocument();
    expect(within(point).getByRole('option', { name: '5-й микрорайон · № point-5-new' })).toBeInTheDocument();
    fireEvent.change(point, { target: { value: 'point-5' } });
    expect(screen.getByText('Марат')).toBeInTheDocument();
    expect(screen.queryByText('Баян')).not.toBeInTheDocument();
    expect(screen.queryByText('Алия Рублева')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Город'), { target: { value: 'Астана' } });
    expect(point).toHaveValue('');
    expect(screen.getByText('Ирина')).toBeInTheDocument();
    expect(within(point).getAllByRole('option')).toHaveLength(2);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('retains a missing point selection during refresh instead of showing other cashiers', async () => {
    const next = deferred<ReturnType<typeof response>>();
    mocks.request.mockResolvedValueOnce(response()).mockReturnValueOnce(next.promise);
    renderRace();
    await screen.findByText('Алия Рублева');
    fireEvent.change(screen.getByLabelText('Город'), { target: { value: 'Актау' } });
    fireEvent.change(screen.getByLabelText('Точка'), { target: { value: 'point-19a' } });
    fireEvent.change(screen.getByLabelText('Найти кассира'), { target: { value: 'Алия' } });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить рейтинг' }));
    expect(screen.getByText('Алия Рублева')).toBeInTheDocument();
    expect(screen.getByLabelText('Точка')).toHaveValue('point-19a');
    fireEvent.focus(window);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve(response([
      item({ id: 'new', name: 'Алия другая', pointId: 'point-other', branchName: 'Другая точка' }),
    ])));
    expect(screen.getByText('Кассиры не найдены')).toBeInTheDocument();
    expect(screen.queryByText('Алия другая')).not.toBeInTheDocument();
    const point = screen.getByLabelText('Точка');
    expect(point).toHaveValue('point-19a');
    expect(within(point).getByRole('option', { name: '19а ЖК Жасыл дала' })).toBeInTheDocument();
    expect(screen.getByLabelText('Найти кассира')).toHaveValue('Алия');
    fireEvent.change(point, { target: { value: '' } });
    expect(screen.getByText('Алия другая')).toBeInTheDocument();
  });

  it('shows possible duplicate records with IDs without merging records or changing rewards', async () => {
    const candidate = {
      id: 'cashier-duplicate', name: 'Алия Рублева', pointId: 'point-19a',
      branchName: '19а ЖК Жасыл дала', city: 'Актау',
    };
    mocks.request.mockResolvedValue(response([
      item({ duplicateCandidates: [candidate] }),
      item({ ...candidate, completed: 2, rewardAmount: 600 }),
    ]));
    renderRace();
    const badge = await screen.findByRole('button', { name: 'Возможный дубль: Алия Рублева' });
    expect(badge).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.getAllByRole('rowheader')).toHaveLength(2);
    expect(screen.getByText(/1\s800 ₸/)).toBeInTheDocument();
    fireEvent.click(badge);
    const dialog = screen.getByRole('dialog', { name: 'Возможный дубль' });
    expect(dialog).toHaveTextContent('Автоматического объединения нет');
    expect(within(dialog).getByText('ID записи: cashier-1')).toBeInTheDocument();
    expect(within(dialog).getByText('ID записи: cashier-duplicate')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Объединить|Удалить/ })).not.toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('explains registration peaks and review thresholds in Kazakhstan time without withholding salary', async () => {
    mocks.request.mockResolvedValue({
      ...response([item({
        completed: 24, rewardAmount: 7200,
        reviewSignals: [
          { type: 'rapid_registrations', count: 6, from: '2026-10-04T06:00:00Z', to: '2026-10-04T06:09:00Z' },
          { type: 'daily_registrations', count: 24, from: '2026-10-03T19:00:00Z', to: '2026-10-04T19:00:00Z' },
        ],
      })]),
      reviewPolicy: { rapidCount: 5, rapidMinutes: 10, dailyCount: 20, timeZone: 'Asia/Almaty' },
    });
    renderRace();
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить регистрации: Алия Рублева' }));
    const dialog = screen.getByRole('dialog', { name: 'Проверить регистрации' });
    expect(dialog).toHaveTextContent('Начисления не изменены');
    expect(within(dialog).getByText('6 регистраций за 10 минут')).toBeInTheDocument();
    expect(within(dialog).getByText('24 регистрации за день')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/04\.10\.2026, 11:00 — 04\.10\.2026, 11:09/);
    expect(dialog).toHaveTextContent('От 5 за 10 минут или от 20 за день. Время Казахстана.');
    expect(screen.getAllByText(/7\s200 ₸/)).toHaveLength(2);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('refreshes review details and closes resolved flags without retaining stale accusations', async () => {
    const signals = [{ type: 'rapid_registrations' as const, count: 5, from: '2026-10-04T06:00:00Z', to: '2026-10-04T06:09:00Z' }];
    mocks.request.mockResolvedValueOnce(response([item({ reviewSignals: signals })]))
      .mockResolvedValueOnce(response([item({ name: 'Алия Новая', reviewSignals: [{ ...signals[0], count: 7 }] })]))
      .mockResolvedValueOnce(response([item({ name: 'Алия Новая', reviewSignals: [] })]));
    renderRace();
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить регистрации: Алия Рублева' }));
    fireEvent.online(window);
    await within(screen.getByRole('dialog')).findByText('7 регистраций за 10 минут');
    expect(screen.getByRole('dialog')).toHaveTextContent('Алия Новая');
    fireEvent.online(window);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Проверить регистрации:/ })).not.toBeInTheDocument();
    expect(screen.getByText('Алия Новая')).toBeInTheDocument();
  });

  it('localizes point selection and review details in Kazakh', async () => {
    localStorage.setItem('adminLocale', 'kk');
    mocks.request.mockResolvedValue(response([item({ reviewSignals: [{
      type: 'rapid_registrations', count: 5, from: '2026-10-04T06:00:00Z', to: '2026-10-04T06:09:00Z',
    }] })]));
    renderRace();
    const badge = await screen.findByRole('button', { name: 'Тіркелулерді тексеру: Алия Рублева' });
    expect(screen.getByLabelText('Нүкте')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Қала'), { target: { value: 'Актау' } });
    expect(screen.getByLabelText('Нүкте')).not.toBeDisabled();
    fireEvent.click(badge);
    const dialog = screen.getByRole('dialog', { name: 'Тіркелулерді тексеру' });
    expect(dialog).toHaveTextContent('10 минутта 5 тіркелу');
    expect(dialog).toHaveTextContent('Есептелген сыйақылар өзгерген жоқ');
    expect(dialog).toHaveTextContent('Қазақстан уақыты');
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

  it('refreshes visible data without clearing the table, overlapping requests, or keeping archived QR open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const next = deferred<ReturnType<typeof response>>();
    mocks.request.mockResolvedValueOnce(response()).mockReturnValueOnce(next.promise);
    renderRace();
    fireEvent.click(await screen.findByRole('button', { name: 'QR: Алия Рублева' }));
    fireEvent.change(screen.getByLabelText('Город'), { target: { value: 'Актау' } });
    fireEvent.change(screen.getByLabelText('Найти кассира'), { target: { value: 'Жасыл' } });
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('rowheader', { name: /Алия Рублева/ })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.focus(window);
    fireEvent.online(window);
    fireEvent(document, new Event('visibilitychange'));
    expect(mocks.request).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve(response([
      item({ name: 'Алия Новая', isArchived: true, inviteToken: null, url: null }),
      item({ id: 'cashier-new', name: 'Новый кассир' }),
    ])));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Алия Рублева')).not.toBeInTheDocument();
    expect(screen.getByText('Алия Новая')).toBeInTheDocument();
    expect(screen.getByText('Новый кассир')).toBeInTheDocument();
    expect(screen.getByLabelText('Город')).toHaveValue('Актау');
    expect(screen.getByLabelText('Найти кассира')).toHaveValue('Жасыл');
    expect(screen.queryByRole('button', { name: 'QR: Алия Новая' })).not.toBeInTheDocument();
  });

  it('pauses hidden and inactive refreshes, then reloads on return and updates the open QR identity', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    mocks.request.mockResolvedValueOnce(response()).mockResolvedValue(response([
      item({ name: 'Новое ФИО', branchName: 'Новая точка' }),
    ]));
    const view = renderRace();
    fireEvent.click(await screen.findByRole('button', { name: 'QR: Алия Рублева' }));
    visibility.mockReturnValue('hidden');
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    fireEvent.focus(window);
    fireEvent.online(window);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByRole('dialog', { name: 'Новое ФИО' });
    expect(screen.getByRole('dialog')).toHaveTextContent('Новая точка');
    expect(mocks.request).toHaveBeenCalledTimes(2);
    view.rerender(<I18nProvider><CashierSignupRace active={false} /></I18nProvider>);
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    fireEvent.focus(window);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    view.rerender(<I18nProvider><CashierSignupRace active /></I18nProvider>);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3));
    view.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    fireEvent.online(window);
    expect(mocks.request).toHaveBeenCalledTimes(3);
  });

  it('retains the last successful rows after a failed refresh and recovers when the connection returns', async () => {
    mocks.request.mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new Error('Не удалось обновить'))
      .mockResolvedValueOnce(response([item({ name: 'Восстановленный список' })]));
    renderRace();
    await screen.findByText('Алия Рублева');
    fireEvent.focus(window);
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось обновить');
    expect(screen.getByText('Алия Рублева')).toBeInTheDocument();
    fireEvent.online(window);
    await screen.findByText('Восстановленный список');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Алия Рублева')).not.toBeInTheDocument();
  });
});
