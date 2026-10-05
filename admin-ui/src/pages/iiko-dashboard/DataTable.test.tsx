import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import DataTable from './DataTable';
import type { Report } from './model';

const branches: Report = {
  serverId: 'aktau-chain',
  fetchedAt: '2026-10-05',
  columns: {
    name: { name: 'Точка', type: 'STRING' },
    amount: { name: 'Списано', type: 'MONEY' },
  },
  rows: [
    { name: 'Точка А', amount: 90 },
    { name: 'Точка Б', amount: 1200 },
    { name: 'Точка В', amount: 300 },
  ],
};

const rowNames = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent);

it('preserves three decimal places for small writeoff quantities while keeping money at two', () => {
  render(
    <I18nProvider>
      <DataTable
        report={{
          ...branches,
          columns: {
            WriteoffQuantity: { name: 'Списано, кг', type: 'AMOUNT' },
            WriteoffCost: { name: 'Списано, ₸', type: 'MONEY' },
          },
          rows: [
            { WriteoffQuantity: 0.001, WriteoffCost: 1.125 },
            { WriteoffQuantity: 0.125, WriteoffCost: 12.341 },
          ],
        }}
      />
    </I18nProvider>,
  );
  expect(screen.getByRole('cell', { name: '0,001' })).toBeVisible();
  expect(screen.getByRole('cell', { name: '0,125' })).toBeVisible();
  expect(screen.getByRole('cell', { name: '1,13' })).toBeVisible();
  expect(screen.getByRole('cell', { name: '12,34' })).toBeVisible();
});

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

it('starts with highest numeric amounts without changing source rows and allows manual sorting', () => {
  const report: Report = {
    ...branches,
    rows: Object.freeze(
      branches.rows.map((row) => Object.freeze({ ...row })),
    ) as unknown as Report['rows'],
  };
  render(
    <I18nProvider>
      <DataTable report={report} defaultSort={{ field: 'amount', direction: -1 }} />
    </I18nProvider>,
  );
  expect(rowNames()).toEqual(['Точка Б', 'Точка В', 'Точка А']);
  expect(screen.getByRole('columnheader', { name: 'Списано' })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  expect(report.rows.map((row) => row.name)).toEqual(['Точка А', 'Точка Б', 'Точка В']);

  fireEvent.click(screen.getByRole('button', { name: 'Списано' }));
  expect(rowNames()).toEqual(['Точка А', 'Точка В', 'Точка Б']);
  expect(screen.getByRole('columnheader', { name: 'Списано' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Списано' }));
  expect(rowNames()).toEqual(['Точка Б', 'Точка В', 'Точка А']);
});

it('keeps a manual sort on refresh with an equivalent inline default and resets for changed defaults', () => {
  const table = render(
    <I18nProvider>
      <DataTable report={branches} defaultSort={{ field: 'amount', direction: -1 }} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Точка' }));
  expect(rowNames()).toEqual(['Точка В', 'Точка Б', 'Точка А']);
  table.rerender(
    <I18nProvider>
      <DataTable
        report={{ ...branches, rows: [...branches.rows] }}
        defaultSort={{ field: 'amount', direction: -1 }}
      />
    </I18nProvider>,
  );
  expect(rowNames()).toEqual(['Точка В', 'Точка Б', 'Точка А']);

  table.rerender(
    <I18nProvider>
      <DataTable report={branches} defaultSort={{ field: 'amount', direction: 1 }} />
    </I18nProvider>,
  );
  expect(rowNames()).toEqual(['Точка А', 'Точка В', 'Точка Б']);
  table.rerender(
    <I18nProvider>
      <DataTable report={branches} defaultSort={{ field: 'name', direction: 1 }} />
    </I18nProvider>,
  );
  expect(rowNames()).toEqual(['Точка А', 'Точка Б', 'Точка В']);
});

it('reapplies the default on a changed schema and restores source order when the default is removed', () => {
  const table = render(
    <I18nProvider>
      <DataTable report={branches} defaultSort={{ field: 'amount', direction: -1 }} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Точка' }));
  const nextReport: Report = {
    ...branches,
    columns: { ...branches.columns, count: { name: 'Документов', type: 'INTEGER' } },
    rows: branches.rows.map((row) => ({ ...row, count: 1 })),
  };
  table.rerender(
    <I18nProvider>
      <DataTable report={nextReport} defaultSort={{ field: 'amount', direction: -1 }} />
    </I18nProvider>,
  );
  expect(rowNames()).toEqual(['Точка Б', 'Точка В', 'Точка А']);
  table.rerender(
    <I18nProvider>
      <DataTable report={nextReport} />
    </I18nProvider>,
  );
  expect(rowNames()).toEqual(['Точка А', 'Точка Б', 'Точка В']);
});

it('preserves source order and existing manual sorting when no default sort is supplied', () => {
  const table = render(
    <I18nProvider>
      <DataTable report={branches} />
    </I18nProvider>,
  );
  expect(rowNames()).toEqual(['Точка А', 'Точка Б', 'Точка В']);
  fireEvent.click(screen.getByRole('button', { name: 'Списано' }));
  table.rerender(
    <I18nProvider>
      <DataTable report={{ ...branches, fetchedAt: '2026-10-06' }} />
    </I18nProvider>,
  );
  expect(rowNames()).toEqual(['Точка Б', 'Точка В', 'Точка А']);
});

it('uses custom document labels and selects once through a row, button or keyboard', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(
    <I18nProvider>
      <DataTable
        report={branches}
        onSelect={onSelect}
        selectLabel="Документы"
        getSelectLabel={(row) => `Документы: ${row.name}`}
      />
    </I18nProvider>,
  );
  expect(screen.getByRole('columnheader', { name: 'Документы' })).toBeVisible();
  await user.click(screen.getByText('Точка А'));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenLastCalledWith(branches.rows[0]);
  await user.click(screen.getByRole('button', { name: 'Документы: Точка Б' }));
  expect(onSelect).toHaveBeenCalledTimes(2);
  expect(onSelect).toHaveBeenLastCalledWith(branches.rows[1]);
  const button = screen.getByRole('button', { name: 'Документы: Точка В' });
  button.focus();
  await user.keyboard('{Enter}');
  expect(onSelect).toHaveBeenCalledTimes(3);
  expect(onSelect).toHaveBeenLastCalledWith(branches.rows[2]);
});
