import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import CashReport, { cashItemMatches } from './CashReport';
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

describe('cash report product highlighting', () => {
  it('matches a submitted product regardless of case and surrounding spaces', () => {
    expect(cashItemMatches('Кофе Американо', '  кофе  ')).toBe(true);
    expect(cashItemMatches('Кофе Американо', 'латте')).toBe(false);
  });

  it('does not highlight every receipt item before search is submitted', () => {
    expect(cashItemMatches('Кофе Американо', '')).toBe(false);
    expect(cashItemMatches('Кофе Американо', '   ')).toBe(false);
  });
});

describe('cash report page', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    vi.mocked(loadControls)
      .mockReset()
      .mockImplementation(async (rawQuery) => {
        const query = rawQuery as { shift?: string; search?: string };
        return {
          shifts: [{ id: '106', checks: 273, revenue: 1000 }],
          checks:
            query.shift === '106' && query.search === 'кофе'
              ? [
                  {
                    id: 'check-4',
                    shift: '106',
                    number: 4,
                    date: '2026-09-18',
                    time: '08:18',
                    department: 'Астана',
                    cashier: 'Кассир',
                    total: 990,
                    items: [
                      { id: 'coffee', name: 'Кофе Американо', unit: 'шт', quantity: 1, total: 990 },
                    ],
                  },
                ]
              : [],
          summary: query.search
            ? { checks: 1, quantity: 1, revenue: 990 }
            : { checks: 0, quantity: 0, revenue: 0 },
        };
      });
  });

  it('shows loading while shifts are being requested', () => {
    vi.mocked(loadControls).mockReturnValue(new Promise(() => {}));
    render(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Получаем данные iiko');
  });

  it('selects a shift, searches and renders the matching complete check', async () => {
    render(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Кассовая смена'), { target: { value: '106' } });
    await waitFor(() =>
      expect(loadControls).toHaveBeenCalledWith(
        expect.objectContaining({ shift: '106' }),
        expect.anything(),
        expect.anything(),
      ),
    );
    fireEvent.change(screen.getByPlaceholderText('Например, Синнабон'), {
      target: { value: 'кофе' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    await waitFor(() =>
      expect(loadControls).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'кофе', shift: '106' }),
        expect.anything(),
        expect.anything(),
      ),
    );
    expect(await screen.findByText('Чек № 4')).toBeInTheDocument();
    expect(screen.getAllByText('990 ₸')).toHaveLength(3);
  });

  it('shows an API error', async () => {
    vi.mocked(loadControls).mockRejectedValue(new Error('offline'));
    render(
      <I18nProvider>
        <CashReport base={base} department="branch-1" refresh={0} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
