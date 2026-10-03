import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import DateRangePicker from './DateRangePicker';

beforeEach(() => localStorage.setItem('adminLocale', 'ru'));

const picker = () => {
  const change = vi.fn();
  render(
    <I18nProvider>
      <DateRangePicker from="2026-09-01" to="2026-09-07" onChange={change} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать период' }));
  return change;
};

it('keeps month/year navigation local and immediately applies the whole selected month', () => {
  const change = picker();
  fireEvent.change(screen.getByLabelText('Месяц'), { target: { value: '08' } });
  fireEvent.blur(screen.getByLabelText('Месяц'), { relatedTarget: null });
  expect(change).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Применить' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать весь месяц' }));
  expect(change).toHaveBeenCalledExactlyOnceWith('2026-08-01', '2026-08-31');
  expect(screen.queryByLabelText('Месяц')).not.toBeInTheDocument();
});

it('applies a reversed cross-month selection on the second date and cancels the first-date draft', () => {
  const change = picker();
  fireEvent.click(screen.getByRole('button', { name: /^5 сентября 2026/ }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^28 августа 2026/ }));
  expect(change).toHaveBeenCalledExactlyOnceWith('2026-08-28', '2026-09-05');
  expect(screen.queryByLabelText('Месяц')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Выбрать период' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать период' }));
  fireEvent.click(screen.getByRole('button', { name: /^8 сентября 2026/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(change).toHaveBeenCalledTimes(1);
});

it('allows a single-day period when the second click chooses the same date', () => {
  const change = picker();
  fireEvent.click(screen.getByRole('button', { name: /^3 сентября 2026/ }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^3 сентября 2026/ }));
  expect(change).toHaveBeenCalledExactlyOnceWith('2026-09-03', '2026-09-03');
  expect(screen.getByRole('button', { name: 'Выбрать период' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

it('uses Enter and Space for the same two-date flow with arrow-key navigation', async () => {
  const user = userEvent.setup();
  const change = picker();
  screen.getByRole('button', { name: /^1 сентября 2026/ }).focus();
  await user.keyboard('{Enter}');
  expect(change).not.toHaveBeenCalled();
  await user.keyboard('{ArrowRight}');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^2 сентября 2026/ })).toHaveFocus(),
  );
  await user.keyboard(' ');
  expect(change).toHaveBeenCalledExactlyOnceWith('2026-09-01', '2026-09-02');
  expect(screen.queryByLabelText('Месяц')).not.toBeInTheDocument();
});

it('blocks a range over 367 days and lets the second date be corrected at the limit', () => {
  const change = picker();
  fireEvent.click(screen.getByRole('button', { name: /^1 сентября 2026/ }));
  fireEvent.change(screen.getByLabelText('Год'), { target: { value: '2027' } });
  fireEvent.click(screen.getByRole('button', { name: /^3 сентября 2027/ }));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Выберите период не длиннее года');
  expect(screen.getByLabelText('Год')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^2 сентября 2027/ }));
  expect(change).toHaveBeenCalledExactlyOnceWith('2026-09-01', '2027-09-02');
  expect(screen.queryByLabelText('Год')).not.toBeInTheDocument();
});

it('navigates across months without committing and closes an unfinished selection with Escape', async () => {
  const change = picker();
  fireEvent.keyDown(screen.getByRole('button', { name: /^1 сентября 2026/ }), { key: 'ArrowLeft' });
  expect(await screen.findByRole('button', { name: /^31 августа 2026/ })).toHaveAttribute(
    'tabindex',
    '0',
  );
  fireEvent.click(screen.getByRole('button', { name: /^31 августа 2026/ }));
  fireEvent.change(screen.getByLabelText('Год'), { target: { value: '2028' } });
  expect(change).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText('Год'), { key: 'Escape' });
  expect(screen.queryByLabelText('Год')).not.toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
});
