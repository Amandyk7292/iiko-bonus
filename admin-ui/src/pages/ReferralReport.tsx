import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Gift, LoaderCircle, Monitor, RefreshCw, Search } from 'lucide-react';
import { request, type PosHealthResponse } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Link } from '../lib/router';
import Modal from '../components/Modal';
import '../styles/bonus-page.css';

type Invitation = {
  id: string; created_at: string; status: string; review_state: string; risk_reasons: string[];
  rewarded_at: string | null; reversed_at: string | null; branch_name: string | null;
  purchased_at: string | null; reward_referrer: number; reward_friend: number; last_error: string | null;
  first_purchase_source: string; amount: number; refunded_amount: number; owner_name: string | null;
  friend_name: string | null; owner_id: string; referred_customer_id: string;
  reviewed_at: string | null; reviewed_by: string | null; review_note: string | null;
};
type Report = {
  summary: Record<string, number>;
  branches: { branch_id: string | null; name: string; invitations: number; purchases: number; revenue: number; rewards: number }[];
  items: Invitation[]; canReview: boolean; pos: PosHealthResponse | null; posError: boolean;
  health?: { delayed: number; pendingNotifications: number; failedNotifications: number;
    items: { id: string; purchased_at: string; branch_name: string | null; last_error: string | null }[] };
};
const copy = {
  ru: { invitations: 'Приглашения', registers: 'Состояние касс', details: 'Подробности', extra: 'Остальные показатели', branches: 'По точкам', allDates: 'Все даты', delayed: 'Задержки начислений', queue: 'Уведомления в очереди', failed: 'Ошибки отправки', monitor: 'Начисления и уведомления', clear: 'Без задержек', rewardError: 'Ошибка начисления', dates: 'Выберите корректный период', search: 'Найти кассу или точку', all: 'Все кассы', attention: 'Требуют внимания', unavailable: 'Данные касс недоступны', empty: 'Кассы не подключены', issues: 'Нерешённые ошибки', diagnostics: 'Диагностика', printer: 'Принтер', connected: 'Связь с главной кассой', incompatible: 'Несовместимая версия', unknown: 'Нет данных', device: 'Касса', noResults: 'Кассы не найдены', cohort: 'По дате регистрации', reviewed: 'Решение', purchase: 'Первая покупка', yes: 'Есть', no: 'Нет' },
  kk: { invitations: 'Шақырулар', registers: 'Касса күйі', details: 'Толығырақ', extra: 'Қалған көрсеткіштер', branches: 'Нүктелер бойынша', allDates: 'Барлық күндер', delayed: 'Есептеу кідірістері', queue: 'Кезектегі хабарламалар', failed: 'Жіберу қателері', monitor: 'Есептеулер мен хабарламалар', clear: 'Кідіріс жоқ', rewardError: 'Есептеу қатесі', dates: 'Дұрыс кезеңді таңдаңыз', search: 'Кассаны немесе нүктені табу', all: 'Барлық кассалар', attention: 'Назар аудару керек', unavailable: 'Касса деректері қолжетімсіз', empty: 'Кассалар қосылмаған', issues: 'Шешілмеген қателер', diagnostics: 'Диагностика', printer: 'Принтер', connected: 'Бас кассамен байланыс', incompatible: 'Үйлеспейтін нұсқа', unknown: 'Деректер жоқ', device: 'Касса', noResults: 'Кассалар табылмады', cohort: 'Тіркелу күні бойынша', reviewed: 'Шешім', purchase: 'Алғашқы сатып алу', yes: 'Бар', no: 'Жоқ' },
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export default function ReferralReport({ view = 'referrals', scope = '' }: { view?: 'referrals' | 'health'; scope?: string }) {
  const { t, locale, formatDate, formatNumber } = useI18n();
  const text = copy[locale === 'kk' ? 'kk' : 'ru'];
  const [from, setFrom] = useState(() => today().slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [pagination, setPagination] = useState({ scope, offset: 0 });
  const offset = pagination.scope === scope ? pagination.offset : 0;
  const setOffset = (value: number) => setPagination({ scope, offset: value });
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [review, setReview] = useState<Invitation | null>(null);
  const [note, setNote] = useState('');
  const [returning, setReturning] = useState(false);
  const [returnTotal, setReturnTotal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('all');
  const revision = useRef(0);
  const scopeRevision = useRef(0);
  useEffect(() => {
    scopeRevision.current++;
    setPagination({ scope, offset: 0 });
    setReview(null);
    setNote('');
    setError('');
    setReturning(false);
    setReturnTotal(0);
    setSaving(false);
  }, [scope]);
  const valid = validDate(from) && validDate(to) && from <= to;
  const amount = (value: number) => formatNumber(Number(value || 0), { maximumFractionDigits: 2 });
  const load = useCallback(async () => {
    const current = ++revision.current;
    setError('');
    if (!valid) { setLoading(false); setData(null); return; }
    setLoading(true);
    try {
      const result = await request<Report>(`/bonus/referrals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&offset=${offset}`, {}, { branchScope: scope });
      if (current === revision.current) setData(result);
    } catch (caught) {
      if (current === revision.current) { setData(null); setError(caught instanceof Error ? caught.message : t('common.loadError')); }
    } finally { if (current === revision.current) setLoading(false); }
  }, [from, to, offset, valid, t, scope]);
  useEffect(() => { void load(); return () => { revision.current++; }; }, [load]);
  const decide = async (action: 'approve' | 'reject' | 'return') => {
    if (!review || saving || note.trim().length < 3) return;
    const currentScope = scopeRevision.current;
    setSaving(true); setError('');
    try {
      await request(`/bonus/referrals/${review.id}/review`, { method: 'POST', body: JSON.stringify({ action, note: note.trim(), ...(action === 'return' ? { total: returnTotal } : {}) }) }, { branchScope: scope });
      if (currentScope === scopeRevision.current) { setReview(null); setNote(''); await load(); }
    } catch (caught) { if (currentScope === scopeRevision.current) setError(caught instanceof Error ? caught.message : t('common.error')); }
    finally { if (currentScope === scopeRevision.current) setSaving(false); }
  };
  const metrics = (entries: [string, number, boolean?][]) => <dl className="bonus-metrics">{entries.map(([label, value, currency]) => <div key={label}><dt>{label}</dt><dd>{amount(value)}{currency ? ' ₸' : ''}</dd></div>)}</dl>;
  const warning = (label: string, value: number, currency = false) => value > 0 && <span className="bonus-pill bonus-pill-warning"><AlertTriangle size={14} aria-hidden="true" />{label}: {amount(value)}{currency ? ' ₸' : ''}</span>;
  const openCases = data?.pos?.cases?.filter((item) => ['open', 'retrying'].includes(item.status)) || [];
  const devices = data?.pos?.devices.filter((device) => {
    const matches = `${device.name} ${device.branch?.name || ''} ${device.branch?.city || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    return matches && (deviceFilter === 'all' || (deviceFilter === 'offline' ? !device.online : device.health !== 'healthy' || device.outdated || device.incompatible || Boolean(device.lastError) || Object.values(device.queues).some((value) => value > 0)));
  }) || [];
  return <section className="card bonus-report" aria-label={view === 'health' ? text.registers : text.invitations}>
    <header className="bonus-section-heading">
      <span className="bonus-heading-icon" aria-hidden="true">{view === 'health' ? <Monitor size={23} /> : <Gift size={23} />}</span>
      <div><h2>{view === 'health' ? text.registers : text.invitations}</h2><p>{view === 'health' ? text.allDates : text.cohort}</p></div>
      <button className="icon-button" type="button" aria-label={t('referrals.refresh')} title={t('referrals.refresh')} disabled={loading || !valid} onClick={() => void load()}><RefreshCw size={18} className={loading ? 'spin' : ''} aria-hidden="true" /></button>
    </header>
    {view === 'referrals' && <div className="bonus-date-filters">
      <label className="field-group"><span className="field-label">{t('referrals.from')}</span><input className="input-classic" type="date" required value={from} max={to} onChange={(e) => { setOffset(0); setFrom(e.target.value); }} /></label>
      <label className="field-group"><span className="field-label">{t('referrals.to')}</span><input className="input-classic" type="date" required value={to} min={from} onChange={(e) => { setOffset(0); setTo(e.target.value); }} /></label>
    </div>}
    {!valid && <p className="inline-alert" role="alert">{text.dates}</p>}
    {error && !review && <div className="inline-alert inline-alert-error" role="alert">{error}<button className="btn-outline" type="button" onClick={() => void load()}>{t('common.retry')}</button></div>}
    {loading && <div className="bonus-empty" role="status"><LoaderCircle size={24} className="spin" aria-hidden="true" />{t('common.loading')}</div>}
    {data && !loading && (view === 'referrals' ? <>
      {metrics([[t('referrals.invitations'), data.summary.invitations], [t('referrals.purchases'), data.summary.purchases], [t('referrals.revenue'), data.summary.revenue, true], [t('referrals.awarded'), data.summary.awarded, true]])}
      <div className="bonus-warning-row">{warning(t('referrals.review'), data.summary.review)}{warning(text.delayed, data.summary.delayed)}{warning(t('referrals.debt_created'), data.summary.debt_created, true)}</div>
      <details className="bonus-details"><summary>{text.extra}</summary>{metrics([[t('referrals.reversed'), data.summary.reversed, true], [t('referrals.debt_created'), data.summary.debt_created, true], [t('referrals.review'), data.summary.review], [text.delayed, data.summary.delayed]])}</details>
      {data.branches.length > 0 && <details className="bonus-details"><summary>{text.branches}<span className="bonus-count">{data.branches.length}</span></summary><p className="field-hint">{t('referrals.scope')}</p><table className="data-table bonus-branch-table"><thead><tr>{['branch', 'invitations', 'purchases', 'revenue', 'rewards'].map((key) => <th key={key}>{t(`referrals.${key}`)}</th>)}</tr></thead><tbody>{data.branches.map((branch) => <tr key={branch.branch_id || 'none'}>{(['name', 'invitations', 'purchases', 'revenue', 'rewards'] as const).map((key, index) => <td key={key} data-label={t(`referrals.${['branch', 'invitations', 'purchases', 'revenue', 'rewards'][index]}`)}>{key === 'name' ? branch[key] : `${amount(branch[key])}${index > 2 ? ' ₸' : ''}`}</td>)}</tr>)}</tbody></table></details>}
      <div className="bonus-list-heading"><h3>{t('referrals.list')}</h3><span className="bonus-count">{amount(data.summary.invitations)}</span></div>
      {!data.items.length && <div className="bonus-empty"><Gift size={27} aria-hidden="true" /><p>{t('referrals.empty')}</p></div>}
      <div className="bonus-invitations">{data.items.map((item) => {
        const status = item.reversed_at ? 'reversed' : item.review_state === 'pending' ? 'review' : item.purchased_at && item.status === 'registered' ? 'qualified' : item.status;
        return <article className="bonus-invitation" key={item.id}>
          <header><div className="bonus-invitation-people"><strong>{item.owner_name || '—'}</strong><ArrowRight size={16} aria-label={t('referrals.friend')} /><strong>{item.friend_name || '—'}</strong></div><span className={`bonus-pill ${['review', 'qualified'].includes(status) ? 'bonus-pill-warning' : status === 'rewarded' ? 'bonus-pill-success' : ''}`}>{t(`referrals.status.${status}`)}</span></header>
          <p className="bonus-caption">{formatDate(item.created_at)} · {item.branch_name || t('referrals.unassigned')}</p>
          <details className={`bonus-details ${item.last_error || item.risk_reasons.length ? 'bonus-details-warning' : ''}`}><summary>{item.last_error ? text.rewardError : text.details}{item.risk_reasons.length > 0 && <span className="bonus-count">{item.risk_reasons.length}</span>}</summary>
            {item.risk_reasons.map((reason) => <p className="bonus-warning-text" key={reason}>{t(`referrals.risk.${reason}`)}</p>)}
            {item.last_error && <p className="bonus-warning-text">{item.last_error}</p>}
            <dl className="bonus-detail-list"><div><dt>ID</dt><dd>{item.id}</dd></div><div><dt>{t('referrals.inviter')}</dt><dd>{item.owner_id}</dd></div><div><dt>{t('referrals.friend')}</dt><dd>{item.referred_customer_id}</dd></div><div><dt>{text.purchase}</dt><dd>{item.purchased_at ? `${formatDate(item.purchased_at)} · ${amount(item.amount)} ₸` : '—'}</dd></div><div><dt>{t('referrals.rewards')}</dt><dd>{amount(item.reward_referrer)} + {amount(item.reward_friend)} ₸</dd></div></dl>
            {item.reviewed_at && <p>{text.reviewed}: {item.review_note} · {item.reviewed_by} · {formatDate(item.reviewed_at)}</p>}
          </details>
          <div className="action-cluster">{item.review_state === 'pending' && data.canReview && <button className="btn-outline" type="button" onClick={() => { setReturning(false); setReview(item); setNote(''); setError(''); }}>{t('referrals.inspect')}</button>}{item.first_purchase_source === 'pos' && !item.reversed_at && data.canReview && <button className="btn-outline" type="button" onClick={() => { setReturning(true); setReturnTotal(Number(item.amount)); setReview(item); setNote(''); setError(''); }}>{t('referrals.recordReturn')}</button>}</div>
        </article>;
      })}</div>
      {data.summary.invitations > 0 && <div className="bonus-pagination"><button className="btn-outline" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>{t('referrals.previous')}</button><span>{data.items.length ? offset + 1 : 0}–{offset + data.items.length} / {amount(data.summary.invitations)}</span><button className="btn-outline" type="button" disabled={offset + data.items.length >= data.summary.invitations} onClick={() => setOffset(offset + 50)}>{t('referrals.next')}</button></div>}
    </> : <>
      {data.health && <section className="bonus-monitor" aria-label={text.monitor}><div className="bonus-list-heading"><h3>{text.monitor}</h3>{data.health.delayed + data.health.pendingNotifications + data.health.failedNotifications === 0 && <span className="bonus-pill bonus-pill-success"><CheckCircle2 size={14} aria-hidden="true" />{text.clear}</span>}</div>
        {(data.health.delayed > 0 || data.health.pendingNotifications > 0 || data.health.failedNotifications > 0 || data.health.items.length > 0) && <details className="bonus-details bonus-details-warning"><summary><AlertTriangle size={17} aria-hidden="true" />{text.details}<span className="bonus-count">{data.health.delayed + data.health.pendingNotifications + data.health.failedNotifications}</span></summary>{metrics([[text.delayed, data.health.delayed], [text.queue, data.health.pendingNotifications], [text.failed, data.health.failedNotifications]])}<p className="field-hint">{t('referrals.monitorHint')}</p>{data.health.items.map((item) => <article className="bonus-issue" key={item.id}><strong>{item.branch_name || t('referrals.unassigned')}</strong><time>{formatDate(item.purchased_at)}</time><p>{item.last_error || t('referrals.status.qualified')}</p><small>{item.id}</small></article>)}</details>}
      </section>}
      {data.posError && <p className="inline-alert inline-alert-error" role="alert">{t('referrals.posError')}</p>}
      {!data.pos && !data.posError && <div className="bonus-empty"><Monitor size={27} aria-hidden="true" /><p>{text.unavailable}</p></div>}
      {data.pos && <>
        {metrics([[t('referrals.online'), data.pos.summary.online], [t('referrals.offline'), Math.max(0, data.pos.summary.total - data.pos.summary.online)], [text.attention, data.pos.summary.attention]])}
        {(data.pos.summary.openCases > 0 || openCases.length > 0) && <details className="bonus-details bonus-details-warning"><summary><AlertTriangle size={17} aria-hidden="true" />{text.issues}<span className="bonus-count">{Math.max(data.pos.summary.openCases, openCases.length)}</span></summary>{openCases.map((item) => <article className="bonus-issue" key={item.id}><strong>{item.title}</strong><p>{item.details}</p><small>{item.severity} · {item.status} · {formatDate(item.last_seen_at)}</small></article>)}<Link className="btn-outline" to="/integrations">{text.diagnostics}<ArrowRight size={16} aria-hidden="true" /></Link></details>}
        {data.pos.devices.length > 0 ? <>
          <div className="bonus-device-filters"><label className="input-with-icon"><Search size={18} aria-hidden="true" /><input className="input-classic" aria-label={text.search} placeholder={text.search} value={search} onChange={(event) => setSearch(event.target.value)} /></label><select className="input-classic" aria-label={text.device} value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}><option value="all">{text.all}</option><option value="attention">{text.attention}</option><option value="offline">{t('referrals.offline')}</option></select></div>
          <div className="bonus-device-list">{devices.map((device) => {
            const good = device.online && device.health === 'healthy' && !device.lastError && !device.outdated && !device.incompatible && !Object.values(device.queues).some((value) => value > 0);
            return <article className="bonus-device" key={`${device.branchId}:${device.id}`}><header><div><strong>{device.branch?.name || t('referrals.unassigned')}</strong><p className="bonus-caption">{device.name}{device.branch?.city ? ` · ${device.branch.city}` : ''}</p></div><span className={`bonus-pill ${good ? 'bonus-pill-success' : 'bonus-pill-warning'}`}>{!device.online ? t('referrals.offline') : good ? t('referrals.online') : t('referrals.attention')}</span></header>
              <div className="bonus-device-meta"><span>{t('referrals.connection')}: {device.lastSeenAt ? formatDate(device.lastSeenAt) : '—'}</span><div className="bonus-warning-row">{device.outdated && <span className="bonus-pill bonus-pill-warning">{t('referrals.outdated')}</span>}{device.incompatible && <span className="bonus-pill bonus-pill-warning">{text.incompatible}</span>}</div></div>
              <details className={`bonus-details ${good ? '' : 'bonus-details-warning'}`}><summary>{text.details}</summary>{device.lastError && <p className="bonus-warning-text">{device.lastError}</p>}<dl className="bonus-detail-list"><div><dt>{t('referrals.version')}</dt><dd>{device.pluginVersion || '—'}</dd></div><div><dt>{t('referrals.sync')}</dt><dd>{device.health === 'healthy' ? t('referrals.ok') : device.health === 'unknown' ? text.unknown : t('referrals.attention')}</dd></div>{Object.entries(device.queues).filter(([, value]) => Number(value) > 0).map(([key, value]) => <div key={key}><dt>{t(`referrals.queue.${key}`)}</dt><dd>{amount(value)}</dd></div>)}<div><dt>{text.printer}</dt><dd>{device.printerStatus}</dd></div><div><dt>{text.connected}</dt><dd>{device.connectedToMain == null ? text.unknown : device.connectedToMain ? text.yes : text.no}</dd></div></dl>{Object.keys(device.statuses).length > 0 && <p>{Object.entries(device.statuses).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>}<Link className="btn-outline" to="/integrations">{text.diagnostics}<ArrowRight size={16} aria-hidden="true" /></Link></details>
            </article>;
          })}</div>
          {!devices.length && <div className="bonus-empty">{text.noResults}</div>}
        </> : <div className="bonus-empty"><Monitor size={27} aria-hidden="true" /><p>{text.empty}</p></div>}
      </>}
    </>)}
    {review && <Modal open title={t(returning ? 'referrals.recordReturn' : 'referrals.inspect')} onClose={() => { if (!saving) setReview(null); }}>
      <p>{t(returning ? 'referrals.returnHint' : 'referrals.reviewHint')}</p>
      {error && <p className="inline-alert inline-alert-error" role="alert">{error}</p>}
      {!returning && review.risk_reasons.map((reason) => <p className="bonus-warning-text" key={reason}>{t(`referrals.risk.${reason}`)}</p>)}
      {returning && <label className="field-group"><span className="field-label">{t('referrals.returnTotal')}</span><input className="input-classic" type="number" min={Math.max(0.01, Number(review.refunded_amount || 0))} max={review.amount} step="0.01" value={returnTotal} onChange={(e) => setReturnTotal(Number(e.target.value))} /></label>}
      <label className="field-group"><span className="field-label">{t('referrals.note')}</span><textarea className="input-classic" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="action-cluster"><button className="btn-classic" type="button" disabled={saving || note.trim().length < 3 || (!returning && review.risk_reasons.some((reason) => ['shared_device', 'missing_device'].includes(reason))) || (returning && (!Number.isFinite(returnTotal) || returnTotal <= 0 || returnTotal > Number(review.amount) || returnTotal < Number(review.refunded_amount)))} onClick={() => void decide(returning ? 'return' : 'approve')}>{saving ? t('common.saving') : t(returning ? 'referrals.recordReturn' : 'referrals.approve')}</button>{!returning && <button className="btn-outline" type="button" disabled={saving || note.trim().length < 3} onClick={() => void decide('reject')}>{t('referrals.reject')}</button>}</div>
    </Modal>}
  </section>;
}
