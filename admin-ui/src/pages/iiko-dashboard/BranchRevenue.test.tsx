import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import BranchRevenue from './BranchRevenue';
import type { Report } from './model';

it('ranks every branch numerically, with missing revenue last and no top-ten cutoff', () => {
  localStorage.setItem('adminLocale', 'ru');
  const rows = [
    { Department: 'Нет данных', DishDiscountSumInt: null },
    { Department: 'Меньше', DishDiscountSumInt: '900' },
    { Department: 'Больше', DishDiscountSumInt: '12000' },
    ...Array.from({ length: 10 }, (_, index) => ({ Department: `Точка ${index}`, DishDiscountSumInt: 0 })),
    { Department: 'Возвраты', DishDiscountSumInt: -50 },
  ];
  const report: Report = { rows, columns: {}, serverId: 'aktau-chain', fetchedAt: '' };
  render(<I18nProvider><BranchRevenue report={report} /></I18nProvider>);
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(14);
  expect(items[0]).toHaveTextContent('Больше');
  expect(items[1]).toHaveTextContent('Меньше');
  expect(items[12]).toHaveTextContent('Возвраты');
  expect(items[13]).toHaveTextContent('Нет данных');
  expect(within(items[13]).getByText('—')).toBeInTheDocument();
  expect(report.rows[0].Department).toBe('Нет данных');
});
