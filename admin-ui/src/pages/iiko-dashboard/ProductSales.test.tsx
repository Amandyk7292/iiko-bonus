import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import ProductSales from './ProductSales';

const mock = vi.hoisted(() => ({
  productSearch: vi.fn(),
  loadControls: vi.fn(),
  exportProductSales: vi.fn(),
}));
vi.mock('./api', () => ({
  dashboardApi: { productSearch: mock.productSearch },
  exportProductSales: mock.exportProductSales,
}));
vi.mock('./load-controls', () => ({ loadControls: mock.loadControls }));

const productId = '2f53ff93-cb20-4325-a8d7-7d13659f4f45';
const props = {
  serverId: 'aktau-chain',
  department: '',
  from: '2026-08-01',
  to: '2026-08-31',
  configured: true,
  refresh: 0,
};
const result = {
  product: { id: productId, name: 'Коже', archived: false },
  city: 'aktau',
  selectedDepartment: '',
  unit: 'шт',
  period: { from: props.from, to: props.to },
  summary: { quantity: 13, net: 6400, gross: 6500 },
  daily: [{ date: '2026-08-01', quantity: 6, net: 2900, gross: 3000 }],
  byDepartment: [
    { department: 'Bulka 16 мкр 85 дом', quantity: 13, net: 6400, gross: 6500 },
    { department: 'Bulka 19А мкр 11дом', quantity: 0, net: 0, gross: 0 },
  ],
  rows: [],
  fetchedAt: '2026-09-23T12:16:12Z',
};
const view = (scope = props) => (
  <I18nProvider>
    <ProductSales {...scope} />
  </I18nProvider>
);

beforeEach(() => {
  localStorage.setItem('adminLocale', 'ru');
  mock.productSearch.mockReset().mockResolvedValue({ products: [result.product] });
  mock.loadControls.mockReset().mockResolvedValue(result);
  mock.exportProductSales.mockReset().mockResolvedValue(undefined);
});

it('finds the iiko product in Kazakh, shows August sales and exports that selection', async () => {
  render(view());
  const download = screen.getByRole('button', { name: 'Скачать Excel' });
  expect(download).toBeDisabled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Товар iiko' }), {
    target: { value: 'көже' },
  });
  fireEvent.click(await screen.findByRole('option', { name: 'Коже' }));
  fireEvent.click(screen.getByRole('button', { name: 'Показать продажи' }));
  await waitFor(() =>
    expect(mock.loadControls).toHaveBeenCalledWith(
      { serverId: 'aktau-chain', from: '2026-08-01', to: '2026-08-31', department: '', productId },
      expect.any(AbortSignal),
      '/iiko-dashboard/product-sales',
    ),
  );
  expect(await screen.findByText('01.08.2026')).toBeVisible();
  expect(screen.getByText('Bulka 16 мкр 85 дом')).toBeVisible();
  await waitFor(() => expect(download).toBeEnabled());
  fireEvent.click(download);
  fireEvent.click(screen.getByRole('button', { name: 'Отчёт по дням' }));
  expect(mock.exportProductSales).toHaveBeenCalledWith(
    expect.objectContaining({
      productId,
      from: '2026-08-01',
      to: '2026-08-31',
    }),
    'daily',
  );
});

it('hides stale results after changing a point and clears the product on city change', async () => {
  const ui = render(view());
  fireEvent.change(screen.getByRole('combobox', { name: 'Товар iiko' }), {
    target: { value: 'Коже' },
  });
  fireEvent.click(await screen.findByRole('option', { name: 'Коже' }));
  fireEvent.click(screen.getByRole('button', { name: 'Показать продажи' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Скачать Excel' })).toBeEnabled());
  ui.rerender(view({ ...props, department: 'Bulka 19А мкр 11дом' }));
  expect(screen.getByRole('button', { name: 'Скачать Excel' })).toBeDisabled();
  ui.rerender(view({ ...props, serverId: 'astana-chain' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Товар iiko' })).toHaveValue(''));
  expect(screen.getByRole('button', { name: 'Показать продажи' })).toBeDisabled();
});

it('keeps selections across searches and exports the full report for the exact selected period', async () => {
  const cinnamon = {
    id: '445d874d-49d0-4a41-b1ef-3d3f845b2c41',
    name: 'Синнабон',
    archived: false,
  };
  const quantities = [
    { unit: 'шт', quantity: 13 },
    { unit: 'кг', quantity: 2 },
  ];
  const summary = { net: 8000, gross: 8250, quantities };
  mock.productSearch.mockImplementation((_server, query) =>
    Promise.resolve({
      products: query === 'Коже' ? [result.product] : [cinnamon],
    }),
  );
  mock.loadControls.mockResolvedValue({
    ...result,
    products: [result.product, cinnamon],
    summary,
    daily: [{ date: '2026-08-01', ...summary }],
    byDepartment: [{ department: 'Bulka 16 мкр 85 дом', ...summary }],
    byProduct: [
      { product: result.product, net: 6400, gross: 6500, quantities: quantities.slice(0, 1) },
      { product: cinnamon, net: 1600, gross: 1750, quantities: quantities.slice(1) },
    ],
  });
  const ui = render(view());
  const search = screen.getByRole('combobox', { name: 'Товар iiko' });
  fireEvent.change(search, { target: { value: 'Коже' } });
  fireEvent.click(await screen.findByRole('option', { name: 'Коже' }));
  fireEvent.change(search, { target: { value: 'Синн' } });
  await screen.findByRole('option', { name: 'Синнабон' });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(screen.getByText('Выбрано товаров 2')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Показать продажи' }));
  expect(await screen.findByRole('heading', { name: 'По товарам' })).toBeVisible();
  const download = screen.getByRole('button', { name: 'Скачать Excel' });
  fireEvent.click(download);
  fireEvent.click(screen.getByRole('button', { name: 'Полный отчёт' }));
  expect(mock.exportProductSales).toHaveBeenCalledWith(
    {
      serverId: props.serverId,
      department: '',
      from: props.from,
      to: props.to,
      productIds: [productId, cinnamon.id],
    },
    'full',
  );
  ui.rerender(view({ ...props, to: '2026-08-30' }));
  expect(download).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Убрать товар Коже' }));
  expect(screen.getByText('Выбрано товаров 1')).toBeVisible();
});
