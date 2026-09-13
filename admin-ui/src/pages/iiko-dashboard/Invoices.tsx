import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { ApiError } from '../../lib/api';
import Modal from '../../components/Modal';
import DataTable from './DataTable';
import { download } from './api';
import { loadControls } from './load-controls';
import { errorKey, type Query, type Report } from './model';
import { invoiceText } from './invoice-labels';
import './controls.css';

type Invoice = Record<string, unknown> & {
  identity: string;
  items: Record<string, unknown>[];
};
type InvoiceResult = Report & {
  invoices: Invoice[];
  summary: Record<'invoices' | 'suppliers' | 'productLines' | 'total', number | null>;
};

export default function Invoices({
  base,
  department,
  refresh,
}: {
  base: Query;
  department: string;
  refresh: number;
}) {
  const { t, locale, formatNumber, formatDate } = useI18n();
  const text = (key: string) => invoiceText(locale, key);
  const [data, setData] = useState<InvoiceResult>();
  const [selected, setSelected] = useState<Invoice>();
  const [supplier, setSupplier] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const query = { serverId: base.serverId, from: base.from, to: base.to, department };
  const queryKey = JSON.stringify(query);

  useEffect(() => setSupplier(''), [base.serverId, base.from, base.to, department]);

  useEffect(() => {
    const controller = new AbortController();
    setSelected(undefined);
    setLoading(true);
    setError('');
    void loadControls<InvoiceResult>(
      JSON.parse(queryKey),
      controller.signal,
      '/iiko-dashboard/invoices',
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
  }, [queryKey, refresh]);

  const suppliers = useMemo(
    () =>
      [...new Set((data?.invoices || []).map((invoice) => String(invoice.Supplier || '')))]
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, locale)),
    [data, locale],
  );
  const visibleInvoices = useMemo(
    () =>
      supplier
        ? (data?.invoices || []).filter((invoice) => invoice.Supplier === supplier)
        : data?.invoices || [],
    [data, supplier],
  );
  const summary = useMemo(() => {
    if (!data || !supplier) return data?.summary;
    const totals = visibleInvoices.map((invoice) => invoice.Total);
    return {
      invoices: visibleInvoices.length,
      suppliers: visibleInvoices.length ? 1 : 0,
      productLines: visibleInvoices.reduce(
        (total, invoice) => total + Number(invoice.Products || 0),
        0,
      ),
      total: totals.every((value) => typeof value === 'number')
        ? totals.reduce<number>((total, value) => total + Number(value), 0)
        : null,
    };
  }, [data, supplier, visibleInvoices]);

  const report = (rows: Record<string, unknown>[], fields: string[]): Report => ({
    fetchedAt: data?.fetchedAt || '',
    serverId: base.serverId,
    rows,
    columns: Object.fromEntries(
      fields.map((field) => [
        field,
        {
          name: text(field),
          type: field === 'Date' ? 'DATE_TIME' : 'STRING',
        },
      ]),
    ),
  });
  const exportRows = async () => {
    setExporting(true);
    setError('');
    try {
      const response = await fetch('/admin/api/iiko-dashboard/invoices/export', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...query, supplier }),
        signal: AbortSignal.timeout(180000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError('', response.status, body.code);
      }
      await download(await response.blob(), `iiko-invoices-${base.from}-${base.to}.xlsx`);
    } catch (caught) {
      setError(errorKey(caught));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="id-controls id-invoices">
      {error && (
        <p className="id-error" role="alert">
          {t(error)}
        </p>
      )}
      {loading && !data && <p role="status">{t('id.loading')}</p>}
      {data && (
        <>
          <div className="id-invoice-filter">
            <label>
              {text('supplierFilter')}
              <select value={supplier} onChange={(event) => setSupplier(event.target.value)}>
                <option value="">{text('allSuppliers')}</option>
                {suppliers.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {loading && <span role="status">{text('refreshing')}</span>}
          </div>
          <div className="id-control-cards">
            {(['invoices', 'suppliers', 'productLines', 'total'] as const).map((key) => (
              <div key={key}>
                <span>{text(key)}</span>
                <strong>
                  {summary?.[key] === null
                    ? '—'
                    : formatNumber(summary?.[key] || 0, { maximumFractionDigits: 2 })}
                  {key === 'total' ? ' ₸' : ''}
                </strong>
              </div>
            ))}
          </div>
          <section className="id-control-panel">
            <div className="id-control-toolbar">
              <details className="id-explanation">
                <summary>{t('id.calculation')}</summary>
                <p>{text('calculation')}</p>
              </details>
              <button
                type="button"
                disabled={exporting || loading}
                onClick={() => void exportRows()}
              >
                <Download size={16} />
                {t('id.export')}
              </button>
            </div>
            <DataTable
              report={report(visibleInvoices, [
                'Date',
                'Document',
                'Supplier',
                'Department',
                'Store',
                'Products',
                'Total',
              ])}
              onSelect={(row) =>
                setSelected(visibleInvoices.find((item) => item.identity === row.identity))
              }
            />
          </section>
        </>
      )}
      {selected && (
        <Modal
          open
          size="xl"
          title={`${text('Document')} ${selected.Document}`}
          description={`${selected.Supplier} · ${selected.Store} · ${formatDate(String(selected.Date), { dateStyle: 'short', timeStyle: 'short' })}`}
          onClose={() => setSelected(undefined)}
        >
          <DataTable
            report={report(selected.items, [
              'Product',
              'Article',
              'Unit',
              'Quantity',
              'Price',
              'Vat',
              'Total',
            ])}
          />
          {Boolean(selected.Comment) && (
            <p>
              {text('Comment')}: {String(selected.Comment)}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
