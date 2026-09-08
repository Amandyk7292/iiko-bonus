import { useEffect, useState } from 'react';
import { Download, ArrowLeft } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { ApiError, request } from '../../lib/api';
import Modal from '../../components/Modal';
import DataTable from './DataTable';
import { download } from './api';
import { loadControls } from './load-controls';
import { errorKey, type Query, type Report } from './model';
import { barterText } from './barter-labels';
import './controls.css';
import './barters.css';
type Check = Record<string, unknown> & {
  identity: string;
  Blogger: string;
  groupKey: string;
  items: Record<string, unknown>[];
};
export type BarterResult = Report & {
  checks: Check[];
  bloggers: Record<string, unknown>[];
  summary: Record<string, number | null>;
};

export default function Barters({
  base,
  department,
  refresh,
}: {
  base: Query;
  department: string;
  refresh: number;
}) {
  const { t, locale, formatNumber, formatDate } = useI18n();
  const text = (key: string) => barterText(locale, key);
  const [data, setData] = useState<BarterResult>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState('receipts');
  const [blogger, setBlogger] = useState<string>();
  const [check, setCheck] = useState<Check>();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const queryKey = JSON.stringify({
    serverId: base.serverId,
    from: base.from,
    to: base.to,
    department,
  });
  useEffect(() => {
    setData(undefined);
    setCheck(undefined);
    setBlogger(undefined);
    setSaved(false);
  }, [queryKey]);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setLoading(true);
    void loadControls<BarterResult>(
      JSON.parse(queryKey),
      controller.signal,
      '/iiko-dashboard/barters',
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorKey(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [queryKey, refresh, revision]);
  const report = (rows: Record<string, unknown>[], fields: string[]): Report => ({
    fetchedAt: data?.fetchedAt || '',
    serverId: base.serverId,
    rows: rows.map((row) => ({
      ...row,
      ...(Object.hasOwn(row, 'Blogger') ? { Blogger: row.Blogger || text('unknown') } : {}),
    })),
    columns: Object.fromEntries(
      fields.map((field) => [
        field,
        {
          name: text(field),
          type: ['Date', 'LastVisit'].includes(field)
            ? 'DATE_TIME'
            : ['Checks', 'Quantity', 'Total'].includes(field)
              ? 'NUMBER'
              : 'STRING',
        },
      ]),
    ),
  });
  const checks =
    data?.checks.filter((row) => blogger === undefined || row.groupKey === blogger) || [];
  const openCheck = (row: Record<string, unknown>) => {
    const selected = checks.find((item) => item.identity === row.identity);
    setCheck(selected);
    setName(selected?.Blogger || '');
    setSaveError('');
  };
  const exportRows = async () => {
    setExporting(true);
    setError('');
    try {
      const response = await fetch('/admin/api/iiko-dashboard/barters/export', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: queryKey,
        signal: AbortSignal.timeout(90000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError('', response.status, body.code);
      }
      await download(await response.blob(), `iiko-barters-${base.from}-${base.to}.xlsx`);
    } catch (caught) {
      setError(errorKey(caught));
    } finally {
      setExporting(false);
    }
  };
  const saveName = async () => {
    if (!check) return;
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      await request('/iiko-dashboard/barters/person', {
        method: 'POST',
        body: JSON.stringify({
          query: JSON.parse(queryKey),
          documentKey: check.identity,
          bloggerName: name.trim(),
        }),
      });
      setSaved(true);
      setCheck(undefined);
      setRevision((value) => value + 1);
    } catch (caught) {
      setSaveError(errorKey(caught));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="id-controls id-barters">
      {saved && <p role="status">{text('saved')}</p>}
      {error && (
        <p className="id-error" role="alert">
          {t(error)}
        </p>
      )}
      {loading && <p role="status">{t('id.loading')}</p>}
      {data && (
        <>
          <div className="id-control-cards">
            {['bloggers', 'checks', 'total', 'unnamed'].map((key) => (
              <div key={key}>
                <span>{text(key)}</span>
                <strong
                  title={
                    data.summary[key] === null
                      ? ''
                      : formatNumber(data.summary[key] || 0, { maximumFractionDigits: 2 })
                  }
                >
                  {data.summary[key] === null
                    ? '—'
                    : formatNumber(data.summary[key] || 0, {
                        maximumFractionDigits: 2,
                        ...(key === 'total' && (data.summary[key] || 0) >= 1000000
                          ? { notation: 'compact' as const }
                          : {}),
                      })}
                  {key === 'total' ? ' ₸' : ''}
                </strong>
              </div>
            ))}
          </div>
          {!!data.summary.unnamed && <p className="id-barter-note">{text('unnamedHint')}</p>}
          <section className="id-control-panel">
            <div className="id-control-toolbar">
              <div className="id-control-views">
                {['bloggers', 'receipts'].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={view === value}
                    onClick={() => {
                      setView(value);
                      setBlogger(undefined);
                    }}
                  >
                    {text(value === 'bloggers' ? 'bloggersView' : 'receiptsView')}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={exporting || loading}
                onClick={() => void exportRows()}
              >
                <Download size={16} />
                {t('id.export')}
              </button>
            </div>
            <details className="id-explanation">
              <summary>{t('id.calculation')}</summary>
              <p>{text('calculation')}</p>
            </details>
            {view === 'bloggers' ? (
              <DataTable
                key="bloggers"
                report={report(data.bloggers, ['Blogger', 'Checks', 'Total', 'LastVisit'])}
                onSelect={(row) => {
                  setBlogger(String(row.groupKey));
                  setView('receipts');
                }}
              />
            ) : (
              <>
                {blogger !== undefined && (
                  <button
                    type="button"
                    onClick={() => {
                      setBlogger(undefined);
                      setView('bloggers');
                    }}
                  >
                    <ArrowLeft size={16} />
                    {text('all')}
                  </button>
                )}
                <DataTable
                  key={`receipts-${blogger ?? 'all'}`}
                  report={report(
                    checks.map((row) => ({
                      ...row,
                      Products: row.items
                        .map(
                          (item) =>
                            `${item.Quantity == null ? '—' : formatNumber(Number(item.Quantity), { maximumFractionDigits: 3 })} ${item.Unit || ''} × ${item.Product}`,
                        )
                        .join(' · '),
                    })),
                    ['Blogger', 'Date', 'Department', 'Document', 'Products', 'Total'],
                  )}
                  onSelect={openCheck}
                />
              </>
            )}
          </section>
        </>
      )}
      {check && (
        <Modal
          open
          title={`${text('Document')} ${check.Document}`}
          description={`${check.Counteragent} · ${check.Department} · ${formatDate(String(check.Date), { dateStyle: 'short', timeStyle: 'short' })}`}
          onClose={() => {
            if (!saving) setCheck(undefined);
          }}
          size="xl"
        >
          <div className="id-barters id-barter-detail">
            <form
              className="id-barter-name"
              onSubmit={(event) => {
                event.preventDefault();
                void saveName();
              }}
            >
              <label htmlFor="barter-blogger-name">{text('name')}</label>
              <input
                id="barter-blogger-name"
                aria-describedby="barter-name-hint"
                value={name}
                maxLength={160}
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
                list="barter-blogger-names"
              />
              <datalist id="barter-blogger-names">
                {data?.bloggers
                  .filter((row) => row.Blogger)
                  .map((row) => (
                    <option key={String(row.groupKey)} value={String(row.Blogger)} />
                  ))}
              </datalist>
              <p id="barter-name-hint">{text('nameHint')}</p>
              <button type="submit" disabled={saving || name.trim() === check.Blogger}>
                {text(saving ? 'saving' : 'save')}
              </button>
              {saveError && <p role="alert">{t(saveError)}</p>}
            </form>
            <DataTable report={report(check.items, ['Product', 'Unit', 'Quantity', 'Total'])} />
          </div>
        </Modal>
      )}
    </div>
  );
}
