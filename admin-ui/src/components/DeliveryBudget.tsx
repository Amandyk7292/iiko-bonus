import { useCallback, useEffect, useId, useState } from 'react';
import { request } from '../lib/api';
import Modal from './Modal';
import { useFeedback } from './Feedback';

type Budget = {
  balance: number;
  reserved: number;
  available: number;
  bufferPercent: number;
  revision: number;
  attentionCount: number;
};
type Adjustment = {
  requestId: string;
  revision: number;
  mode: 'top_up' | 'balance';
  amount: string;
};
const money = (value: number) => `${Number(value).toLocaleString('ru-RU')} ₸`;

export default function DeliveryBudget() {
  const formId = useId();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [form, setForm] = useState<Adjustment | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useFeedback();
  const load = useCallback(async () => {
    try {
      const next = await request<Budget>('/orders/delivery-budget');
      setBudget(next);
      return next;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [load]);
  if (!budget) return null;

  const open = (mode: Adjustment['mode']) => {
    setConfirmed(false);
    setForm({
      mode,
      requestId: crypto.randomUUID(),
      revision: budget.revision,
      amount: mode === 'balance' ? String(budget.balance) : '',
    });
  };
  const save = async () => {
    if (
      !form ||
      saving ||
      !confirmed ||
      form.amount.trim() === '' ||
      !Number.isFinite(Number(form.amount)) ||
      Number(form.amount) < 0
    )
      return;
    setSaving(true);
    try {
      const updated = await request<Budget>('/orders/delivery-budget', {
        method: 'PUT',
        body: JSON.stringify({ ...form, amount: Number(form.amount), confirmed }),
      });
      setBudget(updated);
      setForm(null);
      toast('Бюджет доставки обновлён', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Не удалось обновить бюджет', 'error');
      const next = await load();
      if (next) setForm((current) => (current ? { ...current, revision: next.revision } : current));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="card mb-4 p-4" aria-label="Бюджет доставки">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <strong>Бюджет доставки</strong>
          <div className="mt-2 flex flex-wrap gap-6 text-sm">
            <span>
              Остаток: <b>{money(budget.balance)}</b>
            </span>
            <span>
              В резерве: <b>{money(budget.reserved)}</b>
            </span>
            <span>
              Доступно: <b>{money(budget.available)}</b>
            </span>
          </div>
          {budget.available <= 0 && (
            <p className="mt-2 text-sm">
              Новые заказы с доставкой недоступны до освобождения резерва или пополнения.
            </p>
          )}
          {budget.attentionCount > 0 && (
            <p className="mt-2 text-sm">
              Требуют проверки результата оплаты: {budget.attentionCount}. Резерв сохранён.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-classic" onClick={() => open('top_up')}>
            Учесть пополнение
          </button>
          <button type="button" className="btn-outline" onClick={() => open('balance')}>
            Сверить остаток
          </button>
        </div>
      </div>
      <Modal
        open={form !== null}
        onClose={() => {
          if (!saving) setForm(null);
        }}
        title={form?.mode === 'top_up' ? 'Учесть пополнение' : 'Сверить остаток'}
        size="sm"
        description="Обновляет учёт доставки в Bulka. Деньги не переводятся."
        footer={
          <div className="modal-actions">
            <button
              type="button"
              className="btn-outline"
              disabled={saving}
              onClick={() => setForm(null)}
            >
              Отмена
            </button>
            <button
              type="submit"
              form={formId}
              className="btn-classic"
              disabled={!confirmed || saving || !form?.amount.trim()}
            >
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        }
      >
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="modal-body form-stack"
        >
          <label className="field-group">
            <span className="field-label">
              {form?.mode === 'top_up' ? 'Сумма пополнения, ₸' : 'Остаток в Яндексе, ₸'}
            </span>
            <input
              className="input-classic"
              type="number"
              inputMode="decimal"
              min="0"
              max="100000000"
              step="0.01"
              required
              aria-describedby={`${formId}-amount-hint`}
              value={form?.amount || ''}
              disabled={saving}
              onChange={(event) =>
                setForm((current) =>
                  current ? { ...current, amount: event.target.value } : current,
                )
              }
            />
            <span className="field-hint" id={`${formId}-amount-hint`}>
              {form?.mode === 'top_up'
                ? 'Сумма, уже зачисленная на счёт Яндекса.'
                : 'Текущий остаток после расходов, до вычета резервов Bulka.'}
            </span>
          </label>
          <p className="delivery-budget-hint">
            Действующие резервы сохранятся. Запас на каждую доставку: {budget.bufferPercent}%.
          </p>
          <label className="delivery-budget-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={saving}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>Сумма подтверждена в Яндексе</span>
          </label>
        </form>
      </Modal>
    </section>
  );
}
