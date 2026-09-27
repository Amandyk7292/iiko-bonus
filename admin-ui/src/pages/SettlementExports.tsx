import { useState } from 'react';
import { request } from '../lib/api';
import { csvCell } from '../lib/csv';
import type { BranchReport, Payout } from './settlements-model';
function download(rows: unknown[][], name: string) {
  const url = URL.createObjectURL(
    new Blob(['\ufeff' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ExportBranches({ rows }: { rows: BranchReport[] }) {
  return (
    <button
      className="btn-outline"
      onClick={() =>
        download(
          [
            [
              'Точка',
              'Город',
              'Заказы',
              'Покупатели',
              'Оплачено',
              'Выполнено',
              'Отменено',
              'С возвратом',
              'Деньги',
              'Возвраты',
              'Осталось денег',
              'Бонусы',
              'Доставка',
              'Скидки',
              'Комиссия Bulka',
              'Сверенный эквайринг',
              'Без сверки',
            ],
            ...rows.map((r) => [
              r.name,
              r.city,
              r.orders,
              r.customers,
              r.paid_orders,
              r.completed_orders,
              r.cancelled_orders,
              r.refunded_orders,
              r.cash,
              r.refunds,
              r.net_cash,
              r.bonuses,
              r.delivery,
              r.discounts,
              r.commission,
              r.acquiring_fee,
              r.unverified,
            ]),
          ],
          'bulka-branches.csv',
        )
      }
    >
      Скачать CSV для Excel
    </button>
  );
}
export function ExportPayout({ payout }: { payout: Payout }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await request<{
        items: { order_id: string; order_number: number; amount: number }[];
      }>(`/transactions/settlements/payouts/${payout.id}`);
      download(
        [
          ['Перевод', payout.bank_reference],
          ['Партнёр', payout.partner],
          ['Точка', payout.branch],
          ['Сумма', Number(payout.amount)],
          ['Заказ', 'ID', 'Сумма распределения'],
          ...r.items.map((i) => [i.order_number, i.order_id, Number(i.amount)]),
        ],
        `payout-${payout.id}.csv`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn-outline" disabled={busy} onClick={() => void run()}>
        {busy ? 'Загрузка…' : 'Заказы выплаты · CSV'}
      </button>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
