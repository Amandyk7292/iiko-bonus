import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import DateInput from './DateInput';
import GuardedModal from './GuardedModal';

afterEach(cleanup);

function setup() {
  const close = vi.fn();
  function Editor() {
    const [value, setValue] = useState('2026-10-16');
    return (
      <BrowserRouter>
        <I18nProvider>
          <GuardedModal
            open
            title="Задание"
            onClose={close}
            footer={<button type="button">Отмена</button>}
          >
            <DateInput
              aria-label="Срок"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </GuardedModal>
        </I18nProvider>
      </BrowserRouter>
    );
  }
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: 'Срок' }));
  return { close, calendar: screen.getByRole('dialog', { name: 'Выбрать дату' }) };
}

it('cancels a calendar draft without closing or dirtying its parent editor', async () => {
  const { close, calendar } = setup();
  fireEvent.change(within(calendar).getByLabelText('Месяц'), { target: { value: '11' } });
  fireEvent.click(within(calendar).getByRole('button', { name: 'Отмена' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Выбрать дату' })).not.toBeInTheDocument(),
  );
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Задание' })).getByRole('button', { name: 'Отмена' }),
  );
  expect(close).toHaveBeenCalledOnce();
});

it.each(['Применить', 'Очистить'])('guards a changed date committed with %s', async (action) => {
  const { close, calendar } = setup();
  if (action === 'Применить') fireEvent.click(calendar.querySelector('[data-date="2026-10-20"]')!);
  fireEvent.click(within(calendar).getByRole('button', { name: action }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Выбрать дату' })).not.toBeInTheDocument(),
  );
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Задание' })).getByRole('button', { name: 'Отмена' }),
  );
  expect(close).not.toHaveBeenCalled();
  expect(screen.getAllByRole('dialog')).toHaveLength(2);
});

it('does not mark an unchanged date as a committed edit', async () => {
  const { close, calendar } = setup();
  fireEvent.click(within(calendar).getByRole('button', { name: 'Применить' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Выбрать дату' })).not.toBeInTheDocument(),
  );
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Задание' })).getByRole('button', { name: 'Отмена' }),
  );
  expect(close).toHaveBeenCalledOnce();
});
