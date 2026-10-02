import { useI18n } from '../lib/i18n';

export interface LocationSchedule {
  open: string;
  close: string;
  roundTheClock: boolean;
  photoDayShiftStart: string;
  photoNightShiftStart: string;
}
export const validPhotoShifts = (value: LocationSchedule) =>
  /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.photoDayShiftStart) &&
  /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.photoNightShiftStart) &&
  value.photoDayShiftStart < value.photoNightShiftStart;

export default function LocationScheduleFields({
  id,
  value,
  onChange,
}: {
  id: string;
  value: LocationSchedule;
  onChange: (change: Partial<LocationSchedule>) => void;
}) {
  const { t, locale } = useI18n();
  const text = (ru: string, kk: string) => (locale === 'kk' ? kk : ru);
  const fields = value.roundTheClock
    ? [
        ['photoDayShiftStart', text('Начало 1 смены', '1 ауысымның басталуы'), '08:00'],
        ['photoNightShiftStart', text('Начало 2 смены', '2 ауысымның басталуы'), '21:00'],
      ]
    : [
        ['open', t('locations.opensAt'), '08:00'],
        ['close', t('locations.closesAt'), '21:00'],
      ];
  return (
    <fieldset className="form-section">
      <legend>{t('locations.hours')}</legend>
      <label className="switch-row">
        <input
          type="checkbox"
          checked={value.roundTheClock}
          onChange={(event) => onChange({ roundTheClock: event.target.checked })}
        />
        <span className="switch-control" aria-hidden="true" />
        <span>{text('Работает 24/7', 'Тәулік бойы жұмыс істейді')}</span>
      </label>
      <div className="form-grid form-grid-2">
        {fields.map(([key, label, placeholder]) => (
          <div className="field-group" key={key}>
            <label className="field-label" htmlFor={`${id}-${key}`}>
              {label}
            </label>
            <input
              id={`${id}-${key}`}
              className="input-classic"
              type={value.roundTheClock ? 'time' : 'text'}
              inputMode="numeric"
              value={value[key as keyof Omit<LocationSchedule, 'roundTheClock'>]}
              onChange={(event) => onChange({ [key]: event.target.value })}
              placeholder={placeholder}
              required
            />
          </div>
        ))}
      </div>
      {value.roundTheClock && (
        <p className="field-hint">
          {text('Фотоотчёты по сменам', 'Ауысымдар бойынша фотоесептер')} ·{' '}
          {value.photoDayShiftStart}–{value.photoNightShiftStart} / {value.photoNightShiftStart}–
          {value.photoDayShiftStart}
        </p>
      )}
    </fieldset>
  );
}
