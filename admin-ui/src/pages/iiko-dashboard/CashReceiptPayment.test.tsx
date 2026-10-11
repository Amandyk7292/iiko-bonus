import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import CashReceiptPayment, { receiptPaymentLabel, type ReceiptPayment } from './CashReceiptPayment';

const cash = {
  id: 'cash',
  name: 'Наличные',
  group: 'Наличные',
  kind: 'cash' as const,
  amount: 900,
};
const card = {
  id: 'card',
  name: 'Банковская карта',
  group: 'Безналичные',
  kind: 'card' as const,
  amount: 500,
};
const payment = (
  methods: ReceiptPayment['methods'],
  values: Partial<ReceiptPayment> = {},
): ReceiptPayment => ({
  status: 'available',
  methods,
  receivedCash: null,
  change: null,
  ...values,
});
const show = (value?: ReceiptPayment, cashier?: string) =>
  render(
    <I18nProvider>
      <CashReceiptPayment payment={value} cashier={cashier} />
    </I18nProvider>,
  );
const row = (label: string) => within(screen.getByText(label).closest('div')!);

describe('receipt payment details', () => {
  beforeEach(() => localStorage.setItem('adminLocale', 'ru'));

  it('shows the cash paid, the actual tendered sum and the actual change separately', () => {
    const value = payment([cash], { receivedCash: 1000, change: 100 });
    show(value, 'Алия');
    expect(receiptPaymentLabel(value)).toBe('Наличные');
    expect(row('Наличные').getByText('900 ₸')).toBeInTheDocument();
    expect(row('Получено наличными').getByText('1 000 ₸')).toBeInTheDocument();
    expect(row('Сдача').getByText('100 ₸')).toBeInTheDocument();
    expect(row('Кассир').getByText('Алия')).toBeInTheDocument();
  });

  it('keeps a genuine zero tendered or change value distinct from missing data', () => {
    show(payment([cash], { receivedCash: 0, change: 0 }));
    expect(row('Получено наличными').getByText('0 ₸')).toBeInTheDocument();
    expect(row('Сдача').getByText('0 ₸')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('does not derive tendered cash or change from the receipt total when iiko omits them', () => {
    show(payment([cash]));
    expect(
      row('Получено наличными').getByLabelText('iiko не передала полученную сумму'),
    ).toHaveTextContent('—');
    expect(row('Сдача').getByLabelText('iiko не передала сумму сдачи')).toHaveAttribute(
      'title',
      'iiko не передала сумму сдачи',
    );
    expect(screen.queryByText('0 ₸')).not.toBeInTheDocument();
  });

  it('shows a card payment without cash tender or change rows', () => {
    const value = payment([card], { receivedCash: 1000, change: 500 });
    show(value);
    expect(receiptPaymentLabel(value)).toBe('Банковская карта');
    expect(row('Банковская карта').getByText('500 ₸')).toBeInTheDocument();
    expect(screen.queryByText('Получено наличными')).not.toBeInTheDocument();
    expect(screen.queryByText('Сдача')).not.toBeInTheDocument();
    expect(screen.queryByText('Кассир')).not.toBeInTheDocument();
  });

  it('identifies mixed payments and keeps every method amount', () => {
    const value = payment([cash, card], { receivedCash: 1000, change: 100 });
    show(value);
    expect(receiptPaymentLabel(value)).toBe('Смешанная оплата');
    expect(row('Наличные').getByText('900 ₸')).toBeInTheDocument();
    expect(row('Банковская карта').getByText('500 ₸')).toBeInTheDocument();
    expect(row('Сдача').getByText('100 ₸')).toBeInTheDocument();
  });

  it('does not call a card payment mixed because an unused cash method has zero amount', () => {
    const value = payment([{ ...cash, amount: 0 }, card]);
    show(value);
    expect(receiptPaymentLabel(value)).toBe('Банковская карта');
    expect(row('Наличные').getByText('0 ₸')).toBeInTheDocument();
    expect(screen.queryByText('Сдача')).not.toBeInTheDocument();
  });

  it.each([undefined, payment([], { status: 'unavailable' }), payment([])])(
    'shows missing payment information without inventing a method or amount (%j)',
    (value) => {
      show(value, 'Кассир');
      expect(receiptPaymentLabel(value)).toBe('Оплата: нет данных');
      expect(screen.getByText('Нет данных')).toBeInTheDocument();
      expect(screen.queryByText(/₸/)).not.toBeInTheDocument();
      expect(screen.queryByText('Сдача')).not.toBeInTheDocument();
    },
  );

  it('keeps another payment type and a zero-valued receipt visible', () => {
    const value = payment([
      { id: 'account', name: 'Личный счёт', group: 'Прочее', kind: 'other', amount: 0 },
    ]);
    show(value);
    expect(receiptPaymentLabel(value)).toBe('Личный счёт');
    expect(row('Личный счёт').getByText('0 ₸')).toBeInTheDocument();
    expect(screen.queryByText('Сдача')).not.toBeInTheDocument();
  });

  it('uses known categories for an unnamed method and rejects nonfinite values', () => {
    const value = payment([{ ...card, name: '' }]);
    show(value);
    expect(receiptPaymentLabel(value)).toBe('Безналичная оплата');
    expect(row('Безналичная оплата').getByText('500 ₸')).toBeInTheDocument();
    expect(receiptPaymentLabel(payment([{ ...cash, amount: Number.NaN }]))).toBe(
      'Оплата: нет данных',
    );
  });
});
