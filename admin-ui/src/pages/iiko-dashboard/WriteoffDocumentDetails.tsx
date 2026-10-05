import Modal from '../../components/Modal';
import { useI18n } from '../../lib/i18n';
import DataTable from './DataTable';
import { controlText } from './control-labels';
import { controlReport } from './control-report';
import type { Report } from './model';

export default function WriteoffDocumentDetails({
  document,
  items,
  onClose,
}: {
  document: Record<string, unknown>;
  items: Report;
  onClose: () => void;
}) {
  const { locale, formatNumber, formatDate } = useI18n();
  const text = (key: string) => controlText(locale, key);
  const fields = [
    'Product.Name',
    'Product.MeasureUnit',
    'WriteoffQuantity',
    'WriteoffCost',
    'Reason',
    'Comment',
  ];
  const report = controlReport(
    {
      ...items,
      columns: Object.fromEntries(
        fields
          .filter((field) => items.columns[field])
          .map((field) => [field, items.columns[field]]),
      ),
      rows: items.rows.filter((row) => row.DocumentKey === document.DocumentKey),
    },
    text,
    (value) => value,
  );
  return (
    <Modal
      open
      size="xl"
      title={`${text('Document')} ${document.Document || '—'}`}
      description={[
        document.Department,
        document.Store,
        document.Day ? formatDate(String(document.Day), { dateStyle: 'short' }) : '',
      ]
        .filter(Boolean)
        .join(' · ')}
      onClose={onClose}
    >
      <div className="id-dashboard id-writeoff-document">
        <div className="id-drilldown-total">
          <span>{text('cost')}</span>
          <strong>
            {formatNumber(Number(document.WriteoffCost || 0), { maximumFractionDigits: 2 })} ₸
          </strong>
        </div>
        <DataTable report={report} defaultSort={{ field: 'WriteoffCost', direction: -1 }} />
      </div>
    </Modal>
  );
}
