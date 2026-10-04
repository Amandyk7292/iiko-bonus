import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import PhotoReportsPage from './PhotoReportsPage';
import { BrowserRouter } from '../lib/router';

const mocks = vi.hoisted(() => ({ request: vi.fn(), realtime: vi.fn() }));
vi.mock('../lib/api', () => ({ request: mocks.request }));
vi.mock('../lib/admin-realtime', () => ({ useAdminRealtimeEvents: mocks.realtime }));
vi.mock('qrcode', () => ({ toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,cXI=') }));
const date = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
const a = { id: 'branch-a', name: '19А', city: 'Актау', active: true };
const b = { id: 'branch-b', name: 'Premium', city: 'Астана', active: true };
const report = {
  id: 'report-a',
  branchId: a.id,
  date,
  kind: 'hall',
  photoCount: 3,
  submittedAt: date + 'T12:00:00Z',
};
const renderPage = (role = 'owner') =>
  render(
    <BrowserRouter>
      <I18nProvider>
        <PhotoReportsPage role={role} />
      </I18nProvider>
    </BrowserRouter>,
  );

describe('branch closing report calendar', () => {
  it.each(['day', 'calendar'])(
    'marks only known zero-tablet branches in the %s view',
    async (view) => {
      window.history.replaceState({}, '', `/admin/photo-reports?view=${view}`);
      mocks.request.mockResolvedValue({
        businessDate: date,
        from: date,
        to: date,
        reports: [],
        branches: [
          { ...a, approvedDeviceCount: 0 },
          { ...b, approvedDeviceCount: 2 },
          { id: 'unknown', name: 'Неизвестная', city: 'Актау', approvedDeviceCount: null },
          { id: 'legacy', name: 'Без сведений', city: 'Актау' },
        ],
      });
      renderPage('viewer');
      const disconnected = await screen.findByText(a.name, { selector: 'strong' });
      expect(disconnected).toHaveClass('closing-branch-disconnected');
      expect(disconnected).toHaveAttribute('title', 'Планшет не подключён');
      for (const name of [b.name, 'Неизвестная', 'Без сведений'])
        expect(screen.getByText(name, { selector: 'strong' })).not.toHaveClass(
          'closing-branch-disconnected',
        );
      expect(
        mocks.request.mock.calls.some(([path]) => path.startsWith('/photo-reports/devices')),
      ).toBe(false);
    },
  );

  it('does not label a branch disconnected during reload or after a failed calendar refresh', async () => {
    let rejectRefresh!: (reason: Error) => void;
    mocks.request
      .mockResolvedValueOnce({
        businessDate: date,
        from: date,
        to: date,
        reports: [],
        branches: [{ ...a, approvedDeviceCount: 0 }],
      })
      .mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectRefresh = reject;
          }),
      );
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText(a.name, { selector: 'strong' })).toHaveClass(
      'closing-branch-disconnected',
    );
    await user.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() =>
      expect(screen.getByText(a.name, { selector: 'strong' })).not.toHaveClass(
        'closing-branch-disconnected',
      ),
    );
    await act(async () => rejectRefresh(new Error('Нет связи')));
    await screen.findByRole('alert');
    expect(screen.getByText(a.name, { selector: 'strong' })).not.toHaveClass(
      'closing-branch-disconnected',
    );
    expect(screen.getByText(a.name, { selector: 'strong' })).not.toHaveAttribute('title');
  });

  it('reloads tablet counts after approval, revocation and a tablet-list refresh', async () => {
    let status: 'pending' | 'active' | 'revoked' = 'pending';
    const device = () => ({
      id: 'tablet-a',
      branchId: a.id,
      branchName: a.name,
      city: a.city,
      name: status === 'pending' ? null : 'Планшет зала',
      status,
      createdAt: date + 'T10:00:00Z',
      approvedAt: status === 'pending' ? null : date + 'T10:03:00Z',
      lastSeenAt: null,
      expiresAt: status === 'pending' ? new Date(Date.now() + 300000).toISOString() : null,
    });
    mocks.request.mockImplementation((path: string) => {
      if (path.endsWith('/approve') || path.endsWith('/revoke')) {
        status = path.endsWith('/approve') ? 'active' : 'revoked';
        return Promise.resolve({ success: true, device: device() });
      }
      if (path.startsWith('/photo-reports/devices?'))
        return Promise.resolve({ success: true, devices: [device()] });
      return Promise.resolve({
        businessDate: date,
        from: date,
        to: date,
        reports: [],
        branches: [{ ...a, approvedDeviceCount: status === 'active' ? 1 : 0 }],
      });
    });
    const user = userEvent.setup();
    renderPage();
    const title = await screen.findByText(a.name, { selector: '.closing-branch-title strong' });
    expect(title).toHaveClass('closing-branch-disconnected');
    await user.click(screen.getByRole('button', { name: 'Планшеты' }));
    const tablets = within(screen.getByRole('dialog', { name: 'Планшеты' }));
    await user.selectOptions(tablets.getByLabelText('Город'), 'city:Актау');
    await user.selectOptions(tablets.getByLabelText('Точка'), a.id);
    await user.type(await tablets.findByLabelText('Название планшета'), 'Планшет зала');
    await user.type(tablets.getByLabelText('Код с планшета'), '001234');
    await user.click(tablets.getByRole('button', { name: 'Подключить планшет' }));
    await waitFor(() => expect(title).not.toHaveClass('closing-branch-disconnected'));
    await user.click(tablets.getByRole('button', { name: 'Отключить' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Отключить планшет?' })).getByRole('button', {
        name: 'Отключить планшет',
      }),
    );
    await waitFor(() => expect(title).toHaveClass('closing-branch-disconnected'));
    status = 'active'; // Another authorized administrator has reconnected the tablet.
    await user.click(tablets.getByRole('button', { name: 'Обновить планшеты' }));
    await waitFor(() => expect(title).not.toHaveClass('closing-branch-disconnected'));
  });

  it('restores shared filters and the selected report after a reload and preserves unrelated parameters', async () => {
    window.history.replaceState(
      {},
      '',
      `/admin/photo-reports?date=${date}&view=calendar&days=7&city=${encodeURIComponent('Актау')}&search=19&status=hall&extra=keep`,
    );
    const user = userEvent.setup();
    const page = renderPage();
    await screen.findByText('Точек с такими условиями нет');
    expect(screen.getByLabelText('Город')).toHaveValue('Актау');
    expect(screen.getByLabelText('Показать')).toHaveValue('7');
    expect(screen.getByLabelText('Точка')).toHaveValue('19');
    await user.click(
      within(screen.getByRole('group', { name: 'Статус точек' })).getByRole('button', {
        name: 'Все',
      }),
    );
    await user.click(
      screen.getByRole('button', { name: /Актау · 19А · Зал .*Отправлен · 3 фото/ }),
    );
    await screen.findByRole('dialog');
    expect(new URLSearchParams(window.location.search).get('branch')).toBe(a.id);
    expect(new URLSearchParams(window.location.search).get('extra')).toBe('keep');
    page.unmount();
    renderPage();
    const detail = await screen.findByRole('dialog');
    expect(await within(detail).findByText('Отчёт отправлен')).toBeVisible();
    await user.click(within(detail).getByRole('button', { name: 'Пекарь' }));
    expect(new URLSearchParams(window.location.search).get('kind')).toBe('baker');
    await user.click(within(detail).getByRole('button', { name: 'Закрыть' }));
    expect(new URLSearchParams(window.location.search).has('branch')).toBe(false);
    expect(screen.getByLabelText('Точка')).toHaveValue('19');
  });

  it('ignores malformed dates, periods and selection values and restores browser history', async () => {
    window.history.replaceState(
      {},
      '',
      '/admin/photo-reports?date=2026-02-30&days=9000&view=broken&status=broken&branch=branch-a&reportDate=invalid&kind=hall',
    );
    renderPage();
    await screen.findByRole('button', { name: /Актау · 19А · Зал .*Отправлен · 3 фото/ });
    expect(screen.getByLabelText('Дата отчёта')).toHaveValue(date);
    expect(screen.getByLabelText('Показать')).toHaveValue('14');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => {
      window.history.replaceState(
        {},
        '',
        `/admin/photo-reports?date=${date}&view=day&city=${encodeURIComponent('Астана')}`,
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByLabelText('Город')).toHaveValue('Астана');
    expect(screen.getByRole('button', { name: 'За день' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Показать')).not.toBeInTheDocument();
  });

  beforeEach(() => {
    window.history.replaceState({}, '', '/admin/photo-reports');
    localStorage.setItem('adminLocale', 'ru');
    mocks.realtime.mockClear();
    mocks.request.mockReset().mockImplementation((path: string) => {
      if (path.endsWith('/qr'))
        return Promise.resolve({ url: 'https://bulka.com.kz/branch-reports#t=fixture' });
      if (path.startsWith('/photo-reports/branches/'))
        return Promise.resolve({
          branch: a,
          date,
          reports: [
            { ...report, photos: [{ id: 'photo', available: false, expiresAt: date, url: null }] },
          ],
        });
      return Promise.resolve({
        businessDate: date,
        from: date,
        to: date,
        branches: [a, b],
        reports: [report],
      });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('separates both shifts, requires four reports and opens the selected shift', async () => {
    const branch = {
      ...a,
      roundTheClock: true,
      photoDayShiftStart: '08:00',
      photoNightShiftStart: '21:00',
    };
    const reports = [
      {
        ...report,
        shift: 'day',
        photoCount: 2,
        shiftStartsAt: date + 'T03:00:00Z',
        shiftEndsAt: date + 'T16:00:00Z',
      },
      { ...report, id: 'baker-day', kind: 'baker', shift: 'day' },
      {
        ...report,
        id: 'hall-night',
        shift: 'night',
        photoCount: 5,
        shiftStartsAt: date + 'T16:00:00Z',
        shiftEndsAt: date + 'T23:00:00Z',
      },
    ];
    mocks.request.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/photo-reports/branches/')
          ? { branch, date, reports }
          : { businessDate: date, from: date, to: date, branches: [branch], reports },
      ),
    );
    const user = userEvent.setup();
    renderPage();
    const first = await screen.findByRole('button', {
      name: /Актау · 19А · Зал · 1 смена.*2 фото/,
    });
    const second = screen.getByRole('button', { name: /Актау · 19А · Зал · 2 смена.*5 фото/ });
    expect(first).toHaveClass('done');
    expect(second).toHaveClass('done');
    expect(screen.getByRole('button', { name: /Пекарь · 2 смена.*Не отправлен/ })).not.toHaveClass(
      'done',
    );
    await user.click(second);
    const dialog = within(screen.getByRole('dialog'));
    expect(await dialog.findByText(/5 фото/)).toBeVisible();
    await user.click(dialog.getByRole('button', { name: '1 смена' }));
    expect(dialog.getByText(/2 фото/)).toBeVisible();
    await user.click(dialog.getByRole('button', { name: 'Закрыть' }));
    await user.click(
      within(screen.getByRole('group', { name: 'Статус точек' })).getByRole('button', {
        name: 'Готово',
      }),
    );
    expect(screen.getByText('Точек с такими условиями нет')).toBeVisible();
  });

  it('keeps old daily reports accessible after a branch enables shifts', async () => {
    const branch = { ...a, roundTheClock: true };
    mocks.request.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/photo-reports/branches/')
          ? { branch, date, reports: [report] }
          : { businessDate: date, from: date, to: date, branches: [branch], reports: [report] },
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByRole('button', { name: /Актау · 19А · Зал · .*Отправлен · 3 фото/ }),
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(await dialog.findByText(/3 фото/)).toBeVisible();
    expect(dialog.getByRole('button', { name: 'За день' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('distinguishes hall and baker and preserves submission history after photos expire', async () => {
    const user = userEvent.setup();
    renderPage();
    const sent = await screen.findByRole('button', {
      name: /Актау · 19А · Зал .*Отправлен · 3 фото/,
    });
    expect(sent).toHaveClass('done');
    const missing = screen.getByRole('button', { name: /Актау · 19А · Пекарь .*Не отправлен/ });
    expect(missing).not.toHaveClass('done');
    await user.click(sent);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Отчёт отправлен')).toBeVisible();
    expect(within(dialog).getByText('Срок хранения фото истёк')).toBeVisible();
    expect(within(dialog).getByText(/3 фото/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Пекарь' }));
    expect(within(dialog).getByText('Отчёт не отправлен')).toBeVisible();
  });

  it('filters branches by city and report completion without granting viewers QR access', async () => {
    const user = userEvent.setup();
    renderPage('viewer');
    await screen.findByRole('button', { name: /Актау · 19А · Зал/ });
    expect(screen.queryByRole('button', { name: /QR для/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Планшеты' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Город'), 'Астана');
    expect(screen.queryByRole('button', { name: /Актау · 19А/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Астана · Premium · Зал/ })).toBeVisible();
    await user.click(
      within(screen.getByRole('group', { name: 'Статус точек' })).getByRole('button', {
        name: 'Готово',
      }),
    );
    expect(screen.getByText('Точек с такими условиями нет')).toBeVisible();
  });

  it.each(['viewer', 'employee', 'auditor'])('hides tablet management for %s', async (role) => {
    renderPage(role);
    await screen.findByRole('button', { name: /Актау · 19А · Зал/ });
    expect(screen.queryByRole('button', { name: 'Планшеты' })).not.toBeInTheDocument();
    expect(
      mocks.request.mock.calls.some(([path]) => path.startsWith('/photo-reports/devices')),
    ).toBe(false);
  });

  it.each(['owner', 'admin', 'branch_manager'])('offers tablet management for %s', async (role) => {
    renderPage(role);
    await screen.findByRole('button', { name: /Актау · 19А · Зал/ });
    expect(screen.getByRole('button', { name: 'Планшеты' })).toBeVisible();
  });

  it('preserves actual audit checks and tablet name when report photos are deleted', async () => {
    const user = userEvent.setup();
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path: string) =>
      path.startsWith('/photo-reports/branches/')
        ? Promise.resolve({
            branch: a,
            date,
            reports: [
              {
                ...report,
                deviceId: 'tablet-a',
                deviceName: 'Планшет зала',
                checks: { deviceAuthorized: true, branchMatched: false, imagesValidated: true },
                photos: [],
              },
            ],
          })
        : original(path),
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Актау · 19А · Зал/ }));
    const audit = within(await screen.findByRole('region', { name: 'Проверки при отправке' }));
    expect(audit.getByText('Планшет зала')).toBeVisible();
    expect(audit.getByText('Планшет подключён').parentElement).toHaveTextContent('Да');
    expect(audit.getByText('Филиал совпадает').parentElement).toHaveTextContent('Нет');
    expect(audit.getByText('Формат фото').parentElement).toHaveTextContent('Да');
    expect(audit.getByText(/17:00/).closest('time')).toHaveAttribute(
      'dateTime',
      report.submittedAt,
    );
    expect(screen.getByText('Срок хранения фото истёк')).toBeVisible();
  });

  it('shows unknown audit results for legacy reports without device metadata', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Актау · 19А · Зал/ }));
    const audit = within(await screen.findByRole('region', { name: 'Проверки при отправке' }));
    expect(audit.getAllByText('Нет данных')).toHaveLength(4);
    expect(audit.queryByText('Да')).not.toBeInTheDocument();
  });

  it('creates a reusable branch QR and offers a downloadable image', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'QR для 19А' }));
    const link = await screen.findByRole('link', { name: 'Скачать QR' });
    expect(link).toHaveAttribute('download', 'Bulka-QR-19А.png');
    expect(mocks.request).toHaveBeenCalledWith(
      '/photo-reports/branches/branch-a/qr',
      expect.objectContaining({ method: 'POST', body: '{}' }),
      { branchScope: '' },
    );
  });

  it('allows retry after a calendar failure and never renders stale branch details', async () => {
    const user = userEvent.setup();
    mocks.request.mockRejectedValueOnce(new Error('Ошибка связи'));
    renderPage();
    expect(await screen.findByText('Ошибка связи')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByRole('button', { name: /Актау · 19А · Зал/ });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  });

  it('opens a compact day view on a phone and fetches history only when requested', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: () => false,
    }));
    const user = userEvent.setup();
    const view = renderPage();
    await screen.findByRole('button', { name: /Актау · 19А · Зал/ });
    expect(view.container.querySelector('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'За день' })).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.request).toHaveBeenCalledWith(
      `/photo-reports?end=${date}&days=1`,
      expect.anything(),
      { branchScope: '' },
    );
    await user.click(screen.getByRole('button', { name: 'Календарь' }));
    await screen.findByRole('table');
    expect(screen.getByLabelText('Показать')).toHaveValue('14');
    expect(mocks.request).toHaveBeenCalledWith(
      `/photo-reports?end=${date}&days=14`,
      expect.anything(),
      { branchScope: '' },
    );
  });

  it('retains the calendar during a failed background update', async () => {
    const user = userEvent.setup();
    renderPage();
    const sent = await screen.findByRole('button', { name: /Актау · 19А · Зал/ });
    mocks.request.mockRejectedValueOnce(new Error('Связь прервалась'));
    await user.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(await screen.findByText('Не удалось обновить данные')).toBeVisible();
    expect(sent).toBeInTheDocument();
    expect(sent).toHaveClass('done');
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() =>
      expect(screen.queryByText('Не удалось обновить данные')).not.toBeInTheDocument(),
    );
  });

  it('does not replace the selected day with an older response', async () => {
    let resolveOld!: (value: unknown) => void;
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    renderPage();
    const previous = new Date(`${date}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const previousDate = previous.toISOString().slice(0, 10);
    mocks.request.mockResolvedValueOnce({
      businessDate: date,
      from: previousDate,
      to: previousDate,
      branches: [a, b],
      reports: [],
    });
    fireEvent.change(screen.getByLabelText('Дата отчёта'), { target: { value: previousDate } });
    await screen.findByRole('button', { name: /Актау · 19А · Зал.*Не отправлен/ });
    await act(async () => resolveOld(await original(`/photo-reports?end=${date}&days=14`)));
    expect(screen.getByLabelText('Дата отчёта')).toHaveValue(previousDate);
    expect(screen.queryByRole('button', { name: /Отправлен · 3 фото/ })).not.toBeInTheDocument();
  });

  it('keeps an open photo during realtime updates and provides recovery for an image failure', async () => {
    const user = userEvent.setup();
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path: string) =>
      path.startsWith('/photo-reports/branches/')
        ? Promise.resolve({
            branch: a,
            date,
            reports: [
              {
                ...report,
                photos: [
                  { id: 'one', available: true, url: '/admin/api/photo-reports/photos/one' },
                  { id: 'two', available: true, url: '/admin/api/photo-reports/photos/two' },
                ],
              },
            ],
          })
        : original(path),
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Актау · 19А · Зал/ }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Отчёт отправлен');
    await user.click(within(dialog).getByRole('button', { name: 'Следующее фото' }));
    const image = within(dialog).getByRole('img', { name: 'Зал · 2' });
    fireEvent.load(image);
    await user.click(within(dialog).getByRole('button', { name: 'Фото 2' }));
    expect(within(dialog).queryByRole('status', { name: 'Загрузка фото' })).not.toBeInTheDocument();
    await act(async () => mocks.realtime.mock.calls.at(-1)![1]());
    expect(within(dialog).getByRole('img', { name: 'Зал · 2' })).toBe(image);
    expect(
      mocks.request.mock.calls.filter(([path]) => path.startsWith('/photo-reports/branches/')),
    ).toHaveLength(1);
    fireEvent.error(image);
    expect(within(dialog).getByText('Фото не загрузилось')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Повторить' }));
    expect(within(dialog).getByRole('img', { name: 'Зал · 2' })).toHaveAttribute(
      'src',
      '/admin/api/photo-reports/photos/two?retry=1',
    );
  });

  it('opens missing reports from summary counts and restores the full list', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: /Актау · 19А · Зал/ });
    await user.click(screen.getByRole('button', { name: 'Показать точки без отчёта зала' }));
    expect(screen.queryByRole('button', { name: /Актау · 19А/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Астана · Premium · Зал/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Все' }));
    expect(screen.getByRole('button', { name: /Актау · 19А · Зал/ })).toBeVisible();
  });
});
