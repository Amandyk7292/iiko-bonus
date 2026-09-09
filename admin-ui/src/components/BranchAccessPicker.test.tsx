import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import BranchAccessPicker from './BranchAccessPicker';

const locations = [
  { id: 'aktau', name: 'Premium Plaza', address: '18А микрорайон, 1', city: 'Актау' },
  { id: 'astana', name: 'Улы Дала', address: 'проспект Улы Дала, 67', city: 'Астана' },
  { id: 'missing', name: 'Новый филиал', address: 'Тестовый адрес' },
];
function Picker({ single = false }: { single?: boolean }) {
  const [selected, setSelected] = useState(['aktau']);
  return (
    <I18nProvider>
      <BranchAccessPicker
        locations={locations}
        selectedIds={selected}
        single={single}
        onChange={setSelected}
      />
    </I18nProvider>
  );
}
beforeEach(() => {
  localStorage.setItem('adminLocale', 'ru');
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

it('filters by city without losing branch permissions hidden by the filter', async () => {
  const user = userEvent.setup();
  render(<Picker />);
  await user.click(screen.getByRole('combobox', { name: 'Город' }));
  await user.click(screen.getByRole('option', { name: 'Астана' }));
  expect(screen.queryByRole('checkbox', { name: /Premium Plaza/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: /Улы Дала/ }));
  expect(screen.getByText('Выбрано: 2')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Показать выбранные' }));
  expect(screen.getByRole('checkbox', { name: /Premium Plaza/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /Улы Дала/ })).toBeChecked();
  expect(screen.queryByRole('checkbox', { name: /Новый филиал/ })).not.toBeInTheDocument();
});

it('searches addresses and can reset an empty result', async () => {
  const user = userEvent.setup();
  render(<Picker />);
  await user.type(screen.getByRole('searchbox'), '18а микрорайон');
  expect(screen.getByRole('checkbox', { name: /Premium Plaza/ })).toBeChecked();
  expect(screen.queryByRole('checkbox', { name: /Улы Дала/ })).not.toBeInTheDocument();
  await user.clear(screen.getByRole('searchbox'));
  await user.type(screen.getByRole('searchbox'), 'несуществующий');
  expect(screen.getByRole('status')).toHaveTextContent('Филиалы не найдены');
  await user.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
  expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  expect(screen.getByRole('heading', { name: /Город не указан/ })).toBeInTheDocument();
});

it('keeps exactly one branch for a cashier when changing cities', async () => {
  const user = userEvent.setup();
  render(<Picker single />);
  await user.click(screen.getByRole('combobox', { name: 'Город' }));
  await user.click(screen.getByRole('option', { name: 'Астана' }));
  await user.click(screen.getByRole('radio', { name: /Улы Дала/ }));
  await user.click(screen.getByRole('combobox', { name: 'Город' }));
  await user.click(screen.getByRole('option', { name: 'Все города' }));
  expect(screen.getByRole('radio', { name: /Premium Plaza/ })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: /Улы Дала/ })).toBeChecked();
  expect(screen.getByText('Выбрано: 1')).toBeInTheDocument();
});
