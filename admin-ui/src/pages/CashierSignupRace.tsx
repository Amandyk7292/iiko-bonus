import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, QrCode, RefreshCw, Search, Trophy, Users, Wallet } from '../components/BulkaIcons';
import Modal from '../components/Modal';
import { request } from '../lib/api';
import { useI18n } from '../lib/i18n';
import '../styles/cashier-signup-race.css';

export type CashierRaceItem = {
  id: string;
  name: string;
  branchName: string;
  city: string;
  completed: number;
  rewardAmount: number;
  rank: number;
  isArchived: boolean;
  inviteToken: string | null;
  url: string | null;
};
type RaceResponse = {
  success: boolean;
  items: CashierRaceItem[];
  totals: { completed: number; rewardAmount: number };
};

const copy = {
  ru: {
    heading: 'Гонка кассиров',
    hint: '300 ₸ за завершённую регистрацию',
    from: 'С даты',
    to: 'По дату',
    city: 'Город',
    allCities: 'Все города',
    search: 'Найти кассира',
    registrations: 'Регистрации',
    reward: 'К зарплате',
    cashier: 'Кассир',
    rank: 'Место',
    archive: 'В архиве',
    refresh: 'Обновить рейтинг',
    loading: 'Загружаем рейтинг…',
    retry: 'Повторить',
    loadError: 'Не удалось загрузить рейтинг',
    rangeError: 'Выберите начальную и конечную даты',
    empty: 'Кассиры не найдены',
    download: 'Скачать QR',
    copy: 'Копировать ссылку',
    copied: 'Скопировано',
    qrError: 'Не удалось загрузить QR',
    retryQr: 'Обновить QR',
    copyError: 'Скопируйте ссылку из поля ниже',
    link: 'Ссылка на регистрацию',
    unavailable: 'QR недоступен',
  },
  kk: {
    heading: 'Кассирлер жарысы',
    hint: 'Аяқталған тіркелу үшін 300 ₸',
    from: 'Басталу күні',
    to: 'Аяқталу күні',
    city: 'Қала',
    allCities: 'Барлық қалалар',
    search: 'Кассирді табу',
    registrations: 'Тіркелулер',
    reward: 'Жалақыға',
    cashier: 'Кассир',
    rank: 'Орын',
    archive: 'Мұрағатта',
    refresh: 'Рейтингті жаңарту',
    loading: 'Рейтинг жүктелуде…',
    retry: 'Қайталау',
    loadError: 'Рейтингті жүктеу мүмкін болмады',
    rangeError: 'Басталу және аяқталу күндерін таңдаңыз',
    empty: 'Кассирлер табылмады',
    download: 'QR жүктеу',
    copy: 'Сілтемені көшіру',
    copied: 'Көшірілді',
    qrError: 'QR жүктеу мүмкін болмады',
    retryQr: 'QR жаңарту',
    copyError: 'Төмендегі өрістен сілтемені көшіріңіз',
    link: 'Тіркелу сілтемесі',
    unavailable: 'QR қолжетімсіз',
  },
};

function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function hasQr(row: CashierRaceItem) {
  return !row.isArchived && Boolean(row.url) && /^[a-f0-9]{64}$/i.test(row.inviteToken || '');
}

