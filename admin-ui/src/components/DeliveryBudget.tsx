import { useCallback, useEffect, useState } from 'react';
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
          <button type="button" className="btn-primary" onClick={() => open('top_up')}>
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
        title={form?.mode === 'top_up' ? 'Учесть пополнение Яндекса' : 'Сверить остаток Яндекса'}
        size="sm"
        description="Укажите сумму, проверенную в кабинете Яндекса. Эта форма обновляет учёт Bulka и не переводит деньги."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <label className="block">
            {form?.mode === 'top_up'
              ? 'Зачислено на счёт, ₸'
              : 'Остаток после расходов, до резервов Bulka, ₸'}
            <input
              className="input mt-2 w-full"
              type="number"
              min="0"
              max="100000000"
              step="0.01"
              required
              value={form?.amount || ''}
              disabled={saving}
              onChange={(event) =>
                setForm((current) =>
                  current ? { ...current, amount: event.target.value } : current,
                )
              }
            />
          </label>
          <p className="text-sm">
            Действующие резервы сохранятся. Запас на каждую доставку: {budget.bufferPercent}%.
          </p>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={saving}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Сумма подтверждена в Яндексе
          </label>
          <button
            type="submit"
            className="btn-primary"
            disabled={!confirmed || saving || !form?.amount.trim()}
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </form>
      </Modal>
    </section>
  );
}
