import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  QrCode,
  RefreshCw,
  Search,
} from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { request } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAdminRealtimeEvents } from '../lib/admin-realtime';
import './PhotoReportsPage.css';

type Kind = 'hall' | 'baker';
interface Branch {
  id: string;
  name: string;
  city: string;
  active?: boolean;
}
interface Photo {
  id: string;
  available: boolean;
  expiresAt: string;
  url: string | null;
}
interface Report {
  id: string;
  branchId: string;
  date: string;
  kind: Kind;
  photoCount: number;
  submittedAt: string;
  photos?: Photo[];
}
interface Calendar {
  businessDate: string;
  from: string;
  to: string;
  branches: Branch[];
  reports: Report[];
}
interface Detail {
  branch: Branch;
  date: string;
  reports: Report[];
}
const kinds: Kind[] = ['hall', 'baker'];
const currentBusinessDate = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10);
const key = (branch: string, date: string, kind: Kind) => `${branch}/${date}/${kind}`;
function datesBetween(from: string, to: string) {
  const dates: string[] = [];
  for (
    const date = new Date(`${from}T12:00:00Z`);
    date.toISOString().slice(0, 10) <= to;
    date.setUTCDate(date.getUTCDate() + 1)
  )
    dates.push(date.toISOString().slice(0, 10));
  return dates;
}

