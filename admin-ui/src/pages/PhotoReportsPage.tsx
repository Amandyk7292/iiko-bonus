import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search, Tablet, X } from '../components/BulkaIcons';
import PageState from '../components/PageState';
import { useI18n } from '../lib/i18n';
import { useSearchParams } from '../lib/router';
import {
  currentBusinessDate,
  datesBetween,
  kinds,
  reportKey,
  requiredShifts,
  shiftDate,
  usePhotoCopy,
  type Branch,
  type Selection,
} from './photo-reports/model';
import { usePhotoCalendar, usePhotoView } from './photo-reports/use-photo-calendar';
import { ReportCalendar, ReportDayCards, ReportsSkeleton } from './photo-reports/ReportViews';
import ReportDetail from './photo-reports/ReportDetail';
import ReportQr from './photo-reports/ReportQr';
import ReportDevices from './photo-reports/ReportDevices';
import './PhotoReportsPage.css';

const validPhotoDate = (value: string | null, max: string) =>
  Boolean(
    value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value &&
    value <= max,
  );

export default function PhotoReportsPage({ role = 'viewer' }: { role?: string }) {
  const { t } = useI18n();
  const copy = usePhotoCopy();
  const { text } = copy;
  const [params, setParams] = useSearchParams();
  const { view: responsiveView } = usePhotoView();
  const view = ['day', 'calendar'].includes(params.get('view') ?? '')
    ? (params.get('view') as 'day' | 'calendar')
    : responsiveView;
  const today = currentBusinessDate();
  const end = validPhotoDate(params.get('date'), today) ? params.get('date')! : today;
  const days = [7, 14, 31].includes(Number(params.get('days'))) ? Number(params.get('days')) : 14;
  const updateQuery = (values: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    );
    setParams(next, { replace });
  };
  const setEnd = (value: string) => {
    if (validPhotoDate(value, today)) updateQuery({ date: value });
  };
  const setDays = (value: number) => updateQuery({ days: String(value) });
  const setView = (value: 'day' | 'calendar') => updateQuery({ view: value });
  const { data, loading, error, refresh } = usePhotoCalendar(end, view === 'day' ? 1 : days);
  const city = params.get('city') ?? '';
  const search = params.get('search') ?? '';
  const status = ['all', 'missing', 'complete', 'hall', 'baker'].includes(
    params.get('status') ?? '',
  )
    ? params.get('status')!
    : 'all';
  const setCity = (value: string) => updateQuery({ city: value });
  const setSearch = (value: string) => updateQuery({ search: value }, true);
  const setStatus = (value: string) => updateQuery({ status: value === 'all' ? null : value });
  const selectedBranch = data?.branches.find((branch) => branch.id === params.get('branch'));
  const selectedDate = params.get('reportDate');
  const selectedKind = params.get('kind');
  const selectedShift = params.get('shift');
  const selection: Selection | null =
    selectedBranch &&
    validPhotoDate(selectedDate, today) &&
    (selectedKind === 'hall' || selectedKind === 'baker')
      ? {
          branch: selectedBranch,
          date: selectedDate!,
          kind: selectedKind,
          ...(['daily', 'day', 'night'].includes(selectedShift ?? '')
            ? { shift: selectedShift as Selection['shift'] }
            : {}),
        }
      : null;
  const setSelection = (value: Selection | null) =>
    updateQuery({
      branch: value?.branch.id ?? null,
      reportDate: value?.date ?? null,
      kind: value?.kind ?? null,
      shift: value?.shift ?? null,
    });
  const [qrBranch, setQrBranch] = useState<Branch | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const canIssueQr = ['owner', 'admin', 'branch_manager'].includes(role);
  const reports = useMemo(
    () => new Map(data?.reports.map((r) => [reportKey(r.branchId, r.date, r.kind, r.shift), r])),
    [data],
  );
  const matchingBranches = (data?.branches ?? []).filter(
    (branch) =>
      (!city || branch.city === city) &&
      `${branch.name} ${branch.city}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase().trim()),
  );
  const hasReport = (branch: Branch, kind: 'hall' | 'baker') =>
    requiredShifts(branch, reports, data?.to ?? end).every((shift) =>
      reports.has(reportKey(branch.id, data?.to ?? end, kind, shift)),
    );
  const countSubmitted = (branch: Branch) => kinds.filter((kind) => hasReport(branch, kind)).length;
  const branches = matchingBranches.filter(
    (branch) =>
      status === 'all' ||
      (status === 'complete'
        ? countSubmitted(branch) === 2
        : status === 'hall' || status === 'baker'
          ? !hasReport(branch, status)
          : countSubmitted(branch) < 2),
  );
  const maxDate = data?.businessDate ?? currentBusinessDate();
  const resetFilters = () => {
    updateQuery({ city: null, search: null, status: null });
  };
  const viewProps = {
    branches,
    reports,
    date: data?.to ?? end,
    copy,
    canIssueQr,
    onQr: setQrBranch,
    onSelect: setSelection,
  };

  return (
    <div className="closing-reports">
      <div className="closing-toolbar">
        <div className="closing-date-control">
          <button
            className="btn-outline"
            type="button"
            aria-label={text('Предыдущий день', 'Алдыңғы күн')}
            onClick={() => setEnd(shiftDate(end, -1))}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <label>
            <span className="sr-only">{text('Дата отчёта', 'Есеп күні')}</span>
            <input
              className="input-classic"
              type="date"
              value={end}
              max={maxDate}
              onChange={(e) => {
                if (e.target.value) setEnd(e.target.value);
              }}
            />
          </label>
          <button
            className="btn-outline"
            type="button"
            aria-label={text('Следующий день', 'Келесі күн')}
            disabled={end >= maxDate}
            onClick={() => setEnd(shiftDate(end, 1))}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="closing-toolbar-actions">
          {end !== maxDate && (
            <button className="btn-outline" type="button" onClick={() => setEnd(maxDate)}>
              {text('Сегодня', 'Бүгін')}
            </button>
          )}
          <div
            className="segmented-control closing-view-switch"
            role="group"
            aria-label={text('Вид страницы', 'Бет көрінісі')}
          >
            <button
              type="button"
              className={view === 'day' ? 'is-active' : ''}
              aria-pressed={view === 'day'}
              onClick={() => setView('day')}
            >
              {text('За день', 'Бір күн')}
            </button>
            <button
              type="button"
              className={view === 'calendar' ? 'is-active' : ''}
              aria-pressed={view === 'calendar'}
              onClick={() => setView('calendar')}
            >
              {text('Календарь', 'Күнтізбе')}
            </button>
          </div>
          {canIssueQr && (
            <button
              className="btn-outline closing-tablets-button"
              type="button"
              onClick={() => setDevicesOpen(true)}
            >
              <Tablet size={18} aria-hidden="true" />
              {text('Планшеты', 'Планшеттер')}
            </button>
          )}
          <button
            className="btn-outline closing-refresh"
            type="button"
            aria-label={t('common.refresh')}
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={19} className={loading ? 'spin' : undefined} aria-hidden="true" />
            <span>{t('common.refresh')}</span>
          </button>
        </div>
      </div>
      <div className={`closing-filters ${view === 'calendar' ? 'with-period' : ''}`}>
        <label htmlFor="closing-city" className="sr-only">
          {text('Город', 'Қала')}
        </label>
        <select
          id="closing-city"
          className="input-classic"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        >
          <option value="">{text('Все города', 'Барлық қалалар')}</option>
          {[...new Set(data?.branches.map((b) => b.city))].sort().map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        {view === 'calendar' && (
          <>
            <label htmlFor="closing-period" className="sr-only">
              {text('Показать', 'Көрсету')}
            </label>
            <select
              id="closing-period"
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
          </>
        )}
        <div className="closing-search">
          <label className="sr-only" htmlFor="closing-search-input">
            {text('Точка', 'Нүкте')}
          </label>
          <Search size={18} aria-hidden="true" />
          <input
            id="closing-search-input"
            className="input-classic"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={text('Найти точку', 'Нүктені табу')}
          />
          {search && (
            <button
              type="button"
              className="icon-button"
              aria-label={text('Очистить поиск', 'Іздеуді тазалау')}
              onClick={() => setSearch('')}
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {loading && !data ? (
        <ReportsSkeleton copy={copy} />
      ) : !data && error ? (
        <PageState type="error" description={error} onRetry={refresh} />
      ) : (
        data && (
          <>
            {error && (
              <div className="closing-refresh-error" role="alert">
                <span>{text('Не удалось обновить данные', 'Деректер жаңартылмады')}</span>
                <button type="button" className="btn-outline" onClick={refresh}>
                  {t('common.retry')}
                </button>
              </div>
            )}
            <div
              className="closing-summary"
              aria-label={text('Итоги на выбранную дату', 'Таңдалған күннің қорытындысы')}
            >
              <button
                type="button"
                className={`card ${status === 'complete' ? 'is-active' : ''}`}
                aria-label={text(
                  'Показать точки: оба отчёта отправлены',
                  'Екі есеп те жіберілген нүктелер',
                )}
                onClick={() => setStatus(status === 'complete' ? 'all' : 'complete')}
              >
                <strong className="closing-green">
                  {matchingBranches.filter((b) => countSubmitted(b) === 2).length}
                  <small> / {matchingBranches.length}</small>
                </strong>
                <span>{text('Готово', 'Дайын')}</span>
              </button>
              <button
                type="button"
                className={`card ${status === 'hall' ? 'is-active' : ''}`}
                aria-label={text('Показать точки без отчёта зала', 'Зал есебі жоқ нүктелер')}
                onClick={() => setStatus(status === 'hall' ? 'all' : 'hall')}
              >
                <strong>{matchingBranches.filter((b) => !hasReport(b, 'hall')).length}</strong>
                <span>{text('Нет отчёта зала', 'Зал есебі жоқ')}</span>
              </button>
              <button
                type="button"
                className={`card ${status === 'baker' ? 'is-active' : ''}`}
                aria-label={text('Показать точки без отчёта пекаря', 'Наубайшы есебі жоқ нүктелер')}
                onClick={() => setStatus(status === 'baker' ? 'all' : 'baker')}
              >
                <strong>{matchingBranches.filter((b) => !hasReport(b, 'baker')).length}</strong>
                <span>{text('Нет отчёта пекаря', 'Наубайшы есебі жоқ')}</span>
              </button>
            </div>
            <div className="closing-results-heading">
              <h2>{copy.dateLabel(data.to, true)}</h2>
              <span className="sr-only" role="status">
                {loading
                  ? text('Обновляем отчёты…', 'Есептер жаңартылуда…')
                  : text(`Точек: ${branches.length}`, `Нүктелер: ${branches.length}`)}
              </span>
            </div>
            <div
              className="closing-status-filters"
              role="group"
              aria-label={text('Статус точек', 'Нүктелер күйі')}
            >
              {[
                ['all', text('Все', 'Барлығы')],
                ['missing', text('Ждём отчёт', 'Есеп күтеміз')],
                ['complete', text('Готово', 'Дайын')],
                ...(status === 'hall'
                  ? [['hall', text('Нет отчёта зала', 'Зал есебі жоқ')]]
                  : status === 'baker'
                    ? [['baker', text('Нет отчёта пекаря', 'Наубайшы есебі жоқ')]]
                    : []),
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={status === value}
                  className={status === value ? 'is-active' : ''}
                  onClick={() => setStatus(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {!branches.length ? (
              <PageState
                type="empty"
                title={text('Точек с такими условиями нет', 'Бұл шарттарға сай нүктелер жоқ')}
                compact
                action={
                  <button type="button" className="btn-outline" onClick={resetFilters}>
                    {text('Сбросить фильтры', 'Сүзгілерді тазалау')}
                  </button>
                }
              />
            ) : (
              <div aria-busy={loading}>
                {view === 'day' ? (
                  <ReportDayCards {...viewProps} />
                ) : (
                  <section className="card closing-calendar">
                    <ReportCalendar {...viewProps} dates={datesBetween(data.from, data.to)} />
                  </section>
                )}
              </div>
            )}
          </>
        )
      )}
      <ReportDetail selection={selection} onChange={setSelection} copy={copy} />
      <ReportQr branch={qrBranch} onClose={() => setQrBranch(null)} copy={copy} />
      {canIssueQr && (
        <ReportDevices
          open={devicesOpen}
          branches={data?.branches ?? []}
          onClose={() => setDevicesOpen(false)}
          copy={copy}
        />
      )}
    </div>
  );
}
