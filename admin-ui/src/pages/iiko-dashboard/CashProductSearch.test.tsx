import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import CashProductSearch, { type CashProduct } from './CashProductSearch';
import { loadControls } from './load-controls';

vi.mock('./load-controls', () => ({ loadControls: vi.fn() }));
const scope = {
  serverId: 'astana-chain',
  from: '2026-09-18',
  to: '2026-09-19',
  department: 'Branch',
};
const products = [
  { id: 'bun', name: 'Булочка Лакомка' },
  { id: 'coffee', name: 'Кофе Американо' },
  { id: 'latte', name: 'Кофе Латте' },
];
const onSelect = vi.fn();
function SearchField({ shift = 'session-1' }: { shift?: string }) {
  const [value, setValue] = useState('');
  return (
    <CashProductSearch
      key={shift}
      scope={scope}
      shift={shift}
      refresh={0}
      value={value}
      onChange={setValue}
      onSelect={onSelect}
    />
  );
}
beforeEach(() => {
  onSelect.mockReset();
  vi.mocked(loadControls).mockReset().mockResolvedValue({ products });
});

it('loads the selected shift once, filters locally and supports keyboard selection', async () => {
  render(<SearchField />);
  expect(loadControls).not.toHaveBeenCalled();
  const input = screen.getByRole('combobox', { name: 'Товар' });
  fireEvent.focus(input);
  await screen.findByRole('option', { name: 'Булочка Лакомка' });
  for (const value of ['к', 'ко', '  КОФЕ  ']) fireEvent.change(input, { target: { value } });
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(screen.queryByRole('option', { name: 'Булочка Лакомка' })).not.toBeInTheDocument();
  expect(loadControls).toHaveBeenCalledTimes(1);
  expect(loadControls).toHaveBeenCalledWith(
    { ...scope, shift: 'session-1', search: '' },
    expect.anything(),
    '/iiko-dashboard/cash-report',
  );
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(screen.getByRole('option', { name: 'Кофе Американо' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSelect).toHaveBeenCalledWith(products[2]);
  expect(input).toHaveAttribute('aria-expanded', 'false');
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(loadControls).toHaveBeenCalledTimes(1);
});

it('shows no matches and lets Enter submit free text without choosing another product', async () => {
  render(<SearchField />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'неизвестный' } });
  expect(await screen.findByText('В этой смене совпадений нет')).toBeInTheDocument();
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('allows manual search while loading and after an error, with a retry for suggestions', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(loadControls).mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  render(<SearchField />);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  expect(screen.getByRole('status')).toHaveTextContent('Загружаем товары смены');
  expect(input).toBeEnabled();
  await act(async () => reject(new Error('offline')));
  expect(screen.getByRole('status')).toHaveTextContent('Можно искать вручную');
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  expect(await screen.findByRole('option', { name: 'Кофе Американо' })).toBeInTheDocument();
});

it('aborts suggestions when the shift changes and ignores the old response', async () => {
  let resolve!: (result: { products: CashProduct[] }) => void;
  vi.mocked(loadControls).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(<SearchField />);
  fireEvent.focus(screen.getByRole('combobox'));
  const oldSignal = vi.mocked(loadControls).mock.calls[0][1];
  view.rerender(<SearchField shift="session-2" />);
  expect(oldSignal.aborted).toBe(true);
  vi.mocked(loadControls).mockResolvedValueOnce({ products: [{ id: 'samsa', name: 'Самса' }] });
  fireEvent.focus(screen.getByRole('combobox'));
  await screen.findByRole('option', { name: 'Самса' });
  await act(async () => resolve({ products }));
  await waitFor(() =>
    expect(screen.queryByRole('option', { name: 'Кофе Американо' })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('option', { name: 'Самса' })).toBeInTheDocument();
});
