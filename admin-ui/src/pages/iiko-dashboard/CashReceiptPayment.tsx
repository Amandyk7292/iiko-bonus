import { useI18n } from '../../lib/i18n';

export type ReceiptPayment = {
  status: 'available' | 'unavailable';
  methods: {
    id: string;
    name: string;
    group: string;
    kind: 'cash' | 'card' | 'other';
    amount: number;
  }[];
  receivedCash: number | null;
  change: number | null;
};

type Method = ReceiptPayment['methods'][number];
const methodName = (method: Method) =>
  method.name.trim() ||
  (method.kind === 'cash'
    ? 'Наличные'
    : method.kind === 'card'
      ? 'Безналичная оплата'
      : method.group.trim() || 'Другая оплата');

const availableMethods = (payment?: ReceiptPayment) =>
  payment?.status === 'available'
    ? payment.methods.filter((method) => Number.isFinite(method.amount))
    : [];

export function receiptPaymentLabel(payment?: ReceiptPayment) {
  const methods = availableMethods(payment);
  const paidMethods = methods.filter((method) => method.amount !== 0);
  if (paidMethods.length > 1) return 'Смешанная оплата';
  const method = paidMethods[0] || (methods.length === 1 ? methods[0] : undefined);
  return method ? methodName(method) : 'Оплата: нет данных';
}

export default function CashReceiptPayment({
  payment,
  cashier,
}: {
  payment?: ReceiptPayment;
  cashier?: string;
}) {
  const { formatNumber } = useI18n();
  const methods = availableMethods(payment);
  const hasCash = methods.some((method) => method.kind === 'cash' && method.amount !== 0);
  const cashValue = (value: number | null | undefined, explanation: string) =>
    typeof value === 'number' && Number.isFinite(value) ? (
      `${formatNumber(value)} ₸`
    ) : (
      <span title={explanation} aria-label={explanation}>
        —
      </span>
    );
  return (
    <section className="id-check-payment" aria-label="Оплата чека">
      <h3>Оплата</h3>
      {!methods.length && <p className="id-check-payment-missing">Нет данных</p>}
      <dl>
        {methods.map((method, index) => (
          <div key={`${method.id}-${index}`}>
            <dt>{methodName(method)}</dt>
            <dd>{formatNumber(method.amount)} ₸</dd>
          </div>
        ))}
        {hasCash && (
          <>
            <div className="id-check-payment-cash">
              <dt>Получено наличными</dt>
              <dd>{cashValue(payment?.receivedCash, 'iiko не передала полученную сумму')}</dd>
            </div>
            <div>
              <dt>Сдача</dt>
              <dd>{cashValue(payment?.change, 'iiko не передала сумму сдачи')}</dd>
            </div>
          </>
        )}
        {cashier?.trim() && (
          <div className="id-check-payment-cashier">
            <dt>Кассир</dt>
            <dd>{cashier}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
