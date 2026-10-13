import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { I18nProvider } from '../lib/i18n';
import { savePendingVirtualPosSale, virtualPosPendingKey, type PendingVirtualPosSale, type VirtualPosCatalog, type VirtualPosSale, type VirtualPosSaleRequest } from '../lib/virtual-pos';
import VirtualPosPage from './VirtualPosPage';

const mocks = vi.hoisted(() => ({ scope: vi.fn(), catalog: vi.fn(), sale: vi.fn(), create: vi.fn(), session: vi.fn(), confirm: vi.fn() }));
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, api: { getAdminScope: mocks.scope, getVirtualPosCatalog: mocks.catalog, getVirtualPosSale: mocks.sale, createVirtualPosSale: mocks.create, session: mocks.session } };
});
vi.mock('../components/Feedback', () => ({ useFeedback: () => ({ confirm: mocks.confirm }) }));

const branchId = '11111111-1111-4111-8111-111111111111';
const secondBranchId = '22222222-2222-4222-8222-222222222222';
const branch = { id: branchId, name: 'Bulka — Актау 17', address: '17-й микрорайон', city: 'aktau', active: true };
const baseCatalog: VirtualPosCatalog = {
  branch, terminal: { id: 'terminal', name: 'Основная касса', connected: true }, cashShift: { id: 'shift', isOpen: true, number: 123 },
  revision: 'revision-1', canSell: true,
  products: [
    { id: 'bun', name: 'Плюшка', price: 500, unit: 'шт', quantityStep: 1, available: true, paymentTypeIds: ['cash'] },
    { id: 'cake', name: 'Торт', price: 2000, unit: 'кг', quantityStep: 0.001, available: true, paymentTypeIds: ['cash', 'transfer'] },
    { id: 'stopped', name: 'Эклер', price: 750, unit: 'шт', quantityStep: 1, available: false, paymentTypeIds: ['cash'], unavailableReason: 'Стоп-лист iiko' },
  ],
  paymentTypes: [
    { id: 'cash', name: 'Наличные нефискальные', kind: 'cash', isFiscal: false, selectable: true },
    { id: 'transfer', name: 'Перевод', kind: 'card', isFiscal: false, selectable: true },
    { id: 'fiscal', name: 'Наличные фискальные', kind: 'cash', isFiscal: true, selectable: true },
  ],
};

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  mocks.scope.mockResolvedValue({ locations: [branch] });
  mocks.catalog.mockResolvedValue(structuredClone(baseCatalog));
  mocks.session.mockResolvedValue({ user: { username: 'employee', role: 'employee' } });
  mocks.sale.mockImplementation(async (_branch, id) => ({ sale: { id, status: 'queued', total: 500 } }));
  mocks.create.mockImplementation(async (_branch, request: VirtualPosSaleRequest) => ({ sale: { id: request.requestId, status: 'queued', total: request.expectedTotal } }));
  mocks.confirm.mockResolvedValue(true);
});
const mount = () => render(<I18nProvider><VirtualPosPage username="employee" /></I18nProvider>);
const buildSale = async () => {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Добавить: Плюшка' }));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Тип оплаты в iiko' }), 'cash');
  return user;
};

