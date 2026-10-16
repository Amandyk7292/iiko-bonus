import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../../components/Feedback';
import { I18nProvider } from '../../lib/i18n';
import { roundsApi } from './api';
import RoundsPage from './RoundsPage';
import { calendarDays, safeMediaUrl, todayKz } from './model';
import type { RoundDetail, RoundSummary, RoundsData } from './types';

vi.mock('./api', () => ({
  roundsApi: {
    list: vi.fn(),
    createInspector: vi.fn(),
    updateInspector: vi.fn(),
    password: vi.fn(),
    create: vi.fn(),
    detail: vi.fn(),
    cancel: vi.fn(),
  },
}));
const branches = [
  { id: 'branch-1', name: 'Жасыл дала', city: 'Актау', active: true },
  { id: 'branch-2', name: 'Central Park', city: 'Актау', active: true },
  { id: 'branch-3', name: 'Розы Баглановой', city: 'Астана', active: true },
];
const inspectors = [
  {
    id: 'inspector-1',
    name: 'Аман',
    city: 'Актау',
    branchIds: ['branch-1', 'branch-2'],
    username: 'rounds.aman',
    active: true,
  },
  {
    id: 'inspector-2',
    name: 'Дина',
    city: 'Астана',
    branchIds: ['branch-3'],
    username: 'rounds.dina',
    active: true,
  },
];
const round = (id: string, overrides: Partial<RoundSummary> = {}): RoundSummary => ({
  id,
  title: `Обход ${id}`,
  date: '2026-10-16',
  deadline: '2026-10-16T18:00:00+05:00',
  branchId: 'branch-1',
  branchName: 'Жасыл дала',
  city: 'Актау',
  inspectorId: 'inspector-1',
  inspectorName: 'Аман',
  status: 'pending',
  completedAt: null,
  completedLate: false,
  totalTasks: 2,
  completedTasks: 0,
  ...overrides,
});
const completedRound = round('готов', {
  status: 'completed',
  completedTasks: 2,
  completedAt: '2026-10-16T19:00:00+05:00',
  completedLate: true,
});
const data: RoundsData = {
  success: true,
  branches,
  inspectors,
  rounds: [
    completedRound,
    round('поздно', { status: 'overdue', branchId: 'branch-2', branchName: 'Central Park' }),
    round('работа', {
      status: 'in_progress',
      inspectorId: 'inspector-2',
      inspectorName: 'Дина',
      city: 'Астана',
      branchId: 'branch-3',
      branchName: 'Розы Баглановой',
    }),
    round('новый', { date: '2026-10-17', status: 'pending' }),
    round('отмена', { date: '2026-10-18', status: 'cancelled' }),
  ],
};
const detail: RoundDetail = {
  ...completedRound,
  tasks: [
    {
      id: 'task-1',
      title: 'Витрина',
      instructions: 'Проверьте свежесть.',
      evidenceType: 'photo_video',
      position: 1,
      completedAt: '2026-10-16T18:30:00+05:00',
      comment: 'Всё в порядке.',
      evidence: [
        {
          id: 'image',
          kind: 'photo',
          mime: 'image/jpeg',
          bytes: 12345,
          createdAt: '2026-10-16T13:00:00Z',
          url: '/admin/api/rounds/media/image',
        },
        {
          id: 'video',
          kind: 'video',
          mime: 'video/mp4',
          bytes: 12345,
          createdAt: '2026-10-16T13:00:00Z',
          url: '/admin/api/rounds/media/video',
        },
      ],
    },
  ],
};
const credentials = { username: 'rounds.new', password: 'test-password-once', url: '/rounds' };
const copy = vi.fn().mockResolvedValue(undefined);
const renderPage = () =>
  render(
    <I18nProvider>
      <FeedbackProvider>
        <RoundsPage />
      </FeedbackProvider>
    </I18nProvider>,
  );
