import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import PhotoReportsPage from './PhotoReportsPage';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../lib/api', () => ({ request: mocks.request }));
vi.mock('../lib/admin-realtime', () => ({ useAdminRealtimeEvents: vi.fn() }));
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
    <I18nProvider>
      <PhotoReportsPage role={role} />
    </I18nProvider>,
  );

describe('branch closing report calendar', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
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
    await user.selectOptions(screen.getByLabelText('Город'), 'Астана');
    expect(screen.queryByRole('button', { name: /Актау · 19А/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Астана · Premium · Зал/ })).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Статус точек'), 'complete');
    expect(screen.getByText('Точек с такими условиями нет')).toBeVisible();
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
});
