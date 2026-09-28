import { useI18n } from '../lib/i18n';
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
  const { t } = useI18n();
  return (
    <button
      className="btn-outline"
      onClick={() =>
        download(
          [
            [
              t('settlements.copy4'),
              t('settlements.copy60'),
              t('settlements.copy61'),
              t('settlements.copy62'),
              t('settlements.copy63'),
              t('settlements.copy64'),
              t('settlements.copy65'),
              t('settlements.copy66'),
              t('settlements.copy67'),
              t('settlements.copy68'),
              t('settlements.copy69'),
              t('settlements.copy17'),
              t('settlements.copy18'),
              t('settlements.copy70'),
              t('settlements.copy20'),
              t('settlements.copy71'),
              t('settlements.copy72'),
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
      {t('settlements.copy59')}
    </button>
  );
}
export function ExportPayout({ payout }: { payout: Payout }) {
  const { t } = useI18n();
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
          [t('settlements.copy73'), payout.bank_reference],
          [t('settlements.copy42'), payout.partner],
          [t('settlements.copy4'), payout.branch],
          [t('settlements.copy55'), Number(payout.amount)],
          [t('settlements.copy74'), 'ID', t('settlements.copy75')],
          ...r.items.map((i) => [i.order_number, i.order_id, Number(i.amount)]),
        ],
        `payout-${payout.id}.csv`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settlements.copy76'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn-outline" disabled={busy} onClick={() => void run()}>
        {busy ? t('settlements.copy6') : t('settlements.copy77')}
      </button>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
