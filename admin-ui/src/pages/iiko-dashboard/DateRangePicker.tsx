import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { offsetDate, today, validRange } from './model';
import './date-range.css';

const monthOf = (date: string) => `${date.slice(0, 7)}-01`;
const shiftMonth = (date: string, offset: number) => {
  const value = new Date(`${monthOf(date)}T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + offset);
  return value.toISOString().slice(0, 10);
};
export default function DateRangePicker({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const { t, formatDate } = useI18n();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthOf(from));
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [anchor, setAnchor] = useState<string>();
  const [focus, setFocus] = useState(from);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const first = new Date(`${month}T12:00:00Z`);
  const gridStart = offsetDate(month, -(first.getUTCDay() + 6) % 7);
  const dates = Array.from({ length: 42 }, (_, index) => offsetDate(gridStart, index));
  const year = Number(month.slice(0, 4));
  const currentYear = Number(today().slice(0, 4));
  const moveFocus = (date: string) => {
    setFocus(date);
    setMonth(monthOf(date));
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus(),
    );
  };
  return (
    <div
      className="id-date-range"
      ref={root}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        // Native month/year menus and touch browsers can temporarily clear focus.
        // Closing on relatedTarget=null removes Apply before its click is delivered.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
          setOpen(false);
      }}
    >
      <span className="id-date-label">{t('id.period')}</span>
      <button
        ref={trigger}
        type="button"
        className="id-date-trigger"
        aria-expanded={open}
        aria-label={t('id.choosePeriod')}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setStart(from);
          setEnd(to);
          setAnchor(undefined);
          setMonth(monthOf(from));
          setFocus(from);
          setOpen(true);
        }}
      >
        <CalendarDays size={16} />
        {formatDate(from, { day: '2-digit', month: 'short' })} —{' '}
        {formatDate(to, { day: '2-digit', month: 'short', year: 'numeric' })}
      </button>
      {open && (
        <div className="id-calendar" role="group" aria-label={t('id.choosePeriod')}>
          <div className="id-calendar-heading">
            <button
              type="button"
              aria-label={t('id.previousMonth')}
              onClick={() => {
                const next = shiftMonth(month, -1);
                setMonth(next);
                setFocus(next);
              }}
            >
              <ChevronLeft size={17} />
            </button>
            <select
              aria-label={t('id.calendarMonth')}
              value={month.slice(5, 7)}
              onChange={(event) => {
                const next = `${year}-${event.target.value}-01`;
                setMonth(next);
                setFocus(next);
              }}
            >
              {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map(
                (value) => (
                  <option key={value} value={value}>
                    {formatDate(`${year}-${value}-01`, { month: 'long' })}
                  </option>
                ),
              )}
            </select>
            <select
              aria-label={t('id.calendarYear')}
              value={year}
              onChange={(event) => {
                const next = `${event.target.value}-${month.slice(5, 7)}-01`;
                setMonth(next);
                setFocus(next);
              }}
            >
              {Array.from(
                { length: Math.max(currentYear + 10, year) - Math.min(currentYear - 15, year) + 1 },
                (_, index) => Math.min(currentYear - 15, year) + index,
              ).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <button
              type="button"
              aria-label={t('id.nextMonth')}
              onClick={() => {
                const next = shiftMonth(month, 1);
                setMonth(next);
                setFocus(next);
              }}
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <div className="id-calendar-weekdays" aria-hidden="true">
            {dates.slice(0, 7).map((date) => (
              <span key={date}>{formatDate(date, { weekday: 'short' })}</span>
            ))}
          </div>
          <div
            className="id-calendar-days"
            role="group"
            aria-label={t(anchor ? 'id.chooseEnd' : 'id.chooseStart')}
          >
            {dates.map((date) => (
              <button
                type="button"
                key={date}
                data-date={date}
                tabIndex={focus === date ? 0 : -1}
                aria-label={formatDate(date, { day: 'numeric', month: 'long', year: 'numeric' })}
                aria-pressed={date >= start && date <= end}
                aria-current={date === today() ? 'date' : undefined}
                className={[
                  date.slice(0, 7) !== month.slice(0, 7) ? 'is-outside' : '',
                  date === start || date === end ? 'is-edge' : '',
                  date > start && date < end ? 'is-range' : '',
                ].join(' ')}
                onClick={() => {
                  setFocus(date);
                  if (!anchor) {
                    setStart(date);
                    setEnd(date);
                    setAnchor(date);
                  } else {
                    setStart(date < anchor ? date : anchor);
                    setEnd(date > anchor ? date : anchor);
                    setAnchor(undefined);
                  }
                }}
                onKeyDown={(event) => {
                  let next: string | undefined;
                  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[
                    event.key
                  ];
                  if (delta) next = offsetDate(date, delta);
                  if (event.key === 'Home')
                    next = offsetDate(date, -(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7);
                  if (event.key === 'End')
                    next = offsetDate(
                      date,
                      6 - ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7),
                    );
                  if (event.key === 'PageUp') next = shiftMonth(date, -1);
                  if (event.key === 'PageDown') next = shiftMonth(date, 1);
                  if (next) {
                    event.preventDefault();
                    moveFocus(next);
                  }
                }}
              >
                {Number(date.slice(8))}
              </button>
            ))}
          </div>
          <div className="id-calendar-selection" aria-live="polite">
            <span>{t(anchor ? 'id.chooseEnd' : 'id.period')}</span>
            <strong>
              {formatDate(start, { day: 'numeric', month: 'short' })} —{' '}
              {formatDate(end, { day: 'numeric', month: 'short' })}
            </strong>
          </div>
          <button
            type="button"
            className="id-calendar-whole-month"
            onClick={() => {
              setStart(month);
              setEnd(offsetDate(shiftMonth(month, 1), -1));
              setAnchor(undefined);
            }}
          >
            {t('id.selectMonth')}
          </button>
          {!validRange(start, end) && <p role="alert">{t('id.range')}</p>}
          <div className="id-calendar-footer">
            <button type="button" onClick={close}>
              {t('id.cancel')}
            </button>
            <button
              type="button"
              className="id-calendar-apply"
              disabled={!validRange(start, end)}
              onClick={() => {
                onChange(start, end);
                close();
              }}
            >
              {t('id.apply')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
