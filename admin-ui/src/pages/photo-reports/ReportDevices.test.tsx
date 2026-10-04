import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import ReportDevices from './ReportDevices';
import { usePhotoCopy, type ReportDevice } from './model';

const mocks = vi.hoisted(() => ({ request: vi.fn(), realtime: vi.fn() }));
vi.mock('../../lib/api', () => ({ request: mocks.request }));
vi.mock('../../lib/admin-realtime', () => ({ useAdminRealtimeEvents: mocks.realtime }));
const a = { id: 'branch-a', name: '19А', city: 'Актау' };
const b = { id: 'branch-b', name: 'Premium', city: 'Астана' };
const pending: ReportDevice = {
  id: 'tablet-a', branchId: a.id, branchName: a.name, city: a.city, name: null,
  status: 'pending', createdAt: '2026-10-04T12:00:00Z', approvedAt: null, lastSeenAt: null,
  expiresAt: new Date(Date.now() + 300000).toISOString(),
};
const active: ReportDevice = {
  ...pending, status: 'active', name: 'Планшет зала', expiresAt: null,
  approvedAt: '2026-10-04T12:03:00Z', lastSeenAt: '2026-10-04T12:05:00Z',
};
function Harness() {
  const copy = usePhotoCopy();
  return <ReportDevices open branches={[a, b]} copy={copy} onClose={vi.fn()} />;
}
const renderDevices = () => render(<I18nProvider><Harness /></I18nProvider>);

