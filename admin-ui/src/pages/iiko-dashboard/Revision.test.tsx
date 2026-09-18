import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import Revision, { revisionRows, revisionTotals } from './Revision';
import { loadControls } from './load-controls';

vi.mock('./load-controls', () => ({ loadControls: vi.fn() }));
const base = {
  serverId: 'astana-chain',
  reportType: 'SALES' as const,
  from: '2026-09-12',
  to: '2026-09-18',
  groupBy: [],
  aggregate: [],
  filters: [],
};

const row = (key: string, name: string, expected: number) => ({
  key,
  name,
  unit: 'шт',
  opening: 10,
  incoming: 2,
  sold: 3,
  writtenOff: 1,
  expected,
  systemBalance: expected,
});

describe('revision calculations', () => {
  it('separates shortage and surplus and totals only visible rows', () => {
    const rows = revisionRows(
      [row('a', 'Синнабон', 8), row('b', 'Кофе', 4), row('c', 'Чай', 2)],
      { a: '6', b: '5', c: '2' },
      '',
      true,
    );
    expect(rows.map(({ key, shortage, surplus }) => ({ key, shortage, surplus }))).toEqual([
      { key: 'a', shortage: 2, surplus: 0 },
      { key: 'b', shortage: 0, surplus: 1 },
    ]);
    expect(revisionTotals(rows)).toEqual({ shortage: 2, surplus: 1 });
  });

  it('keeps an empty or malformed physical count unclassified', () => {
    const rows = revisionRows([row('a', 'Кофе', 8)], { a: 'не число' }, 'КОФ', false);
    expect(rows[0]).toMatchObject({ actual: Number.NaN, shortage: null, surplus: null });
  });
});

describe('revision page', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('adminLocale', 'ru');
    vi.mocked(loadControls).mockReset();
  });

  it('shows loading while the API request is pending', () => {
    vi.mocked(loadControls).mockReturnValue(new Promise(() => {}));
    render(
      <I18nProvider>
        <Revision base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Получаем данные iiko');
  });

  it('loads rows, filters them and recalculates shortage from physical count', async () => {
    vi.mocked(loadControls).mockResolvedValue({
      fetchedAt: '2026-09-18T10:00:00Z',
      rows: [row('a', 'Синнабон', 8), row('b', 'Кофе', 4)],
    });
    const view = render(
      <I18nProvider>
        <Revision base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Фактический остаток Синнабон'), {
      target: { value: '6' },
    });
    expect(view.container.querySelector('.id-revision-totals')).toHaveTextContent('Недостача 2');
    fireEvent.change(screen.getByPlaceholderText('Название товара'), { target: { value: 'коф' } });
    expect(screen.queryByText('Синнабон')).not.toBeInTheDocument();
    expect(screen.getByText('Кофе')).toBeInTheDocument();
  });

  it('shows an API error', async () => {
    vi.mocked(loadControls).mockRejectedValue(new Error('offline'));
    render(
      <I18nProvider>
        <Revision base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
