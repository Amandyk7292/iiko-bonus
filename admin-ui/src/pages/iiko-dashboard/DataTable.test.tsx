import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import DataTable from './DataTable';
import type { Report } from './model';

it('keeps column selection usable and resets it when the report schema changes', () => {
  const sales: Report = {
    serverId: 'aktau-chain',
    fetchedAt: '2026-09-07',
    columns: {
      name: { name: 'Товар', type: 'STRING' },
      revenue: { name: 'Выручка', type: 'MONEY' },
    },
    rows: [{ name: 'Булочка', revenue: 125.5 }],
  };
  const table = render(
    <I18nProvider>
      <DataTable report={sales} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByText('Колонки'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Выручка' }));
  expect(screen.queryByRole('columnheader', { name: 'Выручка' })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Товар' })).toBeDisabled();
  const stock: Report = {
    ...sales,
    columns: { store: { name: 'Склад', type: 'STRING' } },
    rows: [{ store: 'Пекарня' }],
  };
  table.rerender(
    <I18nProvider>
      <DataTable report={stock} />
    </I18nProvider>,
  );
  expect(screen.getByRole('columnheader', { name: 'Склад' })).toBeVisible();
  expect(screen.getByText('Пекарня')).toBeVisible();
});
