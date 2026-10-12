import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import type { Prize, Text } from './model';

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = `${useId()}-fortune`;
  const control = isValidElement(children)
    ? (children as ReactElement<{ id?: string; 'aria-describedby'?: string }>)
    : null;
  const inputId = control?.props.id || id;
  return (
    <div className="fortune-field">
      <label htmlFor={inputId}>{label}</label>
      {control
        ? cloneElement(control, {
            id: inputId,
            'aria-describedby': hint ? `${id}-hint` : undefined,
          })
        : children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function WheelPreview({ prizes, text }: { prizes: Prize[]; text: Text }) {
  const active = prizes.filter((prize) => prize.active);
  const sectors = active.length
    ? active
    : [{ color: '#f5e4c3', label: text('Ваши призы', 'Сыйлықтарыңыз') }];
  const background = `conic-gradient(${sectors.map((prize, index) => `${prize.color} ${(index * 100) / sectors.length}% ${((index + 1) * 100) / sectors.length}%`).join(',')})`;
  return (
    <div className="fortune-preview">
      <div className="fortune-wheel-frame" aria-hidden="true">
        <div className="fortune-wheel" style={{ background }}>
          <span className="fortune-wheel-center">Bulka</span>
        </div>
        <span className="fortune-wheel-pointer" />
      </div>
      <ul className="fortune-legend" aria-label={text('Секторы колеса', 'Дөңгелек секторлары')}>
        {sectors.map((prize, index) => (
          <li key={index}>
            <span style={{ background: prize.color }} />
            <span>{prize.label || text('Без названия', 'Атаусыз')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function campaignStatus(status: string, text: Text) {
  return status === 'active'
    ? text('Активна', 'Белсенді')
    : status === 'paused'
      ? text('Приостановлена', 'Кідіртілген')
      : text('Черновик', 'Жоба');
}
export function winnerStatus(status: string, text: Text) {
  return status === 'claimed'
    ? text('В аккаунте', 'Аккаунтта')
    : status === 'redeemed'
      ? text('Выдан', 'Берілген')
      : status === 'expired'
        ? text('Истёк', 'Мерзімі өткен')
        : text('Ожидает входа', 'Кіруді күтуде');
}
