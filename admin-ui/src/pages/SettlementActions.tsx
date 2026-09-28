import { useState } from 'react';
import Modal from '../components/GuardedModal';
import SelectControl from '../components/SelectControl';
import { request } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { OrderFinance, Balance } from './settlements-model';
export function ReconcileOrder({
  order,
  onClose,
  onSaved,
}: {
  order: OrderFinance;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { formatNumber, locale, t } = useI18n();
  const kk = locale === 'kk';
  const [fee, setFee] = useState(order.acquiring_fee === null ? '' : String(order.acquiring_fee)),
    [recipient, setRecipient] = useState(order.payment_recipient),
    [reference, setReference] = useState(order.bank_reference || ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await request(`/transactions/settlements/orders/${order.order_id}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({
          fee: Number(fee),
          recipient,
          reference,
          signature: order.current_signature,
        }),
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={`${kk ? 'Төлемді салыстыру' : 'Сверка оплаты'} · #${order.order_number}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-body form-stack">
        <p>
          {order.branch} · {order.partner || 'Bulka'}
        </p>
        <dl className="settlement-details">
          {[
            [t('settlements.reconcile0'), order.cash_amount],
            [t('settlements.reconcile1'), order.cash_refunded],
            [t('settlements.reconcile2'), order.cash_net],
            [t('settlements.reconcile3'), order.bonus_net],
            [t('settlements.reconcile4'), order.delivery_net],
            [t('settlements.reconcile5'), order.platform_commission],
            [t('settlements.reconcile6'), order.bonus_compensation],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{formatNumber(Number(value))} ₸</dd>
            </div>
          ))}
        </dl>
        <p className="field-hint">
          {kk
            ? 'Банк көшірмесімен салыстырыңыз. Бұл әрекет ақша аудармайды.'
            : 'Сверьте оплату, возвраты и комиссию с выпиской FortePay. Получатель ниже — подтверждение по выписке, а не автоматическая проверка банка. Это действие не переводит деньги.'}
        </p>
        <div className="field-group">
          <label htmlFor="reconcile-recipient">{kk ? 'Ақша алушы' : 'Кому поступили деньги'}</label>
          <SelectControl
            id="reconcile-recipient"
            value={recipient}
            onChange={setRecipient}
            options={[
              { value: 'platform', label: 'Bulka' },
              { value: 'partner', label: kk ? 'Серіктеске тікелей' : 'Напрямую партнёру' },
            ]}
          />
        </div>
        <label className="field-group">
          <span>{kk ? 'Эквайринг комиссиясы, ₸' : 'Фактическая комиссия эквайринга, ₸'}</span>
          <input
            className="input-classic"
            type="number"
            min="0"
            max={order.cash_amount}
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
        </label>
        <label className="field-group">
          <span>
            {kk ? 'Банк құжаты / операция нөмірі' : 'Номер банковской операции / документа'}
          </span>
          <input
            className="input-classic"
            value={reference}
            maxLength={200}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        {error && (
          <p className="inline-alert inline-alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="btn-classic"
            disabled={
              busy ||
              fee === '' ||
              Number(fee) < 0 ||
              Number(fee) > Number(order.cash_amount) ||
              reference.trim().length < 3 ||
              order.branch_changed
            }
            onClick={() => void save()}
          >
            {busy ? '…' : kk ? 'Салыстыруды растау' : 'Подтвердить сверку'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
export function RecordPayout({
  balance,
  onClose,
  onSaved,
}: {
  balance: Balance;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { formatNumber, locale, t } = useI18n();
  const kk = locale === 'kk';
  const [id] = useState(() => crypto.randomUUID()),
    [reference, setReference] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await request('/transactions/settlements/payouts', {
        method: 'POST',
        body: JSON.stringify({
          id,
          branch: balance.branch_id,
          partner: balance.partner_id,
          amount: Number(balance.balance),
          reference,
          paidAt: new Date().toISOString(),
        }),
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={kk ? 'Аударымды тіркеу' : 'Зафиксировать перевод'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-body form-stack">
        <p>
          {balance.partner} · {balance.branch}
        </p>
        <strong>{formatNumber(Number(balance.balance))} ₸</strong>
        <p className="field-hint">
          {kk
            ? 'Тек банк арқылы жасалған аударымды растаңыз.'
            : 'Подтвердите только уже выполненный банковский перевод на полную сумму остатка. Система сохранит сумму и список заказов. Деньги автоматически не отправляются.'}
        </p>
        <label className="field-group">
          <span>{kk ? 'Банк аударымының нөмірі' : 'Уникальный номер банковского перевода'}</span>
          <input
            className="input-classic"
            maxLength={200}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <label className="settlement-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>{kk ? 'Аударым орындалды' : 'Перевод выполнен, сумма и получатель проверены'}</span>
        </label>
        {error && (
          <p className="inline-alert inline-alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="btn-classic"
            disabled={busy || !confirmed || reference.trim().length < 3}
            onClick={() => void save()}
          >
            {busy ? '…' : kk ? 'Тіркеу' : 'Зафиксировать выплату'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