export default function PhotoReportsPage({ role = 'viewer' }: { role?: string }) {
  const { locale, t } = useI18n();
  const text = (ru: string, kk: string) => (locale === 'kk' ? kk : ru);
  const kindLabel = (kind: Kind) =>
    kind === 'hall' ? text('Зал', 'Зал') : text('Пекарь', 'Наубайшы');
  const dateLabel = (date: string, long = false) =>
    new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-KZ', {
      day: '2-digit',
      month: long ? 'long' : '2-digit',
      ...(long ? { year: 'numeric' as const } : {}),
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`));
  const timeLabel = (date: string) =>
    new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-KZ', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Almaty',
    }).format(new Date(date));
  const [end, setEnd] = useState(currentBusinessDate);
  const [days, setDays] = useState(14);
  const [data, setData] = useState<Calendar | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [city, setCity] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selection, setSelection] = useState<{ branch: Branch; date: string; kind: Kind } | null>(
    null,
  );
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [activePhoto, setActivePhoto] = useState(0);
  const [qrBranch, setQrBranch] = useState<Branch | null>(null);
  const [qrImage, setQrImage] = useState('');
  const [qrError, setQrError] = useState('');
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  const canIssueQr = ['owner', 'admin', 'branch_manager'].includes(role);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    request<Calendar>(`/photo-reports?end=${end}&days=${days}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [end, days, revision]);
  useAdminRealtimeEvents(['photo-reports.updated'], refresh);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    setDetail(null);
    setDetailError('');
    setActivePhoto(0);
    if (!selection) return;
    const controller = new AbortController();
    request<Detail>(`/photo-reports/branches/${selection.branch.id}?date=${selection.date}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setDetailError(caught.message);
      });
    return () => controller.abort();
  }, [selection?.branch.id, selection?.date, revision]);
  useEffect(() => {
    setQrImage('');
    setQrError('');
    if (!qrBranch) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await request<{ url: string }>(`/photo-reports/branches/${qrBranch.id}/qr`, {
          method: 'POST',
          body: '{}',
          signal: controller.signal,
        });
        const qr = await import('qrcode');
        const image = await qr.toDataURL(result.url, {
          width: 640,
          margin: 3,
          errorCorrectionLevel: 'M',
        });
        if (!controller.signal.aborted) setQrImage(image);
      } catch (caught) {
        if (!controller.signal.aborted)
          setQrError(caught instanceof Error ? caught.message : t('common.loadError'));
      }
    })();
    return () => controller.abort();
  }, [qrBranch, t]);

  const reports = useMemo(
    () => new Map(data?.reports.map((r) => [key(r.branchId, r.date, r.kind), r])),
    [data],
  );
  const calendarDays = data ? datesBetween(data.from, data.to) : [];
  const matchingBranches = (data?.branches ?? []).filter(
    (branch) =>
      (!city || branch.city === city) &&
      `${branch.name} ${branch.city}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase().trim()),
  );
  const countSubmitted = (branch: Branch) =>
    kinds.filter((kind) => reports.has(key(branch.id, data?.to ?? end, kind))).length;
  const branches = matchingBranches.filter(
    (branch) =>
      status === 'all' ||
      (status === 'complete' ? countSubmitted(branch) === 2 : countSubmitted(branch) < 2),
  );
  const selectedReport = detail?.reports.find((r) => r.kind === selection?.kind);
  const availablePhotos =
    selectedReport?.photos?.filter((photo) => photo.available && photo.url) ?? [];

  return (
    <div className="closing-reports">
      <div className="closing-heading">
        <div>
          <h1>{text('Фотоотчёты точек', 'Нүктелердің фотоесептері')}</h1>
          <p>{text('Закрытие смены: зал и пекарь.', 'Ауысымды жабу: зал және наубайшы.')}</p>
        </div>
        <button className="btn-outline" type="button" onClick={refresh} disabled={loading}>
          <RefreshCw size={17} aria-hidden="true" /> {t('common.refresh')}
        </button>
      </div>
      <div className="closing-filters card">
        <label>
          {text('Дата отчёта', 'Есеп күні')}
          <input
            className="input-classic"
            type="date"
            value={end}
            max={data?.businessDate ?? currentBusinessDate()}
            onChange={(e) => {
              if (e.target.value) setEnd(e.target.value);
            }}
          />
        </label>
        <label>
          {text('Показать', 'Көрсету')}
          <select
            className="input-classic"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[7, 14, 31].map((n) => (
              <option key={n} value={n}>
                {n} {text('дней', 'күн')}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text('Город', 'Қала')}
          <select className="input-classic" value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">{text('Все города', 'Барлық қалалар')}</option>
            {[...new Set(data?.branches.map((b) => b.city))].sort().map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="closing-search">
          {text('Точка', 'Нүкте')}
          <span>
            <Search size={17} aria-hidden="true" />
            <input
              className="input-classic"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={text('Название или город', 'Атауы немесе қала')}
            />
          </span>
        </label>
      </div>
      {loading && !data ? (
        <PageState type="loading" />
      ) : error ? (
        <PageState type="error" description={error} onRetry={refresh} />
      ) : (
        data && (
          <>
            <div
              className="closing-summary"
              aria-label={text('Итоги на выбранную дату', 'Таңдалған күннің қорытындысы')}
            >
              <div className="card">
                <span>{text('Оба отчёта отправлены', 'Екі есеп те жіберілді')}</span>
                <strong className="closing-green">
                  {matchingBranches.filter((b) => countSubmitted(b) === 2).length}
                  <small> / {matchingBranches.length}</small>
                </strong>
              </div>
              <div className="card">
                <span>{text('Нет отчёта зала', 'Зал есебі жоқ')}</span>
                <strong>
                  {matchingBranches.filter((b) => !reports.has(key(b.id, data.to, 'hall'))).length}
                </strong>
              </div>
              <div className="card">
                <span>{text('Нет отчёта пекаря', 'Наубайшы есебі жоқ')}</span>
                <strong>
                  {matchingBranches.filter((b) => !reports.has(key(b.id, data.to, 'baker'))).length}
                </strong>
              </div>
            </div>
            <section className="card closing-calendar" aria-busy={loading}>
              <div className="closing-calendar-heading">
                <div>
                  <h2>{dateLabel(data.to, true)}</h2>
                  <div className="closing-legend">
                    <span>
                      <i className="closing-dot done" />
                      {text('Отправлен', 'Жіберілді')}
                    </span>
                    <span>
                      <i className="closing-dot" />
                      {text('Не отправлен', 'Жіберілмеді')}
                    </span>
                  </div>
                </div>
                <label>
                  <span className="sr-only">{text('Статус точек', 'Нүктелер күйі')}</span>
                  <select
                    className="input-classic"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="all">{text('Все точки', 'Барлық нүктелер')}</option>
                    <option value="missing">
                      {text('Не всё отправлено', 'Толық жіберілмеді')}
                    </option>
                    <option value="complete">{text('Всё отправлено', 'Бәрі жіберілді')}</option>
                  </select>
                </label>
              </div>
              {!branches.length ? (
                <PageState
                  type="empty"
                  title={text('Точек с такими условиями нет', 'Бұл шарттарға сай нүктелер жоқ')}
                  compact
                />
              ) : (
                <div
                  className="closing-table-scroll"
                  tabIndex={0}
                  aria-label={text('Календарь отправки отчётов', 'Есеп жіберу күнтізбесі')}
                >
                  <table className="closing-table">
                    <thead>
                      <tr>
                        <th className="closing-branch-col" scope="col">
                          {text('Точка / отчёт', 'Нүкте / есеп')}
                        </th>
                        {calendarDays.map((date) => (
                          <th
                            scope="col"
                            key={date}
                            className={date === data.to ? 'closing-selected-date' : ''}
                          >
                            <span>{dateLabel(date)}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {branches.map((branch) =>
                        kinds.map((kind, index) => (
                          <tr
                            key={`${branch.id}/${kind}`}
                            className={index === 0 ? 'closing-branch-start' : ''}
                          >
                            <th scope="row" className="closing-branch-col">
                              {index === 0 && (
                                <div className="closing-branch-title">
                                  <div>
                                    <strong>{branch.name}</strong>
                                    <small>
                                      {branch.city}
                                      {branch.active === false
                                        ? text(' · Неактивна', ' · Белсенді емес')
                                        : ''}
                                    </small>
                                  </div>
                                  {canIssueQr && branch.active !== false && (
                                    <button
                                      type="button"
                                      className="icon-button"
                                      aria-label={`${text('QR для', 'QR:')} ${branch.name}`}
                                      title={text('QR точки', 'Нүкте QR-ы')}
                                      onClick={() => setQrBranch(branch)}
                                    >
                                      <QrCode size={19} aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                              )}
                              <span className="closing-kind">{kindLabel(kind)}</span>
                            </th>
                            {calendarDays.map((date) => {
                              const report = reports.get(key(branch.id, date, kind));
                              const label = `${branch.city} · ${branch.name} · ${kindLabel(kind)} · ${dateLabel(date, true)} · ${report ? text(`Отправлен · ${report.photoCount} фото`, `Жіберілді · ${report.photoCount} фото`) : text('Не отправлен', 'Жіберілмеді')}`;
                              return (
                                <td
                                  key={date}
                                  className={date === data.to ? 'closing-selected-date' : ''}
                                >
                                  <button
                                    type="button"
                                    className={`closing-cell ${report ? 'done' : ''}`}
                                    aria-label={label}
                                    title={label}
                                    onClick={() => {
                                      setDetail(null);
                                      setDetailError('');
                                      setActivePhoto(0);
                                      setSelection({ branch, date, kind });
                                    }}
                                  >
                                    <span>
                                      {report ? (
                                        <Check size={16} strokeWidth={3} aria-hidden="true" />
                                      ) : (
                                        '—'
                                      )}
                                    </span>
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="closing-note">
                {text(
                  'Нажмите на ячейку, чтобы открыть отчёт. До 04:00 снимки относятся к предыдущему дню. Фото хранятся 3 дня, история отправки — постоянно.',
                  'Есепті ашу үшін ұяшықты басыңыз. 04:00-ге дейінгі суреттер алдыңғы күнге жатады. Фото 3 күн, жіберу тарихы тұрақты сақталады.',
                )}
              </p>
            </section>
          </>
        )
      )}
      <Modal
        open={Boolean(selection)}
        onClose={() => setSelection(null)}
        title={selection?.branch.name ?? ''}
        description={
          selection ? `${selection.branch.city} · ${dateLabel(selection.date, true)}` : ''
        }
        size="lg"
      >
        {selection && (
          <>
            <div
              className="segmented-control closing-kind-tabs"
              role="group"
              aria-label={text('Вид отчёта', 'Есеп түрі')}
            >
              {kinds.map((kind) => (
                <button
                  type="button"
                  key={kind}
                  aria-pressed={selection.kind === kind}
                  className={selection.kind === kind ? 'is-active' : ''}
                  onClick={() => {
                    setActivePhoto(0);
                    setSelection({ ...selection, kind });
                  }}
                >
                  {kindLabel(kind)}
                </button>
              ))}
            </div>
            {detailError ? (
              <PageState type="error" description={detailError} onRetry={refresh} />
            ) : !detail ? (
              <PageState type="loading" />
            ) : !selectedReport ? (
              <PageState
                type="empty"
                title={text('Отчёт не отправлен', 'Есеп жіберілмеді')}
                description={text(
                  'Сотрудник точки ещё не отправил этот отчёт.',
                  'Нүкте қызметкері бұл есепті әлі жібермеді.',
                )}
              />
            ) : (
              <>
                <div className="closing-submitted">
                  <Check size={20} aria-hidden="true" />
                  <div>
                    <strong>{text('Отчёт отправлен', 'Есеп жіберілді')}</strong>
                    <span>
                      {timeLabel(selectedReport.submittedAt)} · {selectedReport.photoCount}{' '}
                      {text('фото', 'фото')}
                    </span>
                  </div>
                </div>
                {availablePhotos.length ? (
                  <>
                    <div className="closing-photo-viewer">
                      <img
                        src={
                          availablePhotos[Math.min(activePhoto, availablePhotos.length - 1)].url!
                        }
                        alt={`${kindLabel(selection.kind)} · ${activePhoto + 1}`}
                        onError={(e) => {
                          e.currentTarget.alt = text(
                            'Фото недоступно. Обновите отчёт.',
                            'Фото қолжетімсіз. Есепті жаңартыңыз.',
                          );
                        }}
                      />
                      {availablePhotos.length > 1 && (
                        <div className="closing-photo-controls">
                          <button
                            className="icon-button"
                            type="button"
                            aria-label={text('Предыдущее фото', 'Алдыңғы фото')}
                            onClick={() =>
                              setActivePhoto(
                                (v) => (v - 1 + availablePhotos.length) % availablePhotos.length,
                              )
                            }
                          >
                            <ChevronLeft aria-hidden="true" />
                          </button>
                          <span>
                            {activePhoto + 1} / {availablePhotos.length}
                          </span>
                          <button
                            className="icon-button"
                            type="button"
                            aria-label={text('Следующее фото', 'Келесі фото')}
                            onClick={() => setActivePhoto((v) => (v + 1) % availablePhotos.length)}
                          >
                            <ChevronRight aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="closing-photo-thumbs">
                      {availablePhotos.map((photo, index) => (
                        <button
                          key={photo.id}
                          type="button"
                          aria-label={`${text('Фото', 'Фото')} ${index + 1}`}
                          aria-pressed={activePhoto === index}
                          className={activePhoto === index ? 'is-active' : ''}
                          onClick={() => setActivePhoto(index)}
                        >
                          <img loading="lazy" src={photo.url!} alt="" />
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="closing-expired">
                    <strong>
                      {text('Срок хранения фото истёк', 'Фото сақтау мерзімі аяқталды')}
                    </strong>
                    <p>
                      {text(
                        'Снимки удаляются через 3 дня. Дата отправки и количество фото сохранены в истории.',
                        'Суреттер 3 күннен кейін жойылады. Жіберілген күні мен фото саны тарихта сақталады.',
                      )}
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Modal>
      <Modal
        open={Boolean(qrBranch)}
        onClose={() => setQrBranch(null)}
        title={text('QR для фотоотчётов', 'Фотоесептерге арналған QR')}
        description={qrBranch ? `${qrBranch.name} · ${qrBranch.city}` : ''}
        size="sm"
      >
        {qrError ? (
          <PageState
            type="error"
            description={qrError}
            onRetry={() => setQrBranch((branch) => (branch ? { ...branch } : null))}
          />
        ) : !qrImage ? (
          <PageState type="loading" />
        ) : (
          <div className="closing-qr">
            <img
              src={qrImage}
              alt={text('QR-код точки для фотоотчётов', 'Нүктенің фотоесептерге арналған QR-коды')}
              width="280"
              height="280"
            />
            <p>
              {text(
                'Разместите QR на точке. Сотрудник сканирует его планшетом, выбирает зал или пекаря и снимает фото.',
                'QR-ды нүктеге орналастырыңыз. Қызметкер планшетпен сканерлеп, залды немесе наубайшыны таңдайды да фото түсіреді.',
              )}
            </p>
            <a
              className="btn-primary"
              href={qrImage}
              download={`Bulka-QR-${qrBranch?.name.replace(/[^\p{L}\p{N} _-]/gu, '')}.png`}
            >
              <Download size={17} aria-hidden="true" />
              {text('Скачать QR', 'QR жүктеу')}
            </a>
          </div>
        )}
      </Modal>
    </div>
  );
}
