import { useI18n } from '../lib/i18n';
import type { Drill } from './SettlementDetails';
import type { BranchReport } from './settlements-model';
export default function BranchOrderCards({
  branches,
  onDrill,
}: {
  branches: BranchReport[];
  onDrill: (drill: Drill) => void;
}) {
  const { t, formatNumber } = useI18n();
  const money = (value: number) => `${formatNumber(Number(value))} ₸`;
  return (
    <div className="branch-order-cards">
      {branches.map((b) => (
        <article className="branch-order-card" key={b.branch_id || 'none'}>
          <header>
            <h3>{b.name}</h3>
            <span>{b.city}</span>
          </header>
          <dl className="branch-order-counts">
            {[
              ['settlements.simple.orders', b.orders],
              ['settlements.simple.buyers', b.customers],
              ['settlements.simple.paid', b.paid_orders],
              ['settlements.simple.completed', b.completed_orders],
              ['settlements.simple.cancelled', b.cancelled_orders],
              ['settlements.simple.refunded', b.refunded_orders],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{t(String(label))}</dt>
                <dd>
                  <button
                    className="settlement-count-link"
                    aria-label={`${t(String(label))}: ${value} · ${b.name}`}
                    onClick={() =>
                      onDrill({
                        branch: b.branch_id || '00000000-0000-0000-0000-000000000000',
                        metric: String(label).split('.').pop()!,
                        name: b.name,
                      })
                    }
                  >
                    {formatNumber(Number(value))}
                  </button>
                </dd>
              </div>
            ))}
          </dl>
          <dl className="branch-order-money">
            <div>
              <dt>{t('settlements.simple.received')}</dt>
              <dd>{money(b.cash)}</dd>
            </div>
            <div>
              <dt>{t('settlements.simple.returned')}</dt>
              <dd>{money(b.refunds)}</dd>
            </div>
            <div className="branch-order-net">
              <dt>{t('settlements.simple.remaining')}</dt>
              <dd>{money(b.net_cash)}</dd>
            </div>
          </dl>
          <details>
            <summary>{t('settlements.simple.details')}</summary>
            <dl className="branch-order-details">
              {[
                ['settlements.copy17', b.bonuses],
                ['settlements.auto.customerDelivery', b.delivery],
                ['settlements.auto.deliveryCost', b.delivery_actual_cost ?? 0],
                ['settlements.auto.deliveryNet', b.delivery_net_cost ?? 0],
                ['settlements.copy19', b.discounts],
                ['settlements.copy20', b.commission],
                ['settlements.simple.bankFee', b.acquiring_fee],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{t(String(label))}</dt>
                  <dd>{money(Number(value))}</dd>
                </div>
              ))}
            </dl>
            {!!b.delivery_unknown && <p>{t('settlements.auto.deliveryUnknown')}</p>}
            {b.unverified > 0 && (
              <p>{t('settlements.simple.unverified', { count: b.unverified })}</p>
            )}
            <p className="field-hint">{t('settlements.simple.moneyNote')}</p>
          </details>
        </article>
      ))}
    </div>
  );
}