describe('photo report tablet management', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    mocks.realtime.mockReset();
    mocks.request.mockReset().mockResolvedValue({ success: true, devices: [pending] });
  });

  it('requires a selected scoped branch before listing tablets', async () => {
    const user = userEvent.setup();
    renderDevices();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(screen.getByText('Выберите точку для подключения планшета.')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Точка'), a.id);
    expect(await screen.findByText('Ждёт подтверждения')).toBeVisible();
    expect(mocks.request).toHaveBeenCalledWith(
      '/photo-reports/devices?branchId=branch-a',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      { branchScope: '' },
    );
    expect(screen.getByLabelText('Код с планшета')).toHaveValue('');
  });

  it('approves with the manually entered code and trimmed name, then shows the active tablet', async () => {
    const user = userEvent.setup();
    mocks.request.mockImplementation((path: string) => Promise.resolve(
      path.endsWith('/approve') ? { success: true, device: { ...active, name: 'Касса зала' } }
        : { success: true, devices: [pending] },
    ));
    renderDevices();
    await user.selectOptions(screen.getByLabelText('Точка'), a.id);
    const name = await screen.findByLabelText('Название планшета');
    await user.type(name, ' Касса зала ');
    await user.type(screen.getByLabelText('Код с планшета'), '001234');
    await user.click(screen.getByRole('button', { name: 'Подключить планшет' }));
    expect(await screen.findByText('Касса зала')).toBeVisible();
    expect(mocks.request).toHaveBeenCalledWith(
      '/photo-reports/devices/tablet-a/approve',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: '001234', name: 'Касса зала' }) }),
      { branchScope: '' },
    );
    expect(screen.getByText('Последняя активность')).toBeVisible();
    expect(screen.queryByLabelText('Код с планшета')).not.toBeInTheDocument();
  });

  it('requires a concrete confirmation before revoking and keeps the revoked history', async () => {
    const user = userEvent.setup();
    mocks.request.mockImplementation((path: string) => Promise.resolve(
      path.endsWith('/revoke') ? { success: true, device: { ...active, status: 'revoked' } }
        : { success: true, devices: [active] },
    ));
    renderDevices();
    await user.selectOptions(screen.getByLabelText('Точка'), a.id);
    await user.click(await screen.findByRole('button', { name: 'Отключить' }));
    const confirm = within(screen.getByRole('dialog', { name: 'Отключить планшет?' }));
    expect(confirm.getByText('Планшет зала · 19А · Актау')).toBeVisible();
    expect(mocks.request.mock.calls.filter(([path]) => path.endsWith('/revoke'))).toHaveLength(0);
    await user.click(confirm.getByRole('button', { name: 'Отключить планшет' }));
    expect(await screen.findByText('Отключён')).toBeVisible();
    expect(screen.getByText('История')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Отключить' })).not.toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledWith(
      '/photo-reports/devices/tablet-a/revoke',
      expect.objectContaining({ method: 'POST', body: '{}' }),
      { branchScope: '' },
    );
  });

  it('disables approval when a pending code expires while the window is open', async () => {
    const user = userEvent.setup();
    mocks.request.mockImplementation(() => Promise.resolve({ success: true, devices: [{ ...pending, expiresAt: new Date(Date.now() + 250).toISOString() }] }));
    renderDevices();
    await user.selectOptions(screen.getByLabelText('Точка'), a.id);
    expect(await screen.findByText('Ждёт подтверждения')).toBeVisible();
    expect(screen.getByLabelText('Код с планшета')).toBeVisible();
    expect(await screen.findByText('Код истёк')).toBeVisible();
    expect(screen.getByText('На планшете запросите новый код.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Подключить планшет' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Код с планшета')).not.toBeInTheDocument();
    expect(mocks.request.mock.calls.filter(([path]) => path.endsWith('/approve'))).toHaveLength(0);
  });

  it('keeps the selected branch when an older list response arrives late', async () => {
    const user = userEvent.setup();
    let resolveOld!: (value: unknown) => void;
    mocks.request.mockImplementation((path: string) => path.endsWith('branch-a')
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve({ success: true, devices: [{ ...active, id: 'tablet-b', branchId: b.id, name: 'Планшет Premium' }] }));
    renderDevices();
    await user.selectOptions(screen.getByLabelText('Точка'), a.id);
    const oldSignal = mocks.request.mock.calls[0][1].signal as AbortSignal;
    await user.selectOptions(screen.getByLabelText('Точка'), b.id);
    expect(await screen.findByText('Планшет Premium')).toBeVisible();
    await act(async () => resolveOld({ success: true, devices: [active] }));
    expect(oldSignal.aborted).toBe(true);
    expect(screen.getByLabelText('Точка')).toHaveValue(b.id);
    expect(screen.queryByText('Планшет зала')).not.toBeInTheDocument();
  });

  it('aborts a pending approval on branch change and ignores its late response', async () => {
    const user = userEvent.setup();
    let approve!: (value: unknown) => void;
    mocks.request.mockImplementation((path: string) => {
      if (path.endsWith('/approve')) return new Promise((resolve) => { approve = resolve; });
      return Promise.resolve({ success: true, devices: path.endsWith('branch-a') ? [pending] : [{ ...active, id: 'tablet-b', branchId: b.id, name: 'Планшет Premium' }] });
    });
    renderDevices();
    await user.selectOptions(screen.getByLabelText('Точка'), a.id);
    await user.type(await screen.findByLabelText('Название планшета'), 'Зал');
    await user.type(screen.getByLabelText('Код с планшета'), '123456');
    await user.click(screen.getByRole('button', { name: 'Подключить планшет' }));
    expect(screen.getByRole('button', { name: 'Подключаем…' })).toBeDisabled();
    const mutationSignal = mocks.request.mock.calls.find(([path]) => path.endsWith('/approve'))![1].signal as AbortSignal;
    await user.selectOptions(screen.getByLabelText('Точка'), b.id);
    await screen.findByText('Планшет Premium');
    await act(async () => approve({ success: true, device: active }));
    expect(mutationSignal.aborted).toBe(true);
    expect(screen.queryByText('Планшет зала')).not.toBeInTheDocument();
    expect(screen.getByText('Планшет Premium')).toBeVisible();
  });

  it('retains the approval draft after a server error and lets the manager retry', async () => {
    const user = userEvent.setup();
    mocks.request.mockImplementation((path: string) => path.endsWith('/approve')
      ? Promise.reject(new Error('Код не совпадает')) : Promise.resolve({ success: true, devices: [pending] }));
    renderDevices();
    await user.selectOptions(screen.getByLabelText('Точка'), a.id);
    await user.type(await screen.findByLabelText('Название планшета'), 'Зал');
    await user.type(screen.getByLabelText('Код с планшета'), '123456');
    await user.click(screen.getByRole('button', { name: 'Подключить планшет' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Код не совпадает');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Подключить планшет' })).toBeEnabled());
    expect(screen.getByLabelText('Название планшета')).toHaveValue('Зал');
    expect(screen.getByLabelText('Код с планшета')).toHaveValue('123456');
  });

  it('fails closed on device rows outside the selected branch', async () => {
    const user = userEvent.setup();
    mocks.request.mockResolvedValue({ success: true, devices: [{ ...active, branchId: b.id }] });
    renderDevices();
    await user.selectOptions(screen.getByLabelText('Точка'), a.id);
    expect(await screen.findByText('Не удалось загрузить планшеты этой точки.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Отключить' })).not.toBeInTheDocument();
    expect(screen.queryByText('Планшет зала')).not.toBeInTheDocument();
  });
});
