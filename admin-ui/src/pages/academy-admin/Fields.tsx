import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import type { JobRole, Text } from './model';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  const control = isValidElement(children)
    ? (children as ReactElement<{ id?: string; 'aria-describedby'?: string }>)
    : null;
  const inputId = control?.props.id || `${id}-field`;
  const hintId = `${id}-hint`;
  return (
    <div className="academy-field">
      <label htmlFor={inputId}>{label}</label>
      {control
        ? cloneElement(control, {
            id: inputId,
            'aria-describedby': hint
              ? [control.props['aria-describedby'], hintId].filter(Boolean).join(' ')
              : control.props['aria-describedby'],
          })
        : children}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}
export function RolePicker({
  roles,
  selected,
  onChange,
  text,
}: {
  roles: JobRole[];
  selected: string[];
  onChange: (ids: string[]) => void;
  text: Text;
}) {
  return (
    <fieldset className="academy-role-picker">
      <legend>{text('Доступ по должностям', 'Лауазымдар бойынша қолжетімділік')}</legend>
      <p>
        {text(
          'Если ничего не выбрано, курс или тест доступен всем сотрудникам с включённым обучением.',
          'Ештеңе таңдалмаса, оқу қосылған барлық қызметкерге қолжетімді болады.',
        )}
      </p>
      <div className="academy-role-options">
        {roles
          .filter((role) => role.active || selected.includes(role.id))
          .map((role) => (
            <label key={role.id}>
              <input
                type="checkbox"
                checked={selected.includes(role.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, role.id]
                      : selected.filter((id) => id !== role.id),
                  )
                }
              />
              {role.title}
              {!role.active && ` (${text('архив', 'мұрағат')})`}
            </label>
          ))}
      </div>
    </fieldset>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 1000,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        className="input-classic"
        type="number"
        min={min}
        max={max}
        step={1}
        required
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}
export function Status({ children, good = false }: { children: ReactNode; good?: boolean }) {
  return <span className={`academy-status ${good ? 'is-good' : ''}`}>{children}</span>;
}
export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <label className="academy-toggle" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}
