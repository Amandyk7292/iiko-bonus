import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import CashierCatalogPage from './CashierCatalogPage';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  refresh: () => {},
}));
vi.mock('../lib/api', () => ({
  api: { getCashierCatalog: mocks.load, updateCashierProduct: mocks.save },
}));
vi.mock('../components/Feedback', () => ({
  useFeedback: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));
vi.mock('../lib/admin-realtime', () => ({
  useAdminRealtime: () => ({ connectionStatus: 'online' }),
  useAdminRealtimeEvents: (_: string[], refresh: () => void) => {
    mocks.refresh = refresh;
  },
}));
const product = {
  id: 'bun',
  name: 'Плюшка',
  price: 35,
  imageUrl: '',
  category: 'Выпечка',
  sourceQuantity: 5,
  availableQuantity: 3,
  reserved: 2,
  manualStop: false,
  revision: 1,
  blockedBy: null,
};
let current = { ...product };
beforeEach(() => {
  vi.clearAllMocks();
  current = { ...product };
  mocks.confirm.mockResolvedValue(true);
  mocks.load.mockImplementation(async () => ({
    branchId: 'branch',
    branch: { name: 'ЖК Дукат', address: '17-й микрорайон, 1' },
    products: [{ ...current }],
  }));
  mocks.save.mockImplementation(async (_id, changes) => {
    current = { ...current, ...changes, revision: current.revision + 1 };
  });
});
it('does not save quantity or stop changes when the cashier cancels confirmation', async () => {
  mocks.confirm.mockResolvedValue(false);
  mount();
  const user = userEvent.setup();
  await screen.findByText('Плюшка');
  await user.click(screen.getByRole('switch'));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.getByRole('switch')).not.toBeChecked();
  const input = screen.getByRole('textbox', { name: 'Остаток: Плюшка' });
  await user.clear(input);
  await user.type(input, '7');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() =>
    expect(mocks.confirm).toHaveBeenLastCalledWith({
      title: 'Сохранить изменения?',
      body: 'Плюшка\nОстаток: 5 → 7',
      confirmLabel: 'Сохранить',
    }),
  );
  expect(mocks.save).not.toHaveBeenCalled();
  expect(input).toHaveValue('7');
});
it('combines category and search for a large catalog', async () => {
  mocks.load.mockResolvedValue({
    branchId: 'branch',
    branch: { name: 'ЖК Дукат' },
    products: [
      product,
      ...Array.from({ length: 119 }, (_, i) => ({
        ...product,
        id: `dessert-${i}`,
        category: 'Десерты',
        name: `Десерт ${i}`,
      })),
    ],
  });
  mount();
  const user = userEvent.setup();
  await screen.findByText('Плюшка');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Категория' }), 'Десерты');
  expect(screen.queryByText('Плюшка')).not.toBeInTheDocument();
  await user.type(screen.getByRole('textbox', { name: 'Поиск товара' }), 'Десерт 118');
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByText('Десерт 118')).toBeVisible();
});
it('returns manual stock to Front only after confirmation', async () => {
  mocks.load.mockResolvedValue({
    branchId: 'branch',
    branch: { name: 'ЖК Дукат' },
    frontSync: { configured: true, connected: true },
    products: [{ ...product, stockSource: 'manual', isIikoProduct: true, frontQuantity: 3 }],
  });
  mocks.confirm.mockResolvedValue(false);
  mount();
  const user = userEvent.setup();
  const button = await screen.findByRole('button', { name: /Вернуть iikoFront/ });
  await user.click(button);
  expect(mocks.save).not.toHaveBeenCalled();
  mocks.confirm.mockResolvedValue(true);
  await user.click(button);
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith('bun', { expectedRevision: 1, useIiko: true }),
  );
});
function mount() {
  return render(
    <I18nProvider>
      <CashierCatalogPage />
    </I18nProvider>,
  );
}
it('saves only the changed field and updates the stop switch after confirmation', async () => {
  mount();
  const user = userEvent.setup();
  const input = await screen.findByRole('textbox', { name: 'Остаток: Плюшка' });
  await user.clear(input);
  await user.type(input, '7');
  expect(screen.getByRole('switch', { name: 'Стоп-лист: Плюшка' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith('bun', { expectedRevision: 1, sourceQuantity: 7 }),
  );
  await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
  await user.click(screen.getByRole('switch'));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenLastCalledWith('bun', { expectedRevision: 2, manualStop: true }),
  );
  await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());
});
it('live updates keep an edited quantity and prevent overwriting a newer count', async () => {
  mount();
  const user = userEvent.setup();
  const input = await screen.findByRole('textbox', { name: 'Остаток: Плюшка' });
  await user.clear(input);
  await user.type(input, '8');
  current = { ...current, sourceQuantity: 2, availableQuantity: 0, revision: 2 };
  act(() => mocks.refresh());
  await screen.findByText(/Остаток изменился/);
  expect(input).toHaveValue('8');
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Сбросить: Плюшка' }));
  expect(input).toHaveValue('2');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('keeps the product visible on save failure and filters the stop list', async () => {
  mocks.save.mockRejectedValue(new Error('Нет связи с сервером'));
  mount();
  const user = userEvent.setup();
  await screen.findByText('Плюшка');
  await user.click(screen.getByRole('switch'));
  await screen.findByText('Нет связи с сервером');
  expect(screen.getByRole('switch')).not.toBeChecked();
  await user.click(
    within(screen.getByLabelText('Фильтр товаров')).getByRole('button', { name: /Стоп-лист/ }),
  );
  expect(await screen.findByText('В стоп-листе нет товаров')).toBeVisible();
});
