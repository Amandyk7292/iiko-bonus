import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useFeedback } from './Feedback';

export default function DeliveryAvailabilityNotice() {
  const [state, setState] = useState<Awaited<
    ReturnType<typeof api.getDeliveryAvailability>
  > | null>(null);
  const [saving, setSaving] = useState(false);
  const { confirm, toast } = useFeedback();
  const load = useCallback(async () => {
    try {
      setState(await api.getDeliveryAvailability());
    } catch {
      /* Keep an existing warning visible. */
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);
  if (!state?.config.disabled) return null;

  const fundsFailure = state.config.reason === 'insufficient_funds';
  const resume = async () => {
    if (saving || !state.config.revision) return;
    const approved = await confirm({
      title: 'Включить доставку для всех клиентов?',
      body: fundsFailure
        ? 'Сначала проверьте в кабинете Яндекса, что пополнение зачислено и средств хватает на доставки. Эта кнопка снимает блокировку, но не проверяет баланс Яндекса.'
        : 'Проверьте в Яндексе отмену проверочного вызова и причину платной или недоступной отмены. Затем можно возобновить оформление доставки.',
      confirmLabel: 'Проверено — включить',
    });
    if (!approved) return;
    setSaving(true);
    try {
      await api.resumeDelivery(state.config.revision);
      await load();
      toast('Доставка включена', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Не удалось включить доставку', 'error');
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="inline-alert inline-alert-warning" role="status">
      <div>
        <strong>Доставка временно отключена для всех клиентов</strong>
        <p>
          {fundsFailure
            ? 'Яндекс сообщил о нехватке средств.'
            : 'Проверочный вызов потребовал платной отмены или проверки в Яндексе.'}{' '}
          Оплата новых заказов с доставкой заблокирована. Самовывоз доступен.
        </p>
        {state.canResume && (
          <button
            className="btn-outline mt-3"
            type="button"
            disabled={saving}
            onClick={() => void resume()}
          >
            {saving
              ? 'Включаем…'
              : fundsFailure
                ? 'Включить после пополнения'
                : 'Включить после проверки'}
          </button>
        )}
      </div>
    </div>
  );
}
