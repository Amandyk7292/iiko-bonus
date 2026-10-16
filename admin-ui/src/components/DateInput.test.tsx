import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { I18nProvider } from '../lib/i18n';
import DateInput from './DateInput';
afterEach(cleanup);
it('keeps a draft until apply, supports leap dates and local date values', () => {
  const change = vi.fn();
  render(
    <I18nProvider>
      <DateInput value="2028-02-28" required onChange={change} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /28.02.2028/ }));
  fireEvent.click(screen.getByRole('button', { name: /29 февраля 2028/ }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
  expect(change).toHaveBeenCalledWith({ target: { value: '2028-02-29' } });
});
it('enforces date and time bounds without losing the selected time', () => {
  const change = vi.fn();
  render(
    <I18nProvider>
      <DateInput
        value="2026-09-27T14:30"
        type="datetime-local"
        min="2026-09-27T15:00"
        onChange={change}
      />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /27.09.2026/ }));
  expect(screen.getByRole('button', { name: /26 сентября 2026/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Применить' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Время'), { target: { value: '16:45' } });
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
  expect(change).toHaveBeenCalledWith({ target: { value: '2026-09-27T16:45' } });
});
it('cancels without mutation and explicitly clears optional filters', () => {
  const change = vi.fn();
  render(
    <I18nProvider>
      <DateInput value="2026-09-27" onChange={change} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /27.09.2026/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /27.09.2026/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Очистить' }));
  expect(change).toHaveBeenCalledWith({ target: { value: '' } });
});

it('preserves labels and hints, validates required forms and serializes the chosen ISO date', () => {
  const submit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  function Form() {
    const [value, setValue] = useState('');
    return (
      <I18nProvider>
        <form aria-label="Обход" onSubmit={submit}>
          <label htmlFor="deadline">Дата обхода</label>
          <p id="date-hint">До конца месяца</p>
          <DateInput
            id="deadline"
            name="deadline"
            required
            value={value}
            min="2026-10-01"
            max="2026-10-31"
            aria-describedby="date-hint"
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit">Сохранить</button>
        </form>
      </I18nProvider>
    );
  }
  render(<Form />);
  const form = screen.getByRole('form', { name: 'Обход' });
  expect(screen.getByLabelText('Дата обхода')).toHaveAccessibleDescription('До конца месяца');
  fireEvent.submit(form);
  expect(submit).not.toHaveBeenCalled();
  const calendar = screen.getByRole('dialog', { name: 'Выбрать дату' });
  fireEvent.click(calendar.querySelector('[data-date="2026-10-20"]')!);
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
  expect(screen.getByLabelText('Дата обхода')).toHaveTextContent('20.10.2026');
  expect(new FormData(form as HTMLFormElement).get('deadline')).toBe('2026-10-20');
  fireEvent.submit(form);
  expect(submit).toHaveBeenCalledTimes(1);
});

it('blocks out-of-range form values while allowing empty optional or disabled date controls', () => {
  const submit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  const form = (value: string, disabled = false) => (
    <I18nProvider>
      <form aria-label="Фильтр" onSubmit={submit}>
        <DateInput
          aria-label="Дата"
          value={value}
          min="2026-10-01"
          max="2026-10-31"
          disabled={disabled}
          onChange={vi.fn()}
        />
      </form>
    </I18nProvider>
  );
  const view = render(form('2026-09-30'));
  fireEvent.submit(screen.getByRole('form'));
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Выбрать дату' })).toBeVisible();
  view.rerender(form(''));
  fireEvent.submit(screen.getByRole('form'));
  expect(submit).toHaveBeenCalledTimes(1);
  view.rerender(form('2026-09-30', true));
  fireEvent.submit(screen.getByRole('form'));
  expect(submit).toHaveBeenCalledTimes(2);
});

it('moves through month ends and weeks using the keyboard without selecting until apply', () => {
  const change = vi.fn();
  render(
    <I18nProvider>
      <DateInput value="2028-01-31" onChange={change} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /31.01.2028/ }));
  fireEvent.keyDown(screen.getByRole('button', { name: /31 января 2028/ }), { key: 'PageDown' });
  const leap = screen.getByRole('button', { name: /29 февраля 2028/ });
  expect(leap).toHaveAttribute('tabindex', '0');
  fireEvent.keyDown(leap, { key: 'Home' });
  expect(screen.getByRole('button', { name: /28 февраля 2028/ })).toHaveAttribute('tabindex', '0');
  expect(change).not.toHaveBeenCalled();
});

it('chooses a bounded payroll month without a day calendar or UTC conversion', () => {
  const change = vi.fn();
  render(
    <I18nProvider>
      <DateInput type="month" value="2026-10" min="2026-08" max="2026-12" onChange={change} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /октябрь 2026/ }));
  const calendar = screen.getByRole('dialog', { name: 'Выбрать месяц' });
  expect(calendar.querySelectorAll('[data-date]')).toHaveLength(12);
  expect(screen.getByRole('button', { name: /июль 2026/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /декабрь 2026/ }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
  expect(change).toHaveBeenCalledWith({ target: { value: '2026-12' } });
});
