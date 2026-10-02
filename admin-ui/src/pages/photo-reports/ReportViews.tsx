import { Check, ChevronRight, Clock3, QrCode } from 'lucide-react';
import {
  kinds,
  reportKey,
  visibleShifts,
  type Branch,
  type PhotoCopy,
  type Report,
  type Selection,
} from './model';

interface ViewProps {
  branches: Branch[];
  reports: Map<string, Report>;
  date: string;
  copy: PhotoCopy;
  canIssueQr: boolean;
  onQr: (branch: Branch) => void;
  onSelect: (selection: Selection) => void;
}
function BranchTitle({
  branch,
  copy,
  canIssueQr,
  onQr,
}: Pick<ViewProps, 'copy' | 'canIssueQr' | 'onQr'> & { branch: Branch }) {
  return (
    <div className="closing-branch-title">
      <div>
        <strong>{branch.name}</strong>
        <small>
          {branch.city}
          {branch.active === false ? copy.text(' · Неактивна', ' · Белсенді емес') : ''}
        </small>
      </div>
      {canIssueQr && branch.active !== false && (
        <button
          type="button"
          className="btn-outline closing-qr-button"
          aria-label={`${copy.text('QR для', 'QR:')} ${branch.name}`}
          onClick={() => onQr(branch)}
        >
          <QrCode size={18} aria-hidden="true" />
          <span>QR</span>
        </button>
      )}
    </div>
  );
}
export function ReportDayCards(props: ViewProps) {
  const { branches, reports, date, copy, onSelect } = props;
  return (
    <div className="closing-day-cards">
      {branches.map((branch) => (
        <article
          key={branch.id}
          className="card closing-day-card"
          aria-label={`${branch.city} · ${branch.name}`}
        >
          <BranchTitle {...props} branch={branch} />
          {visibleShifts(branch, reports, [date]).map((shift) => (
            <div className="closing-shift-group" key={shift}>
              {(shift !== 'daily' || branch.roundTheClock) && (
                <div className="closing-shift-heading">
                  <strong>{copy.shiftLabel(shift)}</strong>
                  <span>{copy.shiftHours(branch, shift)}</span>
                </div>
              )}
              <div className="closing-day-actions">
                {kinds.map((kind) => {
                  const report = reports.get(reportKey(branch.id, date, kind, shift));
                  return (
                    <button
                      key={kind}
                      type="button"
                      className={`closing-report-button ${report ? 'done' : ''}`}
                      aria-label={copy.reportLabel(branch, date, kind, report, shift)}
                      onClick={() => onSelect({ branch, date, kind, shift })}
                    >
                      {report ? (
                        <Check size={20} aria-hidden="true" />
                      ) : (
                        <Clock3 size={20} aria-hidden="true" />
                      )}
                      <span>
                        <strong>{copy.kindLabel(kind)}</strong>
                        <small>
                          {report
                            ? `${report.photoCount} фото · ${copy.timeLabel(report.submittedAt, true)}`
                            : copy.text('Не отправлен', 'Жіберілмеді')}
                        </small>
                      </span>
                      <ChevronRight size={18} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}
export function ReportCalendar(props: ViewProps & { dates: string[] }) {
  const { branches, reports, date: selectedDate, dates, copy, onSelect } = props;
  return (
    <div
      className="closing-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={copy.text('Календарь отправки отчётов', 'Есеп жіберу күнтізбесі')}
    >
      <table className="closing-table">
        <thead>
          <tr>
            <th className="closing-branch-col" scope="colgroup" colSpan={2}>
              {copy.text('Точка / отчёт', 'Нүкте / есеп')}
            </th>
            {dates.map((date) => (
              <th
                scope="col"
                key={date}
                className={date === selectedDate ? 'closing-selected-date' : ''}
              >
                <span>{copy.dateLabel(date)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {branches.flatMap((branch) => {
            const rows = visibleShifts(branch, reports, dates).flatMap((shift) =>
              kinds.map((kind) => ({ shift, kind })),
            );
            return rows.map(({ shift, kind }, index) => (
              <tr
                key={`${branch.id}/${shift}/${kind}`}
                className={index === 0 ? 'closing-branch-start' : ''}
              >
                {index === 0 && (
                  <th scope="rowgroup" rowSpan={rows.length} className="closing-branch-col">
                    <BranchTitle {...props} branch={branch} />
                  </th>
                )}
                <th scope="row" className="closing-report-kind">
                  <span
                    className="closing-kind"
                    title={shift === 'daily' ? undefined : copy.shiftLabel(shift)}
                  >
                    {shift === 'daily' ? '' : `${shift === 'day' ? '1' : '2'} · `}
                    {copy.kindLabel(kind)}
                  </span>
                </th>
                {dates.map((date) => {
                  const report = reports.get(reportKey(branch.id, date, kind, shift));
                  const label = copy.reportLabel(branch, date, kind, report, shift);
                  return (
                    <td key={date} className={date === selectedDate ? 'closing-selected-date' : ''}>
                      <button
                        type="button"
                        className={`closing-cell ${report ? 'done' : ''}`}
                        aria-label={label}
                        title={label}
                        onClick={() => onSelect({ branch, date, kind, shift })}
                      >
                        <span>
                          {report ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : '—'}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
export function ReportsSkeleton({ copy }: { copy: PhotoCopy }) {
  return (
    <div className="closing-loading" role="status">
      <span className="sr-only">{copy.text('Загрузка отчётов…', 'Есептер жүктелуде…')}</span>
      <div aria-hidden="true" className="closing-summary">
        {[0, 1, 2].map((n) => (
          <div key={n} className="card closing-skeleton-stat">
            <i className="closing-skeleton" />
            <i className="closing-skeleton" />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="closing-day-cards">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="card closing-skeleton-card">
            <i className="closing-skeleton" />
            <i className="closing-skeleton" />
            <i className="closing-skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}
