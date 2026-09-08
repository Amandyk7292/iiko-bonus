import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import { loadControls } from './load-controls';
import ReceiptDetails from './ReceiptDetails';
vi.mock('./load-controls', () => ({ loadControls: vi.fn() }));
const row = {
  OrderNum: 287,
  Department: 'Branch',
  CloseTime: '15.08.2026, 21:17',
  'OpenDate.Typed': '2026-08-15',
  'UniqOrderId.Id': 'ce7f0801-b8a7-4918-ab37-53b437ee4e82',
  Cashier: 'Cashier',
};
it('loads unique receipt, filters discounted items without changing totals and closes by Escape', async () => {
  vi.mocked(loadControls).mockResolvedValue({
    rows: [
      {
        DishName: 'Плюшка',
        DishAmountInt: 2,
        DishMeasureUnit: 'шт',
        DishSumInt: 200,
        DiscountSum: 50,
        DishDiscountSumInt: 150,
      },
      {
        DishName: 'Чай',
        DishAmountInt: 1,
        DishMeasureUnit: 'шт',
        DishSumInt: 100,
        DiscountSum: 0,
        DishDiscountSumInt: 100,
      },
    ],
  });
  const close = vi.fn();
  const view = render(
    <I18nProvider>
      <ReceiptDetails serverId="astana-chain" row={row} onClose={close} />
    </I18nProvider>,
  );
  expect(await screen.findByText('Плюшка')).toBeVisible();
  expect(screen.getByText('Чай')).toBeVisible();
  expect(screen.getByText('250 ₸')).toBeVisible();
  expect(vi.mocked(loadControls).mock.calls[0][0]).toEqual({
    serverId: 'astana-chain',
    date: '2026-08-15',
    orderId: row['UniqOrderId.Id'],
    department: 'Branch',
  });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Только со скидкой' }));
  expect(screen.queryByText('Чай')).toBeNull();
  expect(screen.getByText('250 ₸')).toBeVisible();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
  const signal = vi.mocked(loadControls).mock.calls[0][1];
  view.unmount();
  expect(signal.aborted).toBe(true);
});
it('aborts pending lookup on close without showing a late result', async () => {
  vi.mocked(loadControls)
    .mockClear()
    .mockImplementation(() => new Promise(() => {}));
  const view = render(
    <I18nProvider>
      <ReceiptDetails serverId="astana-chain" row={row} onClose={() => {}} />
    </I18nProvider>,
  );
  await waitFor(() => expect(loadControls).toHaveBeenCalledOnce());
  const signal = vi.mocked(loadControls).mock.calls[0][1];
  view.unmount();
  expect(signal.aborted).toBe(true);
});
