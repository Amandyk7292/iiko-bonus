import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import DateRangePicker from './DateRangePicker';

it('applies a reversed cross-month selection once and cancels drafts', () => {
  const change = vi.fn();
  render(
    <I18nProvider>
      <DateRangePicker from="2026-09-01" to="2026-09-07" onChange={change} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать период' }));
  fireEvent.click(screen.getByRole('button', { name: /^5 сентября 2026/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
  fireEvent.click(screen.getByRole('button', { name: /^28 августа 2026/ }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
  expect(change).toHaveBeenCalledExactlyOnceWith('2026-08-28', '2026-09-05');
  expect(screen.queryByLabelText('Месяц')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать период' }));
  fireEvent.click(screen.getByRole('button', { name: /^8 сентября 2026/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(change).toHaveBeenCalledTimes(1);
});
it('supports keyboard navigation and prevents an excessive reporting range', async () => {
  render(
    <I18nProvider>
      <DateRangePicker from="2026-09-01" to="2026-09-07" onChange={vi.fn()} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать период' }));
  fireEvent.keyDown(screen.getByRole('button', { name: /^1 сентября 2026/ }), { key: 'ArrowLeft' });
  expect(await screen.findByRole('button', { name: /^31 августа 2026/ })).toHaveAttribute(
    'tabindex',
    '0',
  );
  fireEvent.click(screen.getByRole('button', { name: /^31 августа 2026/ }));
  fireEvent.change(screen.getByLabelText('Год'), { target: { value: '2028' } });
  fireEvent.click(screen.getByRole('button', { name: /^31 августа 2028/ }));
  expect(screen.getByRole('button', { name: 'Применить' })).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText('Год'), { key: 'Escape' });
  expect(screen.queryByLabelText('Год')).not.toBeInTheDocument();
});
