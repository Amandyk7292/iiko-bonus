import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from './BulkaIcons';
import Modal from './Modal';
import { useI18n } from '../lib/i18n';
import './date-input.css';

type Props = {
  id?: string;
  name?: string;
  className?: string;
  value: string;
  type?: 'date' | 'datetime-local' | 'month';
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  onChange: (event: { target: { value: string } }) => void;
};
const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parse = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`);
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(parse(value).getTime()) &&
  iso(parse(value)) === value;
const validValue = (value: string, type: 'date' | 'datetime-local' | 'month') =>
  type === 'month'
    ? /^\d{4}-\d{2}$/.test(value) && validDate(`${value}-01`)
    : validDate(value.slice(0, 10)) &&
      (type === 'date'
        ? value.length === 10
        : /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(value));

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
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
}: Props) {
  const { t, locale } = useI18n();
  const uid = useId();
  const today = iso(new Date());
  const todayValue = type === 'month' ? today.slice(0, 7) : today;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [time, setTime] = useState('00:00');
  const [month, setMonth] = useState(iso(new Date()).slice(0, 7));
  const [focus, setFocus] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const kk = locale === 'kk';
  const en = locale === 'en';
  const text = (ru: string, kz: string, english: string) => (kk ? kz : en ? english : ru);
  const label =
    type === 'month'
      ? text('Выбрать месяц', 'Айды таңдау', 'Choose a month')
      : text('Выбрать дату', 'Күнді таңдау', 'Choose a date');
  const format = (date: string, options: Intl.DateTimeFormatOptions) =>
    parse(date).toLocaleDateString(kk ? 'kk-KZ' : en ? 'en-GB' : 'ru-RU', options);
  const first = parse(`${month}-01`);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    return iso(day);
  });
  const candidate = draft
    ? type === 'month'
      ? draft.slice(0, 7)
      : draft + (type === 'datetime-local' ? `T${time}` : '')
    : '';
  const allowed = (value: string) =>
    validValue(value, type) && (!min || value >= min) && (!max || value <= max);
  const valid = allowed(candidate);
  const shift = (delta: number) => {
    const next = new Date(first);
    if (type === 'month') next.setFullYear(next.getFullYear() + delta);
    else next.setMonth(next.getMonth() + delta);
    setMonth(iso(next).slice(0, 7));
    setFocus(iso(next));
  };
  const years = Array.from({ length: 151 }, (_, i) => new Date().getFullYear() - 100 + i);
  const selectedYear = Number(month.slice(0, 4));
  if (!years.includes(selectedYear)) years.push(selectedYear);
  const openCalendar = () => {
    const storedDate = type === 'month' && value ? `${value}-01` : value.slice(0, 10);
    let date = validDate(storedDate) ? storedDate : today;
    if (type === 'month') date = `${date.slice(0, 7)}-01`;
    if (min && date < min.slice(0, 10)) date = type === 'month' ? `${min}-01` : min.slice(0, 10);
    if (max && date > max.slice(0, 10)) date = type === 'month' ? `${max}-01` : max.slice(0, 10);
    setDraft(date);
    setTime(value.slice(11, 16) || '00:00');
    setMonth(date.slice(0, 7));
    setFocus(date);
    setOpen(true);
  };
  // The control is a button, so retain form validation when replacing native inputs.
  useEffect(() => {
    const form = trigger.current?.form;
    if (!form) return;
    const validate = (event: Event) => {
      if (event.defaultPrevented || disabled || (!value && !required)) return;
      if (!allowed(value)) {
        event.preventDefault();
        event.stopPropagation();
        openCalendar();
      }
    };
    form.addEventListener('submit', validate, true);
    return () => form.removeEventListener('submit', validate, true);
  }, [value, type, min, max, required, disabled]);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      grid.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]:not(:disabled)`)
        ?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, focus, month]);
  return (
    <>
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      <button
        id={id || uid}
        ref={trigger}
        name={name}
        value={value}
        type="button"
        className={`${className} date-input-trigger`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        onClick={openCalendar}
      >
        <span>
          {validValue(value, type)
            ? type === 'month'
              ? format(`${value}-01`, { month: 'long', year: 'numeric' })
              : `${format(value, { day: '2-digit', month: '2-digit', year: 'numeric' })}${type === 'datetime-local' ? ` · ${value.slice(11, 16)}` : ''}`
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
                data-unsaved-change={value ? '' : undefined}
                onClick={() => {
                  onChange({ target: { value: '' } });
                  setOpen(false);
                }}
              >
                {text('Очистить', 'Тазалау', 'Clear')}
              </button>
            )}
            <button type="button" className="btn-outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-classic"
              disabled={!valid}
              data-unsaved-change={candidate !== value ? '' : undefined}
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
              aria-label={
                type === 'month'
                  ? text('Предыдущий год', 'Алдыңғы жыл', 'Previous year')
                  : t('id.previousMonth')
              }
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
                if (type === 'month') setDraft(`${month.slice(0, 4)}-${e.target.value}-01`);
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
                if (type === 'month') setDraft(`${e.target.value}-${month.slice(5)}-01`);
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
              aria-label={
                type === 'month'
                  ? text('Следующий год', 'Келесі жыл', 'Next year')
                  : t('id.nextMonth')
              }
              onClick={() => shift(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          {type === 'month' ? (
            <div className="date-input-months" role="group" aria-label={label} ref={grid}>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => {
                const date = `${month.slice(0, 4)}-${m}-01`;
                const value = date.slice(0, 7);
                return (
                  <button
                    key={m}
                    type="button"
                    data-date={date}
                    aria-label={format(date, { month: 'long', year: 'numeric' })}
                    aria-pressed={draft.slice(0, 7) === value}
                    disabled={!!((min && value < min) || (max && value > max))}
                    onClick={() => {
                      setDraft(date);
                      setFocus(date);
                      setMonth(value);
                    }}
                  >
                    {format(date, { month: 'short' })}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
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
                    aria-current={day === today ? 'date' : undefined}
                    disabled={
                      !!((min && day < min.slice(0, 10)) || (max && day > max.slice(0, 10)))
                    }
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
                      const special = ['Home', 'End', 'PageUp', 'PageDown'].includes(event.key);
                      if (!delta && !special) return;
                      event.preventDefault();
                      const date = parse(day);
                      if (delta) date.setDate(date.getDate() + delta);
                      else if (event.key === 'Home')
                        date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
                      else if (event.key === 'End')
                        date.setDate(date.getDate() + 6 - ((date.getDay() + 6) % 7));
                      else {
                        const originalDay = date.getDate();
                        date.setDate(1);
                        date.setMonth(date.getMonth() + (event.key === 'PageUp' ? -1 : 1));
                        const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
                        date.setDate(Math.min(originalDay, last));
                      }
                      const next = iso(date);
                      if ((min && next < min.slice(0, 10)) || (max && next > max.slice(0, 10)))
                        return;
                      setMonth(next.slice(0, 7));
                      setFocus(next);
                    }}
                  >
                    {Number(day.slice(8))}
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            type="button"
            className="btn-outline date-input-today"
            disabled={
              !!((min && todayValue < min.slice(0, 10)) || (max && todayValue > max.slice(0, 10)))
            }
            onClick={() => {
              const date = type === 'month' ? `${todayValue}-01` : today;
              setDraft(date);
              setMonth(date.slice(0, 7));
              setFocus(date);
            }}
          >
            {text('Сегодня', 'Бүгін', 'Today')}
          </button>
          {type === 'datetime-local' && (
            <label className="field-group">
              <span>{text('Время', 'Уақыт', 'Time')}</span>
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
            {draft &&
              format(draft, {
                ...(type !== 'month' ? ({ day: 'numeric' } as const) : {}),
                month: 'long',
                year: 'numeric',
              })}
          </p>
          {!valid && (
            <p className="inline-alert inline-alert-error" role="alert">
              {text(
                'Выберите дату и время в допустимом диапазоне',
                'Рұқсат етілген күн мен уақытты таңдаңыз',
                'Choose a date and time within the allowed range',
              )}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
