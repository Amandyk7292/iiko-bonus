import type { AdminOrder } from '../lib/api-types';
import { useI18n } from '../lib/i18n';

export default function OrderAmounts({ order }: { order: AdminOrder }) {
  const { t, formatNumber } = useI18n();
  // Only the fee confirmed at checkout belongs in the customer's payment breakdown.
  const deliveryFee = Number(order.deliveryFee || 0);
  const goodsSubtotal = Math.max(
    0,
    Number((order.amount - deliveryFee + order.discount + (order.bonusSpent || 0)).toFixed(2)),
  );
  const orderType = order.orderType ?? order.fulfillmentType;
  const hasDelivery =
    deliveryFee > 0 ||
    order.effectiveFulfillmentType === 'delivery' ||
    orderType === 'delivery' ||
    (orderType === 'preorder' && order.preorderFulfillmentType === 'delivery');
  const row = (label: string, value: string, strong = false) => (
    <div
      className={`flex items-baseline justify-between gap-4 ${strong ? 'border-t border-stone-200 pt-2 font-semibold' : ''}`}
    >
      <dt className="text-left">{label}</dt>
      <dd className="m-0 whitespace-nowrap">{value}</dd>
    </div>
  );
  return (
    <dl
      className="m-0 grid min-w-40 gap-1 text-sm tabular"
      aria-label={t('orders.amountBreakdown')}
    >
      {row(t('orders.goods'), `${formatNumber(goodsSubtotal)} ₸`)}
      {order.discount > 0 && row(t('orders.discountAmount'), `−${formatNumber(order.discount)} ₸`)}
      {Number(order.bonusSpent || 0) > 0 &&
        row(t('orders.bonusSpent'), `−${formatNumber(order.bonusSpent!)} ₸`)}
      {hasDelivery && row(t('orders.deliveryFee'), `${formatNumber(deliveryFee)} ₸`)}
      {row(t('orders.grandTotal'), `${formatNumber(order.amount)} ₸`, true)}
    </dl>
  );
}
