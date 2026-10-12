import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Gift, Search } from '../../components/BulkaIcons';
import PageState from '../../components/PageState';
import { useFeedback } from '../../components/Feedback';
import { useI18n } from '../../lib/i18n';
import { useSearchParams } from '../../lib/router';
import { loadVoucher, redeemWinner } from './api';
import { Field, winnerStatus } from './Fields';
import type { Voucher } from './model';
import './fortune.css';

export function voucherId(value: string): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const raw = value.trim();
  if (uuid.test(raw)) return raw.toLowerCase();
  try {
    const link = new URL(raw);
    if (!['https:', 'http:'].includes(link.protocol)) return '';
    const id =
      link.searchParams.get('code') ||
      link.searchParams.get('voucher') ||
      link.pathname.split('/').filter(Boolean).at(-1) ||
      '';
    return uuid.test(id) ? id.toLowerCase() : '';
  } catch {
    return '';
  }
}

export default function FortuneRedeemPage({ role = 'viewer' }: { role?: string }) {
  const { locale, formatDate } = useI18n();
  const text = (ru: string, kk: string) => (locale === 'kk' ? kk : ru);
  const { confirm, toast } = useFeedback();
  const [params] = useSearchParams();
  const initialCode = voucherId(params.get('code') || params.get('voucher') || '');
  const [code, setCode] = useState(initialCode),
    [voucher, setVoucher] = useState<Voucher | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const allowed = ['owner', 'admin', 'cashier', 'branch_manager'].includes(role);
  const lookup = async (value: string) => {
    if (!allowed || busy) return;
    const id = voucherId(value);
    requestRef.current?.abort();
    setVoucher(null);
    setError('');
    if (!id) {
      setError(
        text('Введите код приза или ссылку из QR', 'Сыйлық кодын немесе QR сілтемесін енгізіңіз'),
      );
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const result = await loadVoucher(id, controller.signal);
      if (!controller.signal.aborted) setVoucher(result.voucher);
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(
          caught instanceof Error ? caught.message : text('Приз не найден', 'Сыйлық табылмады'),
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    if (initialCode && allowed) {
      setCode(initialCode);
      void lookup(initialCode);
    }
    return () => requestRef.current?.abort();
    // A QR link opens this page with its own code; manual searches remain local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode, allowed]);
  const redeem = async () => {
    if (!voucher || voucher.status !== 'claimed' || voucher.prizeKind !== 'gift' || busy) return;
    const selected = voucher;
    if (
      !(await confirm({
        title: text('Выдать подарок?', 'Сыйлықты беру керек пе?'),
        body: `${selected.customerName || text('Клиент', 'Клиент')} · ${selected.prizeLabel}`,
        confirmLabel: text('Выдать подарок', 'Сыйлықты беру'),
      }))
    )
      return;
    setBusy(true);
    setError('');
    try {
      const result = await redeemWinner(selected.id);
      setVoucher({ ...selected, ...result.winner });
      toast(text('Подарок выдан', 'Сыйлық берілді'));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : text('Не удалось выдать подарок', 'Сыйлық берілмеді'),
      );
    } finally {
      setBusy(false);
    }
  };
  if (!allowed)
    return (
      <PageState
        type="empty"
        title={text('Нет доступа к выдаче призов', 'Сыйлық беруге қолжетімсіз')}
      />
    );
  return (
    <div className="fortune-admin fortune-redemption">
      <header className="fortune-header">
        <div>
          <span className="fortune-eyebrow">Bulka</span>
          <h1>{text('Выдача призов', 'Сыйлықтарды беру')}</h1>
          <p>
            {text(
              'Откройте QR клиента или вставьте код его приза.',
              'Клиенттің QR кодын ашыңыз немесе сыйлық кодын енгізіңіз.',
            )}
          </p>
        </div>
      </header>
      <section className="card fortune-redemption-card">
        <form
          className="fortune-voucher-search"
          onSubmit={(event) => {
            event.preventDefault();
            void lookup(code);
          }}
        >
          <Field label={text('Код приза', 'Сыйлық коды')}>
            <input
              className="input-classic"
              value={code}
              maxLength={2048}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => {
                requestRef.current?.abort();
                setLoading(false);
                setCode(event.target.value);
                setVoucher(null);
                setError('');
              }}
              placeholder={text('Вставьте код или ссылку', 'Кодты немесе сілтемені енгізіңіз')}
            />
          </Field>
          <button type="submit" className="btn-primary" disabled={!code.trim() || loading || busy}>
            <Search size={18} />
            {text('Найти приз', 'Сыйлықты табу')}
          </button>
        </form>
        {loading ? (
          <PageState type="loading" compact />
        ) : voucher ? (
          <div className="fortune-voucher-result" aria-live="polite">
            <span className="fortune-empty-icon">
              {voucher.status === 'redeemed' ? <CheckCircle2 size={30} /> : <Gift size={30} />}
            </span>
            <div>
              <span className={`fortune-status fortune-status-${voucher.status}`}>
                {winnerStatus(voucher.status, text)}
              </span>
              <h2>{voucher.prizeLabel}</h2>
              <p>{voucher.customerName || text('Клиент', 'Клиент')}</p>
              <p>{voucher.branchName}</p>
              <small>
                {voucher.status === 'redeemed'
                  ? text('Подарок уже выдан', 'Сыйлық берілген')
                  : `${text('Действует до', 'Жарамды мерзімі')} ${formatDate(voucher.expiresAt)}`}
              </small>
            </div>
            {voucher.status === 'claimed' && voucher.prizeKind === 'gift' && (
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void redeem()}
              >
                {busy ? text('Сохраняем…', 'Сақталуда…') : text('Выдать подарок', 'Сыйлықты беру')}
              </button>
            )}
          </div>
        ) : (
          !error && (
            <p className="fortune-voucher-hint">
              {text(
                'Клиент найдёт код в разделе «Мои призы».',
                'Клиент кодты «Менің сыйлықтарым» бөлімінен табады.',
              )}
            </p>
          )
        )}
        {error && (
          <div className="fortune-form-error" role="alert">
            {error}
          </div>
        )}
      </section>
    </div>
  );
}
