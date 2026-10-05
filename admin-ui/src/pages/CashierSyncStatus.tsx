import { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldAlert } from '../components/BulkaIcons';
import { request } from '../lib/api';
import { useI18n } from '../lib/i18n';
import '../styles/cashier-sync-status.css';

type SyncStatus = {
  state: 'ok' | 'error' | 'stale' | 'never';
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureSince: string | null;
  consecutiveFailures: number;
  cashierCount: number | null;
};
const copy = {
  ru: {
    title: 'База сотрудников', loading: 'Проверяем обновление…',
    updated: 'Обновлена', never: 'Первое обновление ещё не завершено',
    error: 'Не удалось обновить базу сотрудников', stale: 'Обновление базы задерживается',
    unknown: 'Не удалось проверить обновление базы',
    saved: 'Показано последнее успешное обновление. Повторная попытка выполняется автоматически.',
    refresh: 'Проверить состояние', last: 'Последнее обновление',
  },
  kk: {
    title: 'Қызметкерлер базасы', loading: 'Жаңартуды тексеріп жатырмыз…',
    updated: 'Жаңартылды', never: 'Алғашқы жаңарту әлі аяқталған жоқ',
    error: 'Қызметкерлер базасын жаңарту мүмкін болмады', stale: 'Базаны жаңарту кешігуде',
    unknown: 'Базаның жаңартылуын тексеру мүмкін болмады',
    saved: 'Соңғы сәтті жаңарту көрсетілген. Қайта әрекет автоматты түрде орындалады.',
    refresh: 'Күйін тексеру', last: 'Соңғы жаңарту',
  },
};

export default function CashierSyncStatus({ active = true }: { active?: boolean }) {
  const { locale } = useI18n();
  const text = copy[locale === 'kk' ? 'kk' : 'ru'];
  const [status, setStatus] = useState<SyncStatus>();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let pending = false;
    const controller = new AbortController();
    const load = async () => {
      if (disposed || pending || document.visibilityState === 'hidden') return;
      pending = true;
      setLoading(true);
      try {
        const response = await request<{ success: boolean; status: SyncStatus }>(
          '/bonus/cashier-directory-status', { signal: controller.signal }, { branchScope: '' },
        );
        if (!disposed) { setStatus(response.status); setFailed(false); }
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        pending = false;
        if (!disposed) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const refresh = () => void load();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [active, attempt]);
  const warning = failed || Boolean(status && status.state !== 'ok');
  const message = failed ? text.unknown : !status ? text.loading :
    status.state === 'ok' ? text.updated : text[status.state];
  const updated = status?.lastSuccessAt && new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-KZ', {
    timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(status.lastSuccessAt));
  const Icon = warning ? ShieldAlert : CheckCircle2;
  return (
    <section className={`cashier-sync${warning ? ' cashier-sync-warning' : ''}`} aria-label={text.title}>
      <Icon size={20} aria-hidden="true" />
      <div className="cashier-sync-content">
        <div role={warning ? 'alert' : 'status'}><strong>{text.title}</strong><span>{message}</span></div>
        {updated && <small>{text.last}: <time dateTime={status!.lastSuccessAt!}>{updated}</time></small>}
        {warning && status?.lastSuccessAt && <small>{text.saved}</small>}
      </div>
      <button type="button" className="icon-button" aria-label={text.refresh} title={text.refresh}
        disabled={loading} onClick={() => setAttempt((value) => value + 1)}>
        <RefreshCw size={18} aria-hidden="true" />
      </button>
    </section>
  );
}
