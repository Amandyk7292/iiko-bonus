import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { dashboardApi, exportReport } from './api';
import {
  errorKey,
  salesFilters,
  type Columns,
  type Filter,
  type Query,
  type Report,
} from './model';
import DataTable from './DataTable';

export interface Template {
  name: string;
  reportType: Query['reportType'];
  groupBy: string[];
  aggregate: string[];
  filters: Filter[];
}
export default function ReportBuilder({
  base,
  refresh,
  templates,
  setTemplates,
}: {
  base: Query;
  refresh: number;
  templates: Template[];
  setTemplates: (value: Template[]) => void;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<Query['reportType']>('SALES');
  const [columns, setColumns] = useState<Columns>({});
  const [dateField, setDateField] = useState('');
  const [groups, setGroups] = useState(['Department']);
  const [aggregate, setAggregate] = useState(['DishDiscountSumInt', 'UniqOrderId']);
  const [filters, setFilters] = useState<Filter[]>(salesFilters);
  const [filterField, setFilterField] = useState('');
  const [values, setValues] = useState('');
  const [exclude, setExclude] = useState(false);
  const [report, setReport] = useState<Report>();
  const [submitted, setSubmitted] = useState<Query>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setColumns({});
    setReport(undefined);
    setSubmitted(undefined);
    setError('');
    setLoading(true);
    void dashboardApi
      .schema(base.serverId, type, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setColumns(data.columns);
        setDateField(data.dateField);
        setGroups((old) => old.filter((key) => data.columns[key]?.groupingAllowed));
        setAggregate((old) => old.filter((key) => data.columns[key]?.aggregationAllowed));
        setFilters((old) =>
          old.filter(
            (filter) =>
              data.columns[filter.field]?.filteringAllowed && filter.field !== data.dateField,
          ),
        );
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorKey(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base.serverId, type]);
  // Applying a period reruns the submitted definition instead of silently clearing it.
  useEffect(() => {
    setReport(undefined);
    setSubmitted((old) =>
      old
        ? {
            ...old,
            from: base.from,
            to: base.to,
            filters: [
              ...filters,
              ...base.filters.filter(
                (filter) =>
                  filter.field === 'Department' &&
                  !filters.some((own) => own.field === 'Department'),
              ),
            ],
          }
        : undefined,
    );
  }, [base.from, base.to, JSON.stringify(base.filters)]);
  useEffect(() => {
    if (!submitted) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void dashboardApi
      .report(submitted, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setReport(data);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorKey(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [submitted, refresh]);
  const query = (): Query => ({
    ...base,
    reportType: type,
    groupBy: groups,
    aggregate,
    filters: [
      ...base.filters.filter(
        (filter) =>
          filter.field === 'Department' && !filters.some((own) => own.field === filter.field),
      ),
      ...filters,
    ],
  });
  const choose = (event: React.ChangeEvent<HTMLSelectElement>) =>
    Array.from(event.target.selectedOptions, (option) => option.value);
  const addFilter = () => {
    if (!filterField || !values.trim()) return;
    const numeric = ['INTEGER', 'AMOUNT', 'MONEY', 'PERCENT'].includes(columns[filterField]?.type);
    const parsed = values
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => (numeric && Number.isFinite(Number(value)) ? Number(value) : value));
    setFilters((old) => [
      ...old.filter((item) => item.field !== filterField),
      { field: filterField, values: parsed, exclude },
    ]);
    setValues('');
  };
  return (
    <section className="card id-panel">
      <div className="id-builder-header">
        <label>
          <span>{t('id.reportType')}</span>
          <select
            aria-label={t('id.reportType')}
            value={type}
            onChange={(event) => {
              setType(event.target.value as Query['reportType']);
              setFilters(event.target.value === 'TRANSACTIONS' ? [] : salesFilters);
            }}
          >
            {(['SALES', 'TRANSACTIONS', 'DELIVERIES'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`id.${value.toLowerCase()}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('id.templates')}</span>
          <select
            aria-label={t('id.templates')}
            value=""
            onChange={(event) => {
              const item = templates[Number(event.target.value)];
              if (!item) return;
              setType(item.reportType);
              setGroups(item.groupBy);
              setAggregate(item.aggregate);
              setFilters(item.filters);
            }}
          >
            <option value="">—</option>
            {templates.map((item, index) => (
              <option key={index} value={index}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="id-builder-fields">
        <label>
          <span>{t('id.groups')}</span>
          <select
            aria-label={t('id.groups')}
            multiple
            size={7}
            value={groups}
            onChange={(event) => setGroups(choose(event).slice(0, 5))}
          >
            {Object.entries(columns)
              .filter(([, column]) => column.groupingAllowed)
              .map(([key, column]) => (
                <option value={key} key={key}>
                  {column.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>{t('id.values')}</span>
          <select
            aria-label={t('id.values')}
            multiple
            size={7}
            value={aggregate}
            onChange={(event) => setAggregate(choose(event).slice(0, 12))}
          >
            {Object.entries(columns)
              .filter(([, column]) => column.aggregationAllowed)
              .map(([key, column]) => (
                <option value={key} key={key}>
                  {column.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <details className="id-filter-details">
        <summary>
          {t('id.filters')} · {filters.length}
        </summary>
        <div className="id-filter-form">
          <label>
            <span>{t('id.filterField')}</span>
            <select
              aria-label={t('id.filterField')}
              value={filterField}
              onChange={(event) => setFilterField(event.target.value)}
            >
              <option value="">—</option>
              {Object.entries(columns)
                .filter(([key, column]) => key !== dateField && column.filteringAllowed)
                .map(([key, column]) => (
                  <option key={key} value={key}>
                    {column.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>{t('id.filterValues')}</span>
            <input
              value={values}
              onChange={(event) => setValues(event.target.value)}
              maxLength={2000}
            />
          </label>
          <label className="id-check">
            <input
              type="checkbox"
              checked={exclude}
              onChange={(event) => setExclude(event.target.checked)}
            />
            {t('id.exclude')}
          </label>
          <button
            type="button"
            disabled={!filterField || !values.trim() || filters.length >= 15}
            onClick={addFilter}
          >
            {t('id.addFilter')}
          </button>
        </div>
        {filters.map((filter) => (
          <div className="id-filter-chip" key={filter.field}>
            <span>
              {columns[filter.field]?.name || filter.field}: {filter.exclude ? '≠' : '='}{' '}
              {filter.values.join(', ')}
            </span>
            <button
              type="button"
              onClick={() => setFilters(filters.filter((item) => item.field !== filter.field))}
            >
              {t('id.remove')}
            </button>
          </div>
        ))}
      </details>
      <div className="id-actions">
        <button
          className="btn-primary"
          type="button"
          disabled={loading || !aggregate.length}
          onClick={() => setSubmitted(query())}
        >
          {t(loading ? 'id.loading' : 'id.run')}
        </button>
        <input
          aria-label={t('id.templateName')}
          placeholder={t('id.templateName')}
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="button"
          disabled={!name.trim() || !aggregate.length || templates.length >= 50}
          onClick={() => {
            const { reportType, groupBy, aggregate: measures, filters: savedFilters } = query();
            setTemplates([
              ...templates.filter((item) => item.name !== name.trim()),
              {
                name: name.trim(),
                reportType,
                groupBy,
                aggregate: measures,
                filters: savedFilters,
              },
            ]);
            setName('');
          }}
        >
          {t('id.save')}
        </button>
        {report && submitted && (
          <button
            type="button"
            disabled={exporting}
            onClick={() => {
              setExporting(true);
              void exportReport(submitted)
                .catch((caught) => setError(errorKey(caught)))
                .finally(() => setExporting(false));
            }}
          >
            {t('id.export')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="id-error">
          {t(error)}
        </p>
      )}
      {report && <DataTable report={report} />}
    </section>
  );
}
