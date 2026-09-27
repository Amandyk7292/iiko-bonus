import DateInput from '../components/DateInput';
import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { useI18n } from '../lib/i18n';
import Modal from '../components/Modal';

type Branch = {
  id: string;
  name: string;
  city: string;
  active: boolean;
  started: number;
  completed: number;
  pending: number;
  expired: number;
  rank: number;
  url: string;
};
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export default function BranchSignupRace() {
  const { locale } = useI18n();
  const kk = locale === 'kk';
  const [from, setFrom] = useState(() => today().slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Branch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [qr, setQr] = useState<Branch | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrError, setQrError] = useState('');
  const revision = useRef(0);
  const load = useCallback(async () => {
    const current = ++revision.current;
    setBusy(true);
    setError('');
    try {
      const result = await request<{ items: Branch[] }>(`/bonus/branch-race?from=${from}&to=${to}`);
      if (current === revision.current) setRows(result.items);
    } catch (caught) {
      if (current === revision.current) {
        setRows(null);
        setError(caught instanceof Error ? caught.message : 'Не удалось загрузить рейтинг');
      }
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }, [from, to]);
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
    };
  }, [load]);
  return (
    <section className="card settings-form" aria-label={kk ? 'Филиалдар жарысы' : 'Гонка филиалов'}>
      <div className="section-heading">
        <div>
          <h2>{kk ? 'Гонка филиалов · Филиалдар жарысы' : 'Гонка филиалов'}</h2>
          <p>
            {kk
              ? 'Расталған жаңа тіркелу = +1. Сатып алу міндетті емес.'
              : 'Новая завершённая регистрация = +1. Покупка не требуется.'}
          </p>
        </div>
      </div>
      <p className="field-hint">
        {kk
          ? 'Телефон QR бетінде расталады. Клиент сол нөмірмен қолданбаға тіркелгенде, 30 күн ішінде филиалға есептеледі. Рейтинг тіркелу аяқталған күн бойынша есептеледі.'
          : 'Клиент подтверждает телефон на странице QR, затем регистрируется в приложении с тем же номером в течение 30 дней. В рейтинг попадают регистрации, завершённые за выбранный период.'}
      </p>
      <div className="form-grid form-grid-2">
        <div className="field-group">
          <label htmlFor="race-from">{kk ? 'Басталу күні' : 'С даты'}</label>
          <DateInput
            className="input-classic"
            id="race-from"
            type="date"
            required
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="field-group">
          <label htmlFor="race-to">{kk ? 'Аяқталу күні' : 'По дату'}</label>
          <DateInput
            className="input-classic"
            id="race-to"
            type="date"
            required
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </div>
      {error && (
        <p className="inline-alert inline-alert-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn-outline" disabled={busy || !from || !to} onClick={() => void load()}>
        {busy ? (kk ? 'Жүктелуде…' : 'Загрузка…') : kk ? 'Жаңарту' : 'Обновить'}
      </button>
      {rows && !busy && (
        <>
          <p className="field-hint">
            {kk
              ? '«Бастады» — осы кезеңде телефонды растады. «Күтуде» және «Мерзімі өтті» — аяқталмаған тіркелулер. Жеке деректер көрсетілмейді.'
              : '«Начали» — подтвердили телефон в выбранный период. «Ожидают» и «Срок истёк» — незавершённые регистрации из них. Телефоны клиентов не отображаются.'}
          </p>
          <div className="responsive-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {(kk
                    ? ['Орын', 'Филиал', 'Аяқтады', 'Бастады', 'Күтуде', 'Мерзімі өтті', 'Шақыру']
                    : [
                        'Место',
                        'Точка',
                        'Завершили',
                        'Начали',
                        'Ожидают',
                        'Срок истёк',
                        'Приглашение',
                      ]
                  ).map((text) => (
                    <th key={text}>{text}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label={kk ? 'Орын' : 'Место'}>{row.rank}</td>
                    <td data-label={kk ? 'Филиал' : 'Точка'}>
                      <div>
                        <strong>{row.name}</strong>
                        <div className="field-hint">
                          {row.city}
                          {!row.active ? (kk ? ' · Белсенді емес' : ' · Неактивна') : ''}
                        </div>
                      </div>
                    </td>
                    <td data-label={kk ? 'Аяқтады' : 'Завершили'}>
                      <strong>{row.completed}</strong>
                    </td>
                    <td data-label={kk ? 'Бастады' : 'Начали'}>{row.started}</td>
                    <td data-label={kk ? 'Күтуде' : 'Ожидают'}>{row.pending}</td>
                    <td data-label={kk ? 'Мерзімі өтті' : 'Срок истёк'}>{row.expired}</td>
                    <td data-label="QR">
                      <button
                        className="btn-outline"
                        disabled={!row.active}
                        onClick={() => {
                          setQr(row);
                          setCopied(false);
                          setQrError('');
                        }}
                      >
                        QR
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p>{kk ? 'Қолжетімді филиалдар жоқ' : 'Нет доступных точек'}</p>}
          </div>
        </>
      )}
      {qr && (
        <Modal open title={qr.name} onClose={() => setQr(null)}>
          <div className="modal-body qr-invite-body">
            <p>{qr.city}</p>
            <img
              src={`/admin/api/bonus/branch-race/${qr.id}/qr`}
              alt={`QR: ${qr.name}`}
              width="280"
              height="280"
              style={{ display: 'block', maxWidth: '100%', height: 'auto', margin: 'auto' }}
            />
            <p className="field-hint" style={{ overflowWrap: 'anywhere' }}>
              {qr.url}
            </p>
            {qrError && (
              <p className="inline-alert inline-alert-error" role="alert">
                {qrError}
              </p>
            )}
            <div className="modal-actions">
              <a
                className="btn-outline"
                href={`/admin/api/bonus/branch-race/${qr.id}/qr`}
                download={`bulka-${qr.id}.png`}
              >
                {kk ? 'QR жүктеу' : 'Скачать QR'}
              </a>
              <button
                className="btn-classic"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(qr.url);
                    setCopied(true);
                    setQrError('');
                  } catch {
                    setQrError(
                      kk ? 'Сілтемені қолмен көшіріңіз' : 'Скопируйте ссылку вручную из поля выше',
                    );
                  }
                }}
              >
                {copied
                  ? kk
                    ? 'Көшірілді'
                    : 'Скопировано'
                  : kk
                    ? 'Сілтемені көшіру'
                    : 'Копировать ссылку'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
