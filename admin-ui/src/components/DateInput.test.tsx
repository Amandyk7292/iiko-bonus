import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
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
