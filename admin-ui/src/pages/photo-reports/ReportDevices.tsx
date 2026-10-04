import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { RefreshCw, Tablet } from '../../components/BulkaIcons';
import Modal from '../../components/Modal';
import PageState from '../../components/PageState';
import { request } from '../../lib/api';
import { useAdminRealtimeEvents } from '../../lib/admin-realtime';
import type { Branch, PhotoCopy, ReportDevice } from './model';

function codeExpired(device: ReportDevice, now = Date.now()) {
  if (device.status === 'expired') return true;
  if (device.status !== 'pending') return false;
  const expires = device.expiresAt ? Date.parse(device.expiresAt) : NaN;
  return !Number.isFinite(expires) || expires <= now;
}

function DeviceCard({
  device,
  copy,
  now,
  busy,
  onApprove,
  onRevoke,
}: {
  device: ReportDevice;
  copy: PhotoCopy;
  now: number;
  busy: string;
  onApprove: (device: ReportDevice, code: string, name: string) => void;
  onRevoke: (device: ReportDevice) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState(device.name ?? '');
  const [error, setError] = useState('');
  const expired = codeExpired(device, now);
  const status = expired ? 'expired' : device.status;
  const statusLabel = {
    pending: copy.text('Ждёт подтверждения', 'Растауды күтуде'),
    active: copy.text('Подключён', 'Қосылған'),
    revoked: copy.text('Отключён', 'Өшірілген'),
    expired: copy.text('Код истёк', 'Код мерзімі аяқталды'),
  }[status];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (codeExpired(device)) {
      setError(copy.text('На планшете запросите новый код.', 'Планшетте жаңа код сұраңыз.'));
      return;
    }
    if (!/^\d{6}$/.test(code) || !name.trim() || name.trim().length > 80) {
      setError(copy.text('Введите название и 6 цифр с планшета.', 'Атау мен планшеттегі 6 санды енгізіңіз.'));
      return;
    }
    setError('');
    onApprove(device, code, name.trim());
  };
  return (
    <article className={`closing-device-card ${status}`} aria-label={device.name || statusLabel}>
      <div className="closing-device-heading">
        <div className="closing-device-name">
          <span className="closing-device-icon"><Tablet size={21} aria-hidden="true" /></span>
          <strong>{device.name || copy.text('Новый планшет', 'Жаңа планшет')}</strong>
        </div>
        <span className={`closing-device-status ${status}`}>{statusLabel}</span>
      </div>
      {status === 'pending' ? (
        <form className="closing-device-form" onSubmit={submit}>
          <label htmlFor={`device-name-${device.id}`}>
            {copy.text('Название планшета', 'Планшет атауы')}
            <input
              id={`device-name-${device.id}`}
              className="input-classic"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={copy.text('Например, планшет зала', 'Мысалы, зал планшеті')}
              maxLength={80}
              disabled={Boolean(busy)}
              required
            />
          </label>
          <label htmlFor={`device-code-${device.id}`}>
            {copy.text('Код с планшета', 'Планшеттегі код')}
            <input
              id={`device-code-${device.id}`}
              className="input-classic closing-device-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              disabled={Boolean(busy)}
              required
              aria-describedby={`device-hint-${device.id}`}
            />
          </label>
          <p id={`device-hint-${device.id}`} className="closing-device-hint">
            {copy.text('Введите код, открытый на планшете. Он действует 5 минут.', 'Планшетте көрсетілген кодты енгізіңіз. Ол 5 минут жарамды.')}
          </p>
          {error && <p className="closing-device-error" role="alert">{error}</p>}
          <button
            className="btn-primary"
            type="submit"
            disabled={Boolean(busy) || !/^\d{6}$/.test(code) || !name.trim()}
          >
            {busy === device.id
              ? copy.text('Подключаем…', 'Қосылуда…')
              : copy.text('Подключить планшет', 'Планшетті қосу')}
          </button>
        </form>
      ) : status === 'expired' ? (
        <p className="closing-device-hint">
          {copy.text('На планшете запросите новый код.', 'Планшетте жаңа код сұраңыз.')}
        </p>
      ) : (
        <div className="closing-device-footer">
          <dl className="closing-device-dates">
            {device.approvedAt && (
              <div><dt>{copy.text('Подключён', 'Қосылған')}</dt><dd>{copy.timeLabel(device.approvedAt)}</dd></div>
            )}
            <div>
              <dt>{copy.text('Последняя активность', 'Соңғы белсенділік')}</dt>
              <dd>{device.lastSeenAt ? copy.timeLabel(device.lastSeenAt) : copy.text('Нет данных', 'Деректер жоқ')}</dd>
            </div>
          </dl>
          {status === 'active' && (
            <button className="btn-outline" type="button" disabled={Boolean(busy)} onClick={() => onRevoke(device)}>
              {copy.text('Отключить', 'Өшіру')}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function DeviceList({ branch, copy, onChanged }: { branch: Branch; copy: PhotoCopy; onChanged?: () => void }) {
  const [devices, setDevices] = useState<ReportDevice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<ReportDevice | null>(null);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now);
  const query = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const pendingRefresh = useRef(false);
  const refresh = useCallback(() => {
    if (mutation.current) pendingRefresh.current = true;
    else setRevision((value) => value + 1);
  }, []);
  useAdminRealtimeEvents(['photo-reports.updated'], refresh);
  useEffect(() => {
    const controller = new AbortController();
    query.current = controller;
    setLoading(true);
    setError('');
    void request<{ success: boolean; devices: ReportDevice[] }>(
      `/photo-reports/devices?branchId=${encodeURIComponent(branch.id)}`,
      { signal: controller.signal },
      { branchScope: '' },
    ).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.success || !Array.isArray(result.devices) || result.devices.some((device) => device.branchId !== branch.id))
        throw new Error(copy.text('Не удалось загрузить планшеты этой точки.', 'Бұл нүктенің планшеттерін жүктеу мүмкін болмады.'));
      setDevices(result.devices);
      setNow(Date.now());
      onChanged?.();
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted)
        setError(caught instanceof Error ? caught.message : copy.text('Не удалось загрузить планшеты.', 'Планшеттер жүктелмеді.'));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [branch.id, revision, copy, onChanged]);
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    const poll = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(poll, 30000);
    window.addEventListener('online', poll);
    document.addEventListener('visibilitychange', poll);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', poll);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [refresh]);
  useEffect(() => {
    const nextExpiry = Math.min(...(devices ?? []).filter((device) => device.status === 'pending')
      .map((device) => Date.parse(device.expiresAt ?? '')).filter((expires) => expires > Date.now()));
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(nextExpiry - Date.now() + 1, 2147483647));
    return () => window.clearTimeout(timer);
  }, [devices, now]);
  const mutate = async (device: ReportDevice, action: 'approve' | 'revoke', body: object) => {
    if (mutation.current || device.branchId !== branch.id) return;
    const controller = new AbortController();
    mutation.current = controller;
    query.current?.abort();
    setLoading(false);
    setBusy(device.id);
    setMutationError('');
    try {
      const result = await request<{ success: boolean; device: ReportDevice }>(
        `/photo-reports/devices/${encodeURIComponent(device.id)}/${action}`,
        { method: 'POST', body: JSON.stringify(body), signal: controller.signal },
        { branchScope: '' },
      );
      if (controller.signal.aborted) return;
      if (!result.success || result.device?.id !== device.id || result.device.branchId !== branch.id)
        throw new Error(copy.text('Не удалось обновить планшет этой точки.', 'Бұл нүктенің планшетін жаңарту мүмкін болмады.'));
      setDevices((current) => current?.map((item) => item.id === device.id ? result.device : item) ?? [result.device]);
      setNow(Date.now());
      setConfirm(null);
      onChanged?.();
    } catch (caught) {
      if (!controller.signal.aborted) {
        setMutationError(caught instanceof Error ? caught.message : copy.text('Не удалось сохранить изменения.', 'Өзгерістер сақталмады.'));
        pendingRefresh.current = true;
      }
    } finally {
      if (!controller.signal.aborted) {
        mutation.current = null;
        setBusy('');
        if (pendingRefresh.current) {
          pendingRefresh.current = false;
          refresh();
        }
      }
    }
  };
  const history = devices?.filter((device) => device.status === 'revoked' || codeExpired(device, now)) ?? [];
  const current = devices?.filter((device) => device.status !== 'revoked' && !codeExpired(device, now)) ?? [];
  const card = (device: ReportDevice) => (
    <DeviceCard
      key={device.id}
      device={device}
      copy={copy}
      now={now}
      busy={busy}
      onApprove={(item, code, name) => { void mutate(item, 'approve', { code, name }); }}
      onRevoke={(item) => { setMutationError(''); setConfirm(item); }}
    />
  );
  return (
    <>
      <div className="closing-device-list-toolbar">
        <span>{copy.text('Подключённые планшеты и новые запросы', 'Қосылған планшеттер мен жаңа сұраулар')}</span>
        <button className="btn-outline" type="button" aria-label={copy.text('Обновить планшеты', 'Планшеттерді жаңарту')} disabled={loading || Boolean(busy)} onClick={refresh}>
          <RefreshCw size={18} className={loading ? 'spin' : undefined} aria-hidden="true" />
        </button>
      </div>
      {mutationError && !confirm && <p className="closing-device-error" role="alert">{mutationError}</p>}
      {!devices ? (
        error ? <PageState type="error" description={error} compact onRetry={refresh} /> : <PageState type="loading" compact />
      ) : (
        <div className="closing-device-list" aria-busy={loading}>
          {error && <div className="closing-refresh-error" role="alert"><span>{error}</span><button className="btn-outline" type="button" onClick={refresh}>{copy.text('Повторить', 'Қайталау')}</button></div>}
          {!devices.length && <PageState type="empty" title={copy.text('Планшеты ещё не подключены', 'Планшеттер әлі қосылмаған')} description={copy.text('Откройте QR точки на планшете и запросите код.', 'Нүктенің QR кодын планшетте ашып, код сұраңыз.')} compact />}
          {current.map(card)}
          {history.length > 0 && <><h3>{copy.text('История', 'Тарих')}</h3>{history.map(card)}</>}
        </div>
      )}
      <Modal
        open={Boolean(confirm)}
        title={copy.text('Отключить планшет?', 'Планшетті өшіру керек пе?')}
        description={confirm ? `${confirm.name || copy.text('Планшет', 'Планшет')} · ${branch.name} · ${branch.city}` : ''}
        onClose={() => { if (!busy) { setConfirm(null); setMutationError(''); } }}
        size="sm"
        footer={<div className="modal-actions">
          <button className="btn-outline" type="button" disabled={Boolean(busy)} onClick={() => { setConfirm(null); setMutationError(''); }}>{copy.text('Отмена', 'Бас тарту')}</button>
          <button className="btn-primary" type="button" disabled={Boolean(busy)} onClick={() => { if (confirm) void mutate(confirm, 'revoke', {}); }}>{busy ? copy.text('Отключаем…', 'Өшірілуде…') : copy.text('Отключить планшет', 'Планшетті өшіру')}</button>
        </div>}
      >
        <div className="closing-device-confirm">
          <p>{copy.text('Он больше не сможет отправлять фотоотчёты.', 'Ол бұдан былай фотоесептер жібере алмайды.')}</p>
          {mutationError && <p className="closing-device-error" role="alert">{mutationError}</p>}
        </div>
      </Modal>
    </>
  );
}

function DevicesBody({ branches, copy, onChanged }: { branches: Branch[]; copy: PhotoCopy; onChanged?: () => void }) {
  const [cityKey, setCityKey] = useState('');
  const [branchId, setBranchId] = useState('');
  const cities = [...new Set(branches.map((item) => item.city.trim()))].sort((first, second) => first.localeCompare(second));
  const city = cities.find((name) => `city:${name}` === cityKey);
  const cityBranches = city === undefined ? [] : branches.filter((item) => item.city.trim() === city);
  const branch = cityBranches.find((item) => item.id === branchId);
  return (
    <div className="closing-devices">
      <div className="closing-device-scope">
        <div className="closing-device-field">
          <label htmlFor="closing-device-city">{copy.text('Город', 'Қала')}</label>
          <select
            id="closing-device-city"
            className="input-classic"
            value={city === undefined ? '' : cityKey}
            onChange={(event) => {
              setCityKey(event.target.value);
              setBranchId('');
            }}
          >
            <option value="">{copy.text('Выберите город', 'Қаланы таңдаңыз')}</option>
            {cities.map((name) => (
              <option key={`city:${name}`} value={`city:${name}`}>
                {name || copy.text('Без города', 'Қаласы жоқ')}
              </option>
            ))}
          </select>
        </div>
        <div className="closing-device-field">
          <label htmlFor="closing-device-branch">{copy.text('Точка', 'Нүкте')}</label>
          <select
            id="closing-device-branch"
            className="input-classic"
            value={branch?.id ?? ''}
            disabled={city === undefined}
            onChange={(event) => setBranchId(event.target.value)}
          >
            <option value="">{copy.text('Выберите точку', 'Нүктені таңдаңыз')}</option>
            {cityBranches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
      </div>
      {branch ? <DeviceList key={branch.id} branch={branch} copy={copy} onChanged={onChanged} /> : <div className="closing-device-intro"><Tablet size={30} aria-hidden="true" /><p>{copy.text('Выберите город и точку.', 'Қала мен нүктені таңдаңыз.')}</p></div>}
    </div>
  );
}

export default function ReportDevices({ open, branches, onClose, onChanged, copy }: { open: boolean; branches: Branch[]; onClose: () => void; onChanged?: () => void; copy: PhotoCopy }) {
  return (
    <Modal open={open} onClose={onClose} title={copy.text('Планшеты', 'Планшеттер')} size="lg">
      {open && <DevicesBody branches={branches} copy={copy} onChanged={onChanged} />}
    </Modal>
  );
}