export default function CashierSignupRace() {
  const { locale, formatNumber } = useI18n();
  const text = copy[locale === 'kk' ? 'kk' : 'ru'];
  const [from, setFrom] = useState(() => `${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [city, setCity] = useState('');
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; response?: RaceResponse; error?: string }>();
  const [qr, setQr] = useState<CashierRaceItem | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const copyRevision = useRef(0);
  const valid = validDate(from) && validDate(to) && from <= to;
  const key = `${from}|${to}|${attempt}`;
  const current = valid && result?.key === key ? result : undefined;
  const loading = valid && !current;
  const rows = current?.response?.items || [];
  const cities = useMemo(
    () =>
      [...new Set(rows.map((row) => row.city).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const ordered = rows
      .filter(
        (row) =>
          (!city || row.city === city) &&
          (!query || `${row.name} ${row.branchName}`.toLocaleLowerCase().includes(query)),
      )
      .sort(
        (a, b) =>
          b.completed - a.completed || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      );
    let rank = 1;
    return ordered.map((row, index) => {
      if (index && ordered[index - 1].completed !== row.completed) rank = index + 1;
      return { ...row, rank };
    });
  }, [rows, city, search]);
  const totals = filtered.reduce(
    (sum, row) => ({
      completed: sum.completed + row.completed,
      rewardAmount: sum.rewardAmount + row.rewardAmount,
    }),
    { completed: 0, rewardAmount: 0 },
  );

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    void request<RaceResponse>(
      `/bonus/cashier-race?from=${from}&to=${to}`,
      { signal: controller.signal },
      { branchScope: '' },
    )
      .then((response) => {
        if (!controller.signal.aborted) setResult({ key, response });
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setResult({ key, error: caught instanceof Error ? caught.message : '' });
      });
    return () => controller.abort();
  }, [from, to, key, valid]);

  useEffect(() => {
    if (!current?.response || !qr) return;
    const updated = current.response.items.find((row) => row.id === qr.id);
    if (!updated || !hasQr(updated)) setQr(null);
  }, [current, qr]);

  const closeQr = () => {
    copyRevision.current++;
    setQr(null);
  };
  const openQr = (row: CashierRaceItem) => {
    copyRevision.current++;
    setQr(row);
    setCopied(false);
    setCopyFailed(false);
    setImageFailed(false);
    setImageAttempt(0);
  };
  const qrImage = qr ? `/api/public/cashier-invites/${qr.inviteToken}/qr` : '';

  return (
    <section className="card cashier-race" aria-label={text.heading} aria-busy={loading}>
      <div className="cashier-race-heading">
        <span className="cashier-race-heading-icon" aria-hidden="true">
          <Trophy size={22} />
        </span>
        <div>
          <h2>{text.heading}</h2>
          <p>{text.hint}</p>
        </div>
        <button
          type="button"
          className="icon-button cashier-race-refresh"
          aria-label={text.refresh}
          title={text.refresh}
          disabled={loading || !valid}
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCw size={19} aria-hidden="true" className={loading ? 'spin' : undefined} />
        </button>
      </div>

      <div className="cashier-race-filters">
        <label className="field-group" htmlFor="cashier-race-from">
          <span>{text.from}</span>
          <input
            className="input-classic"
            id="cashier-race-from"
            type="date"
            required
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="field-group" htmlFor="cashier-race-to">
          <span>{text.to}</span>
          <input
            className="input-classic"
            id="cashier-race-to"
            type="date"
            required
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <label className="field-group" htmlFor="cashier-race-city">
          <span>{text.city}</span>
          <select
            className="input-classic"
            id="cashier-race-city"
            value={city}
            onChange={(event) => setCity(event.target.value)}
          >
            <option value="">{text.allCities}</option>
            {city && !cities.includes(city) && <option value={city}>{city}</option>}
            {cities.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="field-group cashier-race-search" htmlFor="cashier-race-search">
          <span>{text.search}</span>
          <div className="cashier-race-search-control">
            <Search aria-hidden="true" size={18} />
            <input
              className="input-classic"
              id="cashier-race-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </label>
      </div>

      {!valid && (
        <p className="inline-alert inline-alert-error" role="alert">
          {text.rangeError}
        </p>
      )}
      {current && !current.response && (
        <div className="inline-alert inline-alert-error" role="alert">
          <span>{current.error || text.loadError}</span>
          <button
            type="button"
            className="btn-outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {text.retry}
          </button>
        </div>
      )}
      {loading && (
        <div className="cashier-race-loading" role="status">
          <RefreshCw aria-hidden="true" size={20} className="spin" /> {text.loading}
        </div>
      )}

      {current?.response && (
        <>
          <div className="cashier-race-stats">
            <div>
              <Users aria-hidden="true" size={21} />
              <span>{text.registrations}</span>
              <strong>{formatNumber(totals.completed)}</strong>
            </div>
            <div>
              <Wallet aria-hidden="true" size={21} />
              <span>{text.reward}</span>
              <strong>{formatNumber(totals.rewardAmount)} ₸</strong>
            </div>
          </div>
          {filtered.length ? (
            <table className="cashier-race-table">
              <thead>
                <tr>
                  <th>{text.rank}</th>
                  <th>{text.cashier}</th>
                  <th>{text.registrations}</th>
                  <th>{text.reward}</th>
                  <th>QR</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td className="cashier-race-rank" data-label={text.rank}>
                      <span
                        className={row.rank === 1 && row.completed > 0 ? 'is-leading' : undefined}
                      >
                        {row.rank}
                      </span>
                    </td>
                    <th scope="row" className="cashier-race-person">
                      <div className="cashier-race-name">
                        <strong>{row.name}</strong>
                        {row.isArchived && (
                          <span className="cashier-race-archive">{text.archive}</span>
                        )}
                      </div>
                      <span className="cashier-race-branch">
                        {[row.branchName, row.city].filter(Boolean).join(' · ')}
                      </span>
                    </th>
                    <td className="cashier-race-count" data-label={text.registrations}>
                      <span className="cashier-race-mobile-label">{text.registrations}</span>
                      <strong>{formatNumber(row.completed)}</strong>
                    </td>
                    <td className="cashier-race-reward" data-label={text.reward}>
                      <span className="cashier-race-mobile-label">{text.reward}</span>
                      <strong>{formatNumber(row.rewardAmount)} ₸</strong>
                    </td>
                    <td className="cashier-race-qr" data-label="QR">
                      {hasQr(row) ? (
                        <button
                          type="button"
                          className="btn-outline cashier-race-qr-button"
                          aria-label={`QR: ${row.name}`}
                          onClick={() => openQr(row)}
                        >
                          <QrCode aria-hidden="true" size={18} />
                          <span>QR</span>
                        </button>
                      ) : (
                        <span aria-label={text.unavailable}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="cashier-race-empty">{text.empty}</p>
          )}
        </>
      )}

      {qr && (
        <Modal
          open
          title={qr.name}
          description={[qr.branchName, qr.city].filter(Boolean).join(' · ')}
          size="sm"
          onClose={closeQr}
        >
          <div className="modal-body cashier-race-qr-body">
            {!imageFailed && (
              <img
                key={imageAttempt}
                src={qrImage}
                alt={`QR: ${qr.name}`}
                width="280"
                height="280"
                onError={() => setImageFailed(true)}
              />
            )}
            {imageFailed && (
              <div className="inline-alert inline-alert-error" role="alert">
                <span>{text.qrError}</span>
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => {
                    setImageFailed(false);
                    setImageAttempt((value) => value + 1);
                  }}
                >
                  {text.retryQr}
                </button>
              </div>
            )}
            <div className="cashier-race-qr-actions">
              <a className="btn-outline" href={qrImage} download={`bulka-cashier-${qr.id}.png`}>
                <Download aria-hidden="true" size={17} />
                {text.download}
              </a>
              <button
                type="button"
                className="btn-classic"
                onClick={async () => {
                  const revision = copyRevision.current;
                  try {
                    await navigator.clipboard.writeText(qr.url!);
                    if (revision === copyRevision.current) {
                      setCopied(true);
                      setCopyFailed(false);
                    }
                  } catch {
                    if (revision === copyRevision.current) setCopyFailed(true);
                  }
                }}
              >
                <Copy aria-hidden="true" size={17} />
                {copied ? text.copied : text.copy}
              </button>
            </div>
            {copied && (
              <span className="sr-only" role="status">
                {text.copied}
              </span>
            )}
            {copyFailed && (
              <div className="cashier-race-copy-fallback">
                <p role="alert">{text.copyError}</p>
                <label className="field-group">
                  <span>{text.link}</span>
                  <input
                    className="input-classic"
                    value={qr.url || ''}
                    readOnly
                    onFocus={(event) => event.target.select()}
                  />
                </label>
              </div>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
