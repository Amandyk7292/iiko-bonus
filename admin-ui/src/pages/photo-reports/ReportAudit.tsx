import { Check, CircleHelp, Clock3, Tablet, X } from 'lucide-react';
import type { PhotoCopy, Report } from './model';

export default function ReportAudit({ report, copy }: { report: Report; copy: PhotoCopy }) {
  const checks = [
    [copy.text('Планшет подключён', 'Планшет қосылған'), report.checks?.deviceAuthorized],
    [copy.text('Филиал совпадает', 'Филиал сәйкес'), report.checks?.branchMatched],
    [copy.text('Формат фото', 'Фото пішімі'), report.checks?.imagesValidated],
  ] as const;
  return (
    <section
      className="closing-report-audit"
      aria-label={copy.text('Проверки при отправке', 'Жіберу кезіндегі тексерулер')}
    >
      <div className="closing-audit-meta">
        <span>
          <Clock3 size={16} aria-hidden="true" />
          <time dateTime={report.submittedAt}>{copy.timeLabel(report.submittedAt)}</time>
        </span>
        <span>
          <Tablet size={16} aria-hidden="true" />
          {report.deviceName || copy.text('Нет данных', 'Деректер жоқ')}
        </span>
      </div>
      <dl className="closing-audit-checks">
        {checks.map(([label, value]) => {
          const known = typeof value === 'boolean';
          const Icon = !known ? CircleHelp : value ? Check : X;
          return (
            <div key={label} className={!known ? 'unknown' : value ? 'passed' : 'failed'}>
              <dt>{label}</dt>
              <dd>
                <Icon size={16} aria-hidden="true" />
                <span>
                  {!known
                    ? copy.text('Нет данных', 'Деректер жоқ')
                    : value
                      ? copy.text('Да', 'Иә')
                      : copy.text('Нет', 'Жоқ')}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