const ready = async () => screen.findByRole('region', { name: 'Календарь обходов' });
const chooseDate = (trigger: HTMLElement, iso: string) => {
  fireEvent.click(trigger);
  const calendar = screen.getByRole('dialog', { name: 'Выбрать дату' });
  fireEvent.change(within(calendar).getByLabelText('Год'), { target: { value: iso.slice(0, 4) } });
  fireEvent.change(within(calendar).getByLabelText('Месяц'), {
    target: { value: iso.slice(5, 7) },
  });
  fireEvent.click(calendar.querySelector(`[data-date="${iso}"]`)!);
  fireEvent.click(within(calendar).getByRole('button', { name: 'Применить' }));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T09:00:00Z'));
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  vi.mocked(roundsApi.list).mockResolvedValue(structuredClone(data));
  vi.mocked(roundsApi.detail).mockResolvedValue({ round: structuredClone(detail) });
  vi.mocked(roundsApi.createInspector).mockResolvedValue({
    inspector: { ...inspectors[0], id: 'new-person' },
    credentials,
  });
  vi.mocked(roundsApi.updateInspector).mockResolvedValue({ inspector: inspectors[0] });
  vi.mocked(roundsApi.password).mockResolvedValue({ credentials });
  vi.mocked(roundsApi.create).mockResolvedValue({ rounds: [] });
  vi.mocked(roundsApi.cancel).mockResolvedValue({ round: { ...detail, status: 'cancelled' } });
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('rounds calendar and reports', () => {
  it.each(['disabled', 'removed'])(
    'preserves historical reports when all inspectors are %s',
    async (state) => {
      vi.mocked(roundsApi.list).mockResolvedValue({
        ...data,
        inspectors:
          state === 'removed' ? [] : inspectors.map((person) => ({ ...person, active: false })),
      });
      renderPage();
      const calendar = await ready();
      expect(within(calendar).getByText('Выполнен · с опозданием')).toBeVisible();
      expect(screen.queryByText('Сначала добавьте сотрудника')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Добавить сотрудника' })).toBeVisible();
    },
  );

  it('opens employee creation from the first-use primary action before assigning any round', async () => {
    vi.mocked(roundsApi.list).mockResolvedValue({ ...data, inspectors: [], rounds: [] });
    renderPage();
    await screen.findByText('Сначала добавьте сотрудника');
    expect(screen.queryByRole('button', { name: 'Назначить обход' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить сотрудника' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Добавить сотрудника' });
    expect(within(dialog).getByLabelText('Имя сотрудника')).toBeVisible();
    expect(
      screen.queryByText('В этом периоде обходов нет. Нажмите «Назначить обход».'),
    ).not.toBeInTheDocument();
  });

  it('refreshes visible calendars every 30 seconds and on return without losing assignment drafts', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const view = renderPage();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Назначить обход' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Название обхода'), {
      target: { value: 'Вечерняя проверка' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(roundsApi.list).toHaveBeenCalledTimes(2);
    expect(within(dialog).getByLabelText('Название обхода')).toHaveValue('Вечерняя проверка');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(roundsApi.list).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(roundsApi.list).toHaveBeenCalledTimes(3));
    fireEvent(window, new Event('focus'));
    expect(roundsApi.list).toHaveBeenCalledTimes(3);
    expect(within(dialog).getByLabelText('Название обхода')).toHaveValue('Вечерняя проверка');
    const signal = vi.mocked(roundsApi.list).mock.calls.at(-1)![3];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(roundsApi.list).toHaveBeenCalledTimes(3);
  });

  it('keeps report media mounted during background refresh, then shows completion without approval', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    vi.mocked(roundsApi.detail).mockResolvedValueOnce({
      round: { ...detail, status: 'in_progress', completedAt: null },
    });
    let resolveDetail!: (value: { round: RoundDetail }) => void;
    vi.mocked(roundsApi.detail).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDetail = resolve;
        }),
    );
    renderPage();
    const calendar = await ready();
    fireEvent.click(within(calendar).getByRole('button', { name: /Аман: Обход готов, Выполнен/ }));
    const dialog = await screen.findByRole('dialog');
    const image = await within(dialog).findByRole('img', { name: 'Фото: Витрина' });
    expect(within(dialog).getByRole('button', { name: 'Отменить обход' })).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(roundsApi.detail).toHaveBeenCalledTimes(2);
    expect(within(dialog).getByRole('img', { name: 'Фото: Витрина' })).toBe(image);
    await act(async () => {
      resolveDetail({ round: structuredClone(detail) });
    });
    expect(within(dialog).getByText('Выполнен · с опозданием')).toBeVisible();
    expect(
      within(dialog).queryByRole('button', { name: 'Отменить обход' }),
    ).not.toBeInTheDocument();
    const signal = vi.mocked(roundsApi.detail).mock.calls.at(-1)![1];
    fireEvent.click(within(dialog).getByText('Закрыть', { selector: 'button' }));
    expect(signal?.aborted).toBe(true);
  });

  it('shows seven local days, textual statuses and a green completed check even when late, with a client-side inspector filter', async () => {
    renderPage();
    const calendar = await ready();
    expect(roundsApi.list).toHaveBeenCalledWith(
      '2026-10-16',
      '2026-10-22',
      '',
      expect.any(AbortSignal),
    );
    expect(within(calendar).getAllByRole('columnheader')).toHaveLength(8);
    const complete = within(calendar).getByRole('button', { name: /Аман: Обход готов, Выполнен/ });
    expect(complete).toHaveClass('rounds-card-completed');
    expect(within(complete).getByText('Выполнен · с опозданием')).toHaveClass(
      'rounds-status-completed',
    );
    expect(within(calendar).getByText('Просрочен')).toBeVisible();
    expect(within(calendar).getByText('В работе')).toBeVisible();
    expect(within(calendar).getByText('Назначен')).toBeVisible();
    expect(within(calendar).getByText('Отменён')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Сотрудник'), { target: { value: 'inspector-1' } });
    expect(within(calendar).queryByText('Розы Баглановой')).not.toBeInTheDocument();
    expect(roundsApi.list).toHaveBeenCalledTimes(1);
  });

  it('reloads city and date filters, caps calendar ranges and ignores aborted stale responses', async () => {
    renderPage();
    await ready();
    let resolveOld!: (value: RoundsData) => void;
    vi.mocked(roundsApi.list).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    fireEvent.change(screen.getByLabelText('Город'), { target: { value: 'Актау' } });
    await waitFor(() =>
      expect(roundsApi.list).toHaveBeenCalledWith(
        '2026-10-16',
        '2026-10-22',
        'Актау',
        expect.any(AbortSignal),
      ),
    );
    fireEvent.change(screen.getByLabelText('Город'), { target: { value: 'Астана' } });
    await ready();
    await act(async () => resolveOld({ ...data, rounds: [round('устаревший')], inspectors: [] }));
    expect(screen.queryByText('Обход устаревший')).not.toBeInTheDocument();
    chooseDate(screen.getByLabelText('Дата по'), '2026-12-01');
    expect(screen.getByRole('alert')).toHaveTextContent('от 1 до 30 дней');
    const calls = vi.mocked(roundsApi.list).mock.calls.length;
    chooseDate(screen.getByLabelText('Дата по'), '2026-10-29');
    await ready();
    expect(roundsApi.list).toHaveBeenCalledTimes(calls + 1);
  });

  it('shows a recoverable loading error and retries without displaying stale calendar data', async () => {
    vi.mocked(roundsApi.list).mockRejectedValueOnce(new Error('Нет связи с сервером.'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи с сервером.');
    expect(screen.queryByRole('region', { name: 'Календарь обходов' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    await ready();
    expect(roundsApi.list).toHaveBeenCalledTimes(2);
  });

  it('opens private photo and video evidence, shows completion without approval and handles missing media', async () => {
    renderPage();
    const calendar = await ready();
    fireEvent.click(within(calendar).getByRole('button', { name: /Обход готов, Выполнен/ }));
    const dialog = await screen.findByRole('dialog');
    const image = await within(dialog).findByAltText('Фото: Витрина');
    expect(image).toHaveAttribute('src', '/admin/api/rounds/media/image');
    expect(within(dialog).getByLabelText('Видео: Витрина').querySelector('source')).toHaveAttribute(
      'src',
      '/admin/api/rounds/media/video',
    );
    expect(within(dialog).getByText('Всё в порядке.')).toBeVisible();
    expect(
      within(dialog).queryByRole('button', { name: /Отменить обход|Одобрить/ }),
    ).not.toBeInTheDocument();
    fireEvent.error(image);
    expect(within(dialog).getByText('Вложение недоступно')).toBeVisible();
  });
});

describe('assignments and employee access', () => {
  it('preserves edited selections across city switches and saves only branches of the current city', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));
    fireEvent.click(
      within(screen.getByRole('heading', { name: 'Аман' }).closest('article')!).getByRole(
        'button',
        { name: 'Изменить' },
      ),
    );
    const dialog = screen.getByRole('dialog', { name: 'Изменить сотрудника' });
    const city = within(dialog).getByLabelText('Город');
    expect(within(dialog).getByLabelText('Жасыл дала')).toBeChecked();
    expect(within(dialog).getByLabelText('Central Park')).toBeChecked();
    fireEvent.click(within(dialog).getByLabelText('Central Park'));
    fireEvent.change(city, { target: { value: 'Астана' } });
    expect(within(dialog).getByLabelText('Розы Баглановой')).not.toBeChecked();
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Сохранить' }).closest('form')!);
    expect(roundsApi.updateInspector).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Выберите хотя бы один филиал');
    fireEvent.click(within(dialog).getByLabelText('Розы Баглановой'));
    fireEvent.change(city, { target: { value: 'Актау' } });
    expect(within(dialog).getByLabelText('Жасыл дала')).toBeChecked();
    expect(within(dialog).getByLabelText('Central Park')).not.toBeChecked();
    fireEvent.change(city, { target: { value: 'Астана' } });
    expect(within(dialog).getByLabelText('Розы Баглановой')).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(roundsApi.updateInspector).toHaveBeenCalledWith('inspector-1', {
        name: 'Аман',
        city: 'Астана',
        branchIds: ['branch-3'],
      }),
    );
  });

  it('creates employee access only for selected city branches and copies the one-time password', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить сотрудника' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Имя сотрудника'), {
      target: { value: '  Новый инспектор  ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Город'), { target: { value: 'Актау' } });
    expect(within(dialog).queryByLabelText('Розы Баглановой')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText('Жасыл дала'));
    fireEvent.change(within(dialog).getByLabelText('Город'), { target: { value: 'Астана' } });
    fireEvent.click(within(dialog).getByLabelText('Розы Баглановой'));
    fireEvent.change(within(dialog).getByLabelText('Город'), { target: { value: 'Актау' } });
    expect(within(dialog).getByLabelText('Жасыл дала')).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать доступ' }));
    await waitFor(() =>
      expect(roundsApi.createInspector).toHaveBeenCalledWith({
        name: 'Новый инспектор',
        city: 'Актау',
        branchIds: ['branch-1'],
      }),
    );
    const access = await screen.findByRole('dialog', { name: 'Доступ сотрудника' });
    expect(within(access).getByText('test-password-once')).toBeVisible();
    fireEvent.click(within(access).getByRole('button', { name: 'Скопировать доступ' }));
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith(expect.stringContaining('Пароль: test-password-once')),
    );
    expect(copy.mock.calls[0][0]).toContain('/rounds');
    fireEvent.click(within(access).getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(screen.queryByText('test-password-once')).not.toBeInTheDocument());
    expect(JSON.stringify(localStorage)).not.toContain('test-password-once');
  });

  it('restricts assignments to employee branches and sends local deadline plus task evidence requirements', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Назначить обход' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText('Розы Баглановой')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText('Жасыл дала'));
    fireEvent.click(within(dialog).getByLabelText('Central Park'));
    chooseDate(within(dialog).getByLabelText('Дата'), '2026-10-20');
    fireEvent.change(within(dialog).getByLabelText('Выполнить до'), { target: { value: '17:30' } });
    fireEvent.change(within(dialog).getByLabelText('Что проверить'), {
      target: { value: '  Витрина  ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Указания'), {
      target: { value: 'Чистота и свежесть' },
    });
    fireEvent.change(within(dialog).getByLabelText('Подтверждение'), {
      target: { value: 'photo_video' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить задачу' }));
    const second = within(dialog).getByRole('group', { name: 'Задача 2' });
    fireEvent.change(within(second).getByLabelText('Что проверить'), {
      target: { value: 'Касса' },
    });
    fireEvent.change(within(second).getByLabelText('Подтверждение'), { target: { value: 'none' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Назначить обход' }));
    await waitFor(() =>
      expect(roundsApi.create).toHaveBeenCalledWith({
        inspectorId: 'inspector-1',
        branchIds: ['branch-1', 'branch-2'],
        title: 'Обход точки',
        date: '2026-10-20',
        deadline: '2026-10-20T17:30:00+05:00',
        tasks: [
          { title: 'Витрина', instructions: 'Чистота и свежесть', evidenceType: 'photo_video' },
          { title: 'Касса', instructions: '', evidenceType: 'none' },
        ],
      }),
    );
  });

  it('requires a branch, preserves the assignment draft on save failure and reports the error', async () => {
    vi.mocked(roundsApi.create).mockRejectedValueOnce(new Error('Сотрудник отключён.'));
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Назначить обход' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Что проверить'), {
      target: { value: 'Проверка' },
    });
    fireEvent.submit(
      within(dialog).getByRole('button', { name: 'Назначить обход' }).closest('form')!,
    );
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Выберите хотя бы один филиал');
    expect(roundsApi.create).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByLabelText('Жасыл дала'));
    fireEvent.submit(
      within(dialog).getByRole('button', { name: 'Назначить обход' }).closest('form')!,
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Сотрудник отключён.');
    expect(within(dialog).getByLabelText('Что проверить')).toHaveValue('Проверка');
  });

  it('updates access and confirms password reset before revealing replacement credentials', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));
    const personCard = screen.getByRole('heading', { name: 'Аман' }).closest('article')!;
    fireEvent.click(within(personCard).getByRole('button', { name: 'Отключить доступ' }));
    await waitFor(() =>
      expect(roundsApi.updateInspector).toHaveBeenCalledWith('inspector-1', { active: false }),
    );
    await screen.findByRole('heading', { name: 'Аман' });
    fireEvent.click(
      within(screen.getByRole('heading', { name: 'Аман' }).closest('article')!).getByRole(
        'button',
        { name: 'Новый пароль' },
      ),
    );
    const confirmation = await screen.findByRole('alertdialog', { name: 'Выдать новый пароль?' });
    expect(roundsApi.password).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Выдать пароль' }));
    await screen.findByRole('dialog', { name: 'Доступ сотрудника' });
    expect(roundsApi.password).toHaveBeenCalledWith('inspector-1');
  });
});

it('bounds calendar days and rejects external or non-private media URLs', () => {
  expect(calendarDays('2026-10-01', '2026-10-30')).toHaveLength(30);
  expect(calendarDays('2026-10-01', '2026-10-31')).toEqual([]);
  expect(calendarDays('2026-10-02', '2026-10-01')).toEqual([]);
  expect(safeMediaUrl('https://external.example/private.jpg')).toBe('');
  expect(safeMediaUrl('/public/photo.jpg')).toBe('');
  expect(safeMediaUrl('/admin/api/rounds/media/123')).toBe('/admin/api/rounds/media/123');
});

it('builds the local ISO date from calendar parts independently of locale formatting', () => {
  vi.setSystemTime(new Date('2026-10-15T20:30:00Z'));
  const descriptor = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format')!;
  Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', {
    configurable: true,
    get: () => () => '16/10/2026',
  });
  try {
    expect(todayKz()).toBe('2026-10-16');
  } finally {
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', descriptor);
  }
});
