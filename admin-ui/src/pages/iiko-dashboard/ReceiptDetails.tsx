import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import { useI18n } from '../../lib/i18n';
import { loadControls } from './load-controls';
import { errorKey, type Report } from './model';
import './receipt.css';

const labels: Record<string, [string, string, string]> = {
  check: ['Чек №', 'Чек №', 'Receipt #'],
  product: ['Товар', 'Тауар', 'Product'],
  quantity: ['Количество', 'Саны', 'Quantity'],
  gross: ['До скидки', 'Жеңілдікке дейін', 'Before discount'],
  discount: ['Скидка', 'Жеңілдік', 'Discount'],
  net: ['Итого', 'Барлығы', 'Total'],
  only: ['Только со скидкой', 'Тек жеңілдікпен', 'Discounted items only'],
  empty: [
    'В iiko нет товаров для этого чека',
    'iiko жүйесінде бұл чекке тауарлар табылмады',
    'No items found for this receipt in iiko',
  ],
  cashier: ['Кассир', 'Кассир', 'Cashier'],
};
export default function ReceiptDetails({
  serverId,
  row,
  onClose,
}: {
  serverId: string;
  row: Record<string, unknown>;
  onClose: () => void;
}) {
  const { t, locale, formatNumber } = useI18n();
  const text = (key: string) => labels[key][locale === 'kk' ? 1 : locale === 'en' ? 2 : 0];
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [onlyDiscounts, setOnlyDiscounts] = useState(false);
  const queryKey = JSON.stringify({
    serverId,
    orderId: row['UniqOrderId.Id'],
    date: row['OpenDate.Typed'],
    department: row.Department,
  });
  useEffect(() => {
    const controller = new AbortController();
    setReport(undefined);
    setError('');
    void loadControls<Report>(JSON.parse(queryKey), controller.signal, '/iiko-dashboard/receipt')
      .then((result) => {
        if (!controller.signal.aborted) setReport(result);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorKey(caught));
      });
    return () => controller.abort();
  }, [queryKey, attempt]);
  const money = (value: unknown) =>
    value == null ? '—' : `${formatNumber(Number(value), { maximumFractionDigits: 2 })} ₸`;
  const sum = (field: string) =>
    report?.rows.reduce((total, item) => total + Number(item[field] || 0), 0);
  const items = report?.rows.filter((item) => !onlyDiscounts || Number(item.DiscountSum) > 0);
  return (
    <Modal
      open
      title={`${text('check')} ${row.OrderNum ?? '—'}`}
      description={`${row.Department ?? ''} · ${row.CloseTime ?? ''}`}
      onClose={onClose}
      size="xl"
    >
      <div className="id-receipt">
        <p className="id-receipt-cashier">
          {text('cashier')}: {String(row.Cashier || '—')}
        </p>
        {error ? (
          <div role="alert" className="id-receipt-error">
            <p>{t(error)}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {t('id.refresh')}
            </button>
          </div>
        ) : !report ? (
          <p role="status">{t('id.loading')}</p>
        ) : !report.rows.length ? (
          <p>{text('empty')}</p>
        ) : (
          <>
            <div className="id-receipt-totals">
              {(['gross', 'discount', 'net'] as const).map((label, index) => (
                <div key={label}>
                  <span>{text(label)}</span>
                  <strong>
                    {money(sum(['DishSumInt', 'DiscountSum', 'DishDiscountSumInt'][index]))}
                  </strong>
                </div>
              ))}
            </div>
            <label className="id-receipt-filter">
              <input
                type="checkbox"
                checked={onlyDiscounts}
                onChange={(event) => setOnlyDiscounts(event.target.checked)}
              />
              {text('only')}
            </label>
            <div className="id-receipt-scroll">
              <table className="id-receipt-table">
                <thead>
                  <tr>
                    {['product', 'quantity', 'gross', 'discount', 'net'].map((label) => (
                      <th key={label} scope="col">
                        {text(label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items?.map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.DishName || '—')}</td>
                      <td>
                        {formatNumber(Number(item.DishAmountInt || 0), {
                          maximumFractionDigits: 3,
                        })}{' '}
                        {String(item.DishMeasureUnit || '')}
                      </td>
                      <td>{money(item.DishSumInt)}</td>
                      <td
                        className={Number(item.DiscountSum) > 0 ? 'id-receipt-discount' : undefined}
                      >
                        {money(item.DiscountSum)}
                      </td>
                      <td>{money(item.DishDiscountSumInt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
