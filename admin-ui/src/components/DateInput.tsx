import { useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import Modal from './Modal';
import { useI18n } from '../lib/i18n';
import './date-input.css';

type Props = {
  id?: string;
  name?: string;
  className?: string;
  value: string;
  type?: 'date' | 'datetime-local';
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  onChange: (event: { target: { value: string } }) => void;
};
const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parse = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`);

/** A local-date control: values never pass through UTC conversion. */
export default function DateInput({
  id,
  name,
  className = 'input-classic',
  value,
  type = 'date',
  min,
  max,
  required,
  disabled,
  onChange,
}: Props) {
  const { t, locale } = useI18n();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [time, setTime] = useState('00:00');
  const [month, setMonth] = useState(iso(new Date()).slice(0, 7));
  const [focus, setFocus] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const kk = locale === 'kk';
  const label = kk ? 'Күнді таңдау' : 'Выбрать дату';
  const format = (date: string, options: Intl.DateTimeFormatOptions) =>
    parse(date).toLocaleDateString(kk ? 'kk-KZ' : 'ru-RU', options);
  const first = parse(`${month}-01`);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    return iso(day);
  });
  const candidate = draft ? draft + (type === 'datetime-local' ? `T${time}` : '') : '';
  const valid =
    !!draft &&
    (type !== 'datetime-local' || /^\d{2}:\d{2}$/.test(time)) &&
    (!min || candidate >= min) &&
    (!max || candidate <= max);
  const shift = (delta: number) => {
    const next = new Date(first);
    next.setMonth(next.getMonth() + delta);
    setMonth(iso(next).slice(0, 7));
    setFocus(iso(next));
  };
  const years = Array.from({ length: 151 }, (_, i) => new Date().getFullYear() - 100 + i);
  const selectedYear = Number(month.slice(0, 4));
  if (!years.includes(selectedYear)) years.push(selectedYear);
  return (
    <>
      <button
        id={id || uid}
        name={name}
        type="button"
        className={`${className} date-input-trigger`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          const date = value.slice(0, 10) || iso(new Date());
          setDraft(date);
          setTime(value.slice(11, 16) || '00:00');
          setMonth(date.slice(0, 7));
          setFocus(date);
          setOpen(true);
        }}
      >
        <span>
          {value
            ? `${format(value, { day: '2-digit', month: '2-digit', year: 'numeric' })}${type === 'datetime-local' ? ` · ${value.slice(11, 16)}` : ''}`
            : label}
        </span>
        <CalendarDays size={18} aria-hidden="true" />
      </button>
      <Modal
        open={open}
        title={label}
        size="sm"
        onClose={() => setOpen(false)}
        footer={
          <div className="modal-actions">
            {!required && (
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  onChange({ target: { value: '' } });
                  setOpen(false);
                }}
              >
                {kk ? 'Тазалау' : 'Очистить'}
              </button>
            )}
            <button type="button" className="btn-outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-classic"
              disabled={!valid}
              onClick={() => {
                onChange({ target: { value: candidate } });
                setOpen(false);
              }}
            >
              {t('id.apply')}
            </button>
          </div>
        }
      >
        <div className="modal-body date-input-calendar">
          <div className="date-input-heading">
            <button
              type="button"
              className="icon-button"
              aria-label={t('id.previousMonth')}
              onClick={() => shift(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <select
              className="input-classic"
              aria-label={t('id.calendarMonth')}
              value={month.slice(5)}
              onChange={(e) => {
                setMonth(`${month.slice(0, 4)}-${e.target.value}`);
                setFocus(`${month.slice(0, 4)}-${e.target.value}-01`);
              }}
            >
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                <option key={m} value={m}>
                  {format(`2026-${m}-01`, { month: 'long' })}
                </option>
              ))}
            </select>
            <select
              className="input-classic"
              aria-label={t('id.calendarYear')}
              value={selectedYear}
              onChange={(e) => {
                setMonth(`${e.target.value}-${month.slice(5)}`);
                setFocus(`${e.target.value}-${month.slice(5)}-01`);
              }}
            >
              {years
                .sort((a, b) => a - b)
                .map((year) => (
                  <option key={year}>{year}</option>
                ))}
            </select>
            <button
              type="button"
              className="icon-button"
              aria-label={t('id.nextMonth')}
              onClick={() => shift(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="date-input-grid" aria-hidden="true">
            {days.slice(0, 7).map((day) => (
              <span key={day}>{format(day, { weekday: 'short' })}</span>
            ))}
          </div>
          <div className="date-input-grid" role="group" aria-label={label} ref={grid}>
            {days.map((day) => (
              <button
                key={day}
                type="button"
                data-date={day}
                tabIndex={focus === day ? 0 : -1}
                aria-label={format(day, { day: 'numeric', month: 'long', year: 'numeric' })}
                aria-pressed={draft === day}
                aria-current={day === iso(new Date()) ? 'date' : undefined}
                disabled={!!((min && day < min.slice(0, 10)) || (max && day > max.slice(0, 10)))}
                className={day.slice(0, 7) !== month ? 'is-outside' : ''}
                onClick={() => {
                  setDraft(day);
                  setFocus(day);
                }}
                onKeyDown={(event) => {
                  const delta = (
                    { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<
                      string,
                      number
                    >
                  )[event.key];
                  if (!delta) return;
                  event.preventDefault();
                  const date = parse(day);
                  date.setDate(date.getDate() + delta);
                  const next = iso(date);
                  if ((min && next < min.slice(0, 10)) || (max && next > max.slice(0, 10))) return;
                  setMonth(next.slice(0, 7));
                  setFocus(next);
                  requestAnimationFrame(() =>
                    grid.current
                      ?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)
                      ?.focus(),
                  );
                }}
              >
                {Number(day.slice(8))}
              </button>
            ))}
          </div>
          {type === 'datetime-local' && (
            <label className="field-group">
              <span>{kk ? 'Уақыт' : 'Время'}</span>
              <input
                type="time"
                className="input-classic"
                value={time}
                required
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
          )}
          <p className="field-hint" aria-live="polite">
            {draft && format(draft, { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          {!valid && (
            <p className="inline-alert inline-alert-error" role="alert">
              {kk
                ? 'Рұқсат етілген күн мен уақытты таңдаңыз'
                : 'Выберите дату и время в допустимом диапазоне'}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