describe('staff virtual POS', () => {
  it('uses assigned branch and actual compatible nonfiscal payment types', async () => {
    localStorage.setItem('adminSelectedBranchId', secondBranchId);
    mount(); const user = await buildSale();
    expect(mocks.catalog).toHaveBeenCalledWith(branchId, expect.any(AbortSignal));
    expect(screen.queryByRole('option', { name: 'Перевод' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Наличные фискальные' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить: Эклер' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Увеличить количество: Плюшка' }));
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать продажу' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(branchId, {
      requestId: expect.any(String), terminalId: 'terminal', snapshotRevision: 'revision-1', cashShiftId: 'shift',
      paymentTypeId: 'cash', expectedTotal: 1000, items: [{ productId: 'bun', quantity: 2 }],
    });
  });

  it('blocks selling without a connected no-paper capable terminal and has no fake payments', async () => {
    mocks.catalog.mockResolvedValue({ ...baseCatalog, canSell: false, paymentTypes: [], unavailableReason: 'Режим без печати не подтверждён' });
    mount();
    expect(await screen.findByText('Режим без печати не подтверждён')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Добавить: Плюшка' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Зарегистрировать продажу' })).toBeDisabled();
    expect(screen.queryByRole('option', { name: 'Наличные нефискальные' })).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects fractional piece quantities and accepts the actual weighted step', async () => {
    mount(); const user = await buildSale();
    const quantity = screen.getByRole('textbox', { name: 'Количество: Плюшка' });
    await user.clear(quantity); await user.type(quantity, '0,5');
    expect(quantity).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Зарегистрировать продажу' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Удалить: Плюшка' }));
    await user.click(screen.getByRole('button', { name: 'Добавить: Торт' }));
    const weight = screen.getByRole('textbox', { name: 'Количество: Торт' });
    await user.clear(weight); await user.type(weight, '0,125');
    expect(screen.getByRole('button', { name: 'Зарегистрировать продажу' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать продажу' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(branchId, expect.objectContaining({ expectedTotal: 250, items: [{ productId: 'cake', quantity: 0.125 }] })));
  });

  it('guards rapid double activation synchronously', async () => {
    let finishSession!: (value: unknown) => void;
    mocks.session.mockReturnValue(new Promise((resolve) => { finishSession = resolve; }));
    mount(); await buildSale();
    const submit = screen.getByRole('button', { name: 'Зарегистрировать продажу' });
    fireEvent.click(submit); fireEvent.click(submit);
    expect(mocks.session).toHaveBeenCalledTimes(1);
    await act(async () => { finishSession({ user: { username: 'employee' } }); });
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  });

  it('retains an uncertain operation through reload, checks the same ID and clears only on completion', async () => {
    mocks.create.mockRejectedValue(new ApiError('Нет связи', 0, 'NETWORK_ERROR'));
    const view = mount(); const user = await buildSale();
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать продажу' }));
    await screen.findByText('Продажа обрабатывается в iiko');
    const saved = JSON.parse(localStorage.getItem(virtualPosPendingKey('employee', branchId))!);
    expect(saved.request.items).toEqual([{ productId: 'bun', quantity: 1 }]);
    expect(screen.getByRole('combobox', { name: 'Точка продажи' })).toBeDisabled();
    view.unmount(); mount();
    await screen.findByText('Продажа обрабатывается в iiko');
    await waitFor(() => expect(mocks.sale).toHaveBeenCalledWith(branchId, saved.request.requestId));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    mocks.sale.mockResolvedValue({ sale: { id: saved.request.requestId, status: 'completed', total: 500, frontOrderNumber: 42 } });
    await user.click(screen.getByRole('button', { name: 'Проверить результат' }));
    expect(await screen.findByText('Продажа зарегистрирована')).toBeVisible();
    expect(localStorage.getItem(virtualPosPendingKey('employee', branchId))).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Количество: Плюшка' })).not.toBeInTheDocument();
  });

  it('keeps manual reconciliation locked and never offers a fresh sale', async () => {
    mocks.create.mockImplementation(async (_branch, request) => ({ sale: { id: request.requestId, status: 'needs_reconciliation', total: 500, error: 'Проверьте операцию на кассе' } }));
    mocks.sale.mockImplementation(async (_branch, id) => ({ sale: { id, status: 'needs_reconciliation', total: 500 } }));
    mount(); const user = await buildSale();
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать продажу' }));
    expect(await screen.findByText('Нужно проверить продажу в iikoFront')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Количество: Плюшка' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Вернуться к продаже' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Зарегистрировать продажу' })).not.toBeInTheDocument();
  });

  it('unlocks a definitive preflight rejection only after the employee chooses to edit', async () => {
    mocks.create.mockRejectedValue(new ApiError('Смена изменилась', 409, 'VIRTUAL_POS_SHIFT_CHANGED', undefined, undefined, true));
    mount(); const user = await buildSale();
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать продажу' }));
    expect(await screen.findByText('Продажа не проведена')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Количество: Плюшка' })).toBeDisabled();
    expect(mocks.sale).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Вернуться к продаже' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Количество: Плюшка' })).toBeEnabled());
    expect(localStorage.getItem(virtualPosPendingKey('employee', branchId))).toBeNull();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('blocks checkout when another tab changes the authenticated employee', async () => {
    mocks.session.mockResolvedValue({ user: { username: 'another.employee' } });
    mount(); const user = await buildSale();
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать продажу' }));
    expect(await screen.findByText('Учётная запись изменилась. Обновите страницу и войдите заново.')).toBeVisible();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('clears branch-bound cart only after the employee confirms switching an assigned branch', async () => {
    const second = { ...branch, id: secondBranchId, name: 'Bulka — Актау 4' };
    mocks.scope.mockResolvedValue({ locations: [branch, second] });
    mocks.catalog.mockImplementation(async (id) => ({ ...baseCatalog, branch: id === branchId ? branch : second }));
    mount(); const user = userEvent.setup();
    const select = await screen.findByRole('combobox', { name: 'Точка продажи' });
    await user.selectOptions(select, branchId);
    await user.click(await screen.findByRole('button', { name: 'Добавить: Плюшка' }));
    mocks.confirm.mockResolvedValue(false);
    await user.selectOptions(select, secondBranchId);
    expect(select).toHaveValue(branchId);
    expect(screen.getByRole('textbox', { name: 'Количество: Плюшка' })).toHaveValue('1');
    mocks.confirm.mockResolvedValue(true);
    await user.selectOptions(select, secondBranchId);
    await waitFor(() => expect(mocks.catalog).toHaveBeenLastCalledWith(secondBranchId, expect.any(AbortSignal)));
    expect(screen.queryByRole('textbox', { name: 'Количество: Плюшка' })).not.toBeInTheDocument();
  });

  it('stops adding distinct products at the backend 100-line limit before saving a request', async () => {
    mocks.catalog.mockResolvedValue({ ...baseCatalog, products: Array.from({ length: 101 }, (_, index) => ({ ...baseCatalog.products[0], id: `bun-${index}`, name: `Товар ${index}` })) });
    mount();
    await screen.findByRole('button', { name: 'Добавить: Товар 0' });
    const addButtons = screen.getAllByRole('button', { name: /^Добавить:/ });
    act(() => { for (const button of addButtons) fireEvent.click(button); });
    expect(screen.getAllByRole('textbox', { name: /^Количество:/ })).toHaveLength(100);
    expect(screen.getByRole('button', { name: 'Добавить: Товар 100' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Добавить: Товар 0' })).toBeEnabled();
    expect(screen.getByText('В одной продаже можно выбрать до 100 разных товаров.')).toBeVisible();
    expect(localStorage.getItem(virtualPosPendingKey('employee', branchId))).toBeNull();
  });

  it('blocks totals above the backend limit and becomes valid after reducing quantity', async () => {
    mocks.catalog.mockResolvedValue({ ...baseCatalog, products: [{ ...baseCatalog.products[0], price: 1000000 }] });
    mount(); const user = await buildSale();
    const quantity = screen.getByRole('textbox', { name: 'Количество: Плюшка' });
    await user.clear(quantity); await user.type(quantity, '101');
    expect(screen.getByText('Сумма одной продажи не может превышать 100 000 000 ₸. Уменьшите количество товаров.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Зарегистрировать продажу' })).toBeDisabled();
    expect(localStorage.getItem(virtualPosPendingKey('employee', branchId))).toBeNull();
    await user.clear(quantity); await user.type(quantity, '100');
    expect(screen.getByRole('button', { name: 'Зарегистрировать продажу' })).toBeEnabled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refreshes catalog every 15 seconds without overlapping reads or changing editable sale fields', async () => {
    vi.useFakeTimers();
    const view = mount();
    try {
      await act(async () => {});
      fireEvent.click(screen.getByRole('button', { name: 'Добавить: Плюшка' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Количество: Плюшка' }), { target: { value: '2' } });
      fireEvent.change(screen.getByRole('combobox', { name: 'Тип оплаты в iiko' }), { target: { value: 'cash' } });
      expect(mocks.catalog).toHaveBeenCalledTimes(1);
      let finish!: (value: VirtualPosCatalog) => void;
      mocks.catalog.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
      expect(mocks.catalog).toHaveBeenCalledTimes(2);
      act(() => { window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
      expect(mocks.catalog).toHaveBeenCalledTimes(2);
      await act(async () => { finish(structuredClone(baseCatalog)); });
      expect(screen.getByRole('textbox', { name: 'Количество: Плюшка' })).toHaveValue('2');
      expect(screen.getByRole('combobox', { name: 'Тип оплаты в iiko' })).toHaveValue('cash');
      expect(mocks.create).not.toHaveBeenCalled();
    } finally { view.unmount(); vi.useRealTimers(); }
  });

  it('suspends catalog refresh while an unresolved sale is restored and only checks its result', async () => {
    vi.useFakeTimers();
    const requestId = '33333333-3333-4333-8333-333333333333';
    localStorage.setItem(virtualPosPendingKey('employee', branchId), JSON.stringify({
      request: { requestId, terminalId: 'terminal', snapshotRevision: 'revision-1', cashShiftId: 'shift', paymentTypeId: 'cash', expectedTotal: 500, items: [{ productId: 'bun', quantity: 1 }] },
      cart: [{ productId: 'bun', name: 'Плюшка', quantity: '1', price: 500, unit: 'шт' }],
      branchName: branch.name, paymentName: 'Наличные нефискальные',
    }));
    const view = mount();
    try {
      await act(async () => {});
      expect(mocks.catalog).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(45000); });
      expect(mocks.catalog).toHaveBeenCalledTimes(1);
      expect(mocks.sale).toHaveBeenCalledWith(branchId, requestId);
      expect(screen.getByRole('textbox', { name: 'Количество: Плюшка' })).toHaveValue('1');
      expect(screen.getByRole('textbox', { name: 'Количество: Плюшка' })).toBeDisabled();
      expect(mocks.create).not.toHaveBeenCalled();
    } finally { view.unmount(); vi.useRealTimers(); }
  });

  it.each(['completed', 'queued'] as const)('keeps a newer cross-tab request when an old %s response arrives late', async (status) => {
    const oldId = '33333333-3333-4333-8333-333333333333';
    const nextId = '44444444-4444-4444-8444-444444444444';
    const operation: PendingVirtualPosSale = {
      request: { requestId: oldId, terminalId: 'terminal', snapshotRevision: 'revision-1', cashShiftId: 'shift', paymentTypeId: 'cash', expectedTotal: 500, items: [{ productId: 'bun', quantity: 1 }] },
      cart: [{ productId: 'bun', name: 'Плюшка', quantity: '1', price: 500, unit: 'шт' }],
      branchName: branch.name, paymentName: 'Наличные нефискальные',
    };
    savePendingVirtualPosSale('employee', branchId, operation);
    let finishOld!: (value: { sale: VirtualPosSale }) => void;
    mocks.sale.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    const view = mount();
    await screen.findByText('Продажа обрабатывается в iiko');
    await waitFor(() => expect(mocks.sale).toHaveBeenCalledWith(branchId, oldId));
    const newer: PendingVirtualPosSale = { ...operation,
      request: { ...operation.request, requestId: nextId, expectedTotal: 1000, items: [{ productId: 'bun', quantity: 2 }] },
      cart: [{ ...operation.cart[0], quantity: '2' }],
    };
    // Another tab has begun a new sale; its storage notification can arrive after
    // this tab's already-running request for the previous sale resolves.
    savePendingVirtualPosSale('employee', branchId, newer);
    await act(async () => { finishOld({ sale: { id: oldId, status, total: 500 } }); });
    expect(JSON.parse(localStorage.getItem(virtualPosPendingKey('employee', branchId))!).request.requestId).toBe(nextId);
    expect(screen.getByRole('textbox', { name: 'Количество: Плюшка' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'Количество: Плюшка' })).toBeDisabled();
    expect(screen.queryByText('Продажа зарегистрирована')).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    view.unmount();
    // Even if a concurrent pointer removal occurs, the newer request's own
    // immutable recovery record must survive and be checked after reload.
    localStorage.removeItem(virtualPosPendingKey('employee', branchId));
    mount();
    await screen.findByText('Продажа обрабатывается в iiko');
    if (status === 'completed') await waitFor(() => expect(mocks.sale).toHaveBeenCalledWith(branchId, nextId));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('does not clear a newer cross-tab request when editing an older rejected sale', async () => {
    const oldId = '33333333-3333-4333-8333-333333333333';
    const nextId = '44444444-4444-4444-8444-444444444444';
    const operation: PendingVirtualPosSale = {
      request: { requestId: oldId, terminalId: 'terminal', snapshotRevision: 'revision-1', cashShiftId: 'shift', paymentTypeId: 'cash', expectedTotal: 500, items: [{ productId: 'bun', quantity: 1 }] },
      cart: [{ productId: 'bun', name: 'Плюшка', quantity: '1', price: 500, unit: 'шт' }],
      branchName: branch.name, paymentName: 'Наличные нефискальные',
      sale: { id: oldId, status: 'rejected', total: 500 },
    };
    savePendingVirtualPosSale('employee', branchId, operation);
    mount();
    const edit = await screen.findByRole('button', { name: 'Вернуться к продаже' });
    const newer = { ...operation, request: { ...operation.request, requestId: nextId }, sale: undefined };
    savePendingVirtualPosSale('employee', branchId, newer);
    fireEvent.click(edit);
    await screen.findByText('Продажа обрабатывается в iiko');
    expect(JSON.parse(localStorage.getItem(virtualPosPendingKey('employee', branchId))!).request.requestId).toBe(nextId);
    expect(screen.getByRole('textbox', { name: 'Количество: Плюшка' })).toBeDisabled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
