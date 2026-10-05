import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import Controls, { type ControlMode } from './Controls';
import { loadControls } from './load-controls';
import { download } from './api';
import type { Query, Report } from './model';

vi.mock('./load-controls', () => ({ loadControls: vi.fn() }));
vi.mock('./api', () => ({ download: vi.fn() }));
vi.mock('react-chartjs-2', () => ({ Line: () => <div data-testid="trend-chart" /> }));

const base: Query = {
  serverId: 'aktau-chain',
  from: '2026-09-29',
  to: '2026-10-05',
  reportType: 'SALES',
  filters: [],
  groupBy: [],
  aggregate: [],
};
const branch = 'Bulka 19';
const similarBranch = 'Bulka 19А';
const cashier = 'Айдана М.';
const keyA = 'a'.repeat(64);
const keyB = 'b'.repeat(64);
const keyC = 'c'.repeat(64);
const keyD = 'd'.repeat(64);
const makeReport = (fields: string[], rows: Report['rows']): Report => ({
  serverId: base.serverId,
  fetchedAt: '2026-10-05T07:00:00Z',
  columns: Object.fromEntries(fields.map((field) => [field, { name: field, type: 'STRING' }])),
  rows,
});
const documentFields = ['Department', 'Store', 'Day', 'Document', 'WriteoffCost'];
const discountFields = [
  'Department',
  'OrderNum',
  'CloseTime',
  'Cashier',
  'AuthUser',
  'DiscountSum',
  'Flags',
];
const cashierFields = ['Rank', 'Cashier', 'Department', 'DiscountSum', 'CheckCount'];
const receiptRows = [
  {
    Department: branch,
    Cashier: cashier,
    CashierKey: keyA,
    OrderNum: 101,
    'UniqOrderId.Id': '00000000-0000-4000-8000-000000000101',
    'OpenDate.Typed': '2026-10-01',
    CloseTime: '2026-10-01T18:30:00+05:00',
    DiscountSum: 500,
    Flags: '',
    AuthUser: 'Менеджер',
  },
  {
    Department: branch,
    Cashier: cashier,
    CashierKey: keyA,
    OrderNum: 102,
    'UniqOrderId.Id': '00000000-0000-4000-8000-000000000102',
    'OpenDate.Typed': '2026-10-02',
    CloseTime: '2026-10-02T15:30:00+05:00',
    DiscountSum: 100,
    Flags: 'high_discount',
    AuthUser: 'Менеджер',
  },
  {
    Department: branch,
    Cashier: cashier,
    CashierKey: keyB,
    OrderNum: 103,
    'UniqOrderId.Id': '00000000-0000-4000-8000-000000000103',
    'OpenDate.Typed': '2026-10-03',
    CloseTime: '2026-10-03T14:30:00+05:00',
    DiscountSum: 150,
    Flags: 'high_discount',
    AuthUser: cashier,
  },
  {
    Department: similarBranch,
    Cashier: cashier,
    CashierKey: keyC,
    OrderNum: 104,
    'UniqOrderId.Id': '00000000-0000-4000-8000-000000000104',
    'OpenDate.Typed': '2026-10-04',
    CloseTime: '2026-10-04T16:30:00+05:00',
    DiscountSum: 250,
    Flags: '',
    AuthUser: cashier,
  },
];
const makeData = () => ({
  summary: {
    cost: 1600,
    revenue: 40000,
    share: 4,
    change: 0,
    discount: 1000,
    discountChecks: 4,
    returns: 0,
    flagged: 2,
  },
  fetchedAt: '2026-10-05T07:00:00Z',
  period: { from: base.from, to: base.to },
  tables: {
    branches: makeReport(
      ['Rank', 'Department', 'WriteoffCost', 'DocumentCount'],
      [
        { Rank: 2, Department: similarBranch, WriteoffCost: 400, DocumentCount: 1 },
        { Rank: 1, Department: branch, WriteoffCost: 1200, DocumentCount: 3 },
      ],
    ),
    documents: makeReport(documentFields, [
      {
        Department: branch,
        Store: 'Склад А',
        Day: '2026-10-01',
        Document: '0007',
        DocumentKey: keyA,
        WriteoffCost: 100,
      },
      {
        Department: similarBranch,
        Store: 'Склад А',
        Day: '2026-10-01',
        Document: '0007',
        DocumentKey: keyB,
        WriteoffCost: 400,
      },
      {
        Department: branch,
        Store: 'Склад Б',
        Day: '2026-10-01',
        Document: '0007',
        DocumentKey: keyC,
        WriteoffCost: 900,
      },
      {
        Department: branch,
        Store: 'Склад Б',
        Day: '2026-10-02',
        Document: '0007',
        DocumentKey: keyD,
        WriteoffCost: 200,
      },
    ]),
    documentItems: makeReport(
      [
        'Department',
        'Document',
        'Product.Name',
        'Product.MeasureUnit',
        'WriteoffQuantity',
        'WriteoffCost',
        'Reason',
        'Comment',
      ],
      [
        { DocumentKey: keyA, 'Product.Name': 'Чужой склад', WriteoffCost: 100 },
        { DocumentKey: keyB, 'Product.Name': 'Чужой филиал', WriteoffCost: 400 },
        {
          DocumentKey: keyC,
          'Product.Name': 'Круассан',
          'Product.MeasureUnit': 'шт',
          WriteoffQuantity: 2,
          WriteoffCost: 600,
          Reason: 'Брак',
          Comment: 'Подгорело',
        },
        {
          DocumentKey: keyC,
          'Product.Name': 'Булочка',
          'Product.MeasureUnit': 'шт',
          WriteoffQuantity: 3,
          WriteoffCost: 300,
          Reason: 'Брак',
          Comment: '',
        },
        { DocumentKey: keyD, 'Product.Name': 'Другой день', WriteoffCost: 200 },
      ],
    ),
    trend: makeReport(['Day', 'WriteoffCost'], [{ Day: '2026-10-01', WriteoffCost: 1400 }]),
    discountCashiers: makeReport(cashierFields, [
      {
        Rank: 3,
        Cashier: cashier,
        Department: branch,
        CashierKey: keyB,
        DiscountSum: 150,
        CheckCount: 1,
      },
      {
        Rank: 2,
        Cashier: cashier,
        Department: similarBranch,
        CashierKey: keyC,
        DiscountSum: 250,
        CheckCount: 1,
      },
      {
        Rank: 1,
        Cashier: cashier,
        Department: branch,
        CashierKey: keyA,
        DiscountSum: 600,
        CheckCount: 2,
      },
    ]),
    discountCashiersFlagged: makeReport(cashierFields, [
      {
        Rank: 2,
        Cashier: cashier,
        Department: branch,
        CashierKey: keyA,
        DiscountSum: 100,
        CheckCount: 1,
      },
      {
        Rank: 1,
        Cashier: cashier,
        Department: branch,
        CashierKey: keyB,
        DiscountSum: 150,
        CheckCount: 1,
      },
    ]),
    discounts: makeReport(
      discountFields,
      receiptRows.map((row) => ({ ...row })),
    ),
    returns: makeReport(['Department', 'OrderNum', 'ReturnSum'], []),
  },
});
type Result = ReturnType<typeof makeData>;
const page = (mode: ControlMode = 'writeoffs', query = base, department = '', refresh = 0) => (
  <I18nProvider>
    <Controls mode={mode} base={query} department={department} refresh={refresh} />
  </I18nProvider>
);
const bodyRows = (table = screen.getByRole('table')) => within(table).getAllByRole('row').slice(1);
const values = (field: string, table = screen.getByRole('table')) =>
  bodyRows(table).map((row) => row.querySelector(`[data-field="${field}"]`)?.textContent);
const deferred = () => {
  let resolve!: (result: Result) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Result>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('bulka_admin_locale', 'ru');
  vi.mocked(loadControls).mockResolvedValue(makeData());
});
afterEach(() => vi.unstubAllGlobals());

describe('write-off ranking and documents', () => {
  it('starts with the largest write-off branch and drills into its exact documents and lines', async () => {
    render(page());
    await screen.findByRole('table');
    expect(values('Department')).toEqual([branch, similarBranch]);
    expect(values('Rank')).toEqual(['1', '2']);
    expect(screen.getByRole('columnheader', { name: 'Списано, ₸' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    fireEvent.click(within(bodyRows()[0]).getByRole('button', { name: 'Документы' }));
    expect(values('Department')).toEqual([branch, branch, branch]);
    expect(values('WriteoffCost')).toEqual(['900', '200', '100']);
    expect(screen.getByRole('button', { name: 'Все филиалы' })).toBeVisible();
    fireEvent.click(within(bodyRows()[0]).getByRole('button', { name: 'Открыть' }));
    const dialog = screen.getByRole('dialog', { name: 'Документ 0007' });
    expect(within(dialog).getByText(/Bulka 19 · Склад Б/)).toBeVisible();
    expect(values('Product.Name', within(dialog).getByRole('table'))).toEqual([
      'Круассан',
      'Булочка',
    ]);
    expect(loadControls).toHaveBeenCalledOnce();
    expect(within(dialog).getByText('900 ₸')).toBeVisible();
    expect(within(dialog).queryByText(/Чужой|Другой день/)).not.toBeInTheDocument();
    expect(within(dialog).getByText('Подгорело')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Все филиалы' }));
    expect(values('Department')).toEqual([branch, similarBranch]);
  });

  it('clears a branch drill-down when the Documents view is explicitly chosen', async () => {
    render(page());
    await screen.findByRole('table');
    fireEvent.click(within(bodyRows()[0]).getByRole('button', { name: 'Документы' }));
    expect(bodyRows()).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Документы' }));
    expect(bodyRows()).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Все филиалы' })).not.toBeInTheDocument();
    expect(values('WriteoffCost')).toEqual(['900', '400', '200', '100']);
  });

  it.each([branch, ''])(
    'exports only the selected exact branch %j with the current server and dates',
    async (selectedBranch) => {
      const data = makeData();
      data.tables.branches.rows[1].Department = selectedBranch;
      data.tables.documents.rows.forEach((row) => {
        if (row.Department === branch) row.Department = selectedBranch;
      });
      vi.mocked(loadControls).mockResolvedValue(data);
      const blob = new Blob(['xlsx']);
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
      vi.stubGlobal('fetch', fetchMock);
      render(page());
      await screen.findByRole('table');
      fireEvent.click(within(bodyRows()[0]).getByRole('button', { name: 'Документы' }));
      fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }));
      await waitFor(() =>
        expect(download).toHaveBeenCalledWith(blob, 'iiko-documents-2026-09-29-2026-10-05.xlsx'),
      );
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        query: {
          serverId: base.serverId,
          from: base.from,
          to: base.to,
          department: '',
          mode: 'writeoffs',
          discountThreshold: 30,
          returnThreshold: 50000,
        },
        table: 'documents',
        documentDepartment: selectedBranch,
        flaggedOnly: false,
        adviceOnly: false,
      });
    },
  );

  it.each([
    ['server', { ...base, serverId: 'astana-chain' }, ''],
    ['dates', { ...base, from: '2026-10-01', to: '2026-10-04' }, ''],
    ['branch', base, similarBranch],
  ] as const)(
    'closes stale documents and clears the selection after changing %s',
    async (_label, nextQuery, nextDepartment) => {
      const view = render(page());
      await screen.findByRole('table');
      fireEvent.click(within(bodyRows()[0]).getByRole('button', { name: 'Документы' }));
      fireEvent.click(within(bodyRows()[0]).getByRole('button', { name: 'Открыть' }));
      expect(screen.getByRole('dialog')).toBeVisible();
      const oldSignal = vi.mocked(loadControls).mock.calls[0][1];
      const request = deferred();
      vi.mocked(loadControls).mockReturnValueOnce(request.promise);
      view.rerender(page('writeoffs', nextQuery, nextDepartment));
      expect(oldSignal.aborted).toBe(true);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      await act(async () => request.resolve(makeData()));
      expect(screen.queryByRole('button', { name: 'Все филиалы' })).not.toBeInTheDocument();
      expect(bodyRows()).toHaveLength(4);
      expect(vi.mocked(loadControls).mock.lastCall?.[0]).toMatchObject({
        serverId: nextQuery.serverId,
        from: nextQuery.from,
        to: nextQuery.to,
        department: nextDepartment,
      });
    },
  );

  it('ignores a late successful response and a late failure from an aborted context', async () => {
    const old = deferred();
    const other = deferred();
    const latest = makeData();
    latest.tables.branches.rows = [
      { Rank: 1, Department: 'Новая точка', WriteoffCost: 42, DocumentCount: 1 },
    ];
    vi.mocked(loadControls)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(other.promise)
      .mockResolvedValueOnce(latest);
    const view = render(page());
    view.rerender(page('writeoffs', { ...base, serverId: 'astana-chain' }));
    view.rerender(page('writeoffs', { ...base, from: '2026-10-01' }));
    expect(await screen.findByText('Новая точка')).toBeVisible();
    await act(async () => {
      old.resolve(makeData());
      other.reject(new Error('old request offline'));
    });
    expect(values('Department')).toEqual(['Новая точка']);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(vi.mocked(loadControls).mock.calls[0][1].aborted).toBe(true);
    expect(vi.mocked(loadControls).mock.calls[1][1].aborted).toBe(true);
  });
});

describe('cashier discount ranking', () => {
  it('ranks by amount and drills down by stable cashier identity, not a shared name or branch', async () => {
    vi.mocked(loadControls).mockImplementation(async (_query, _signal, endpoint) =>
      endpoint === '/iiko-dashboard/receipt'
        ? makeReport(
            ['DishName'],
            [
              {
                DishName: 'Булочка',
                DishAmountInt: 1,
                DishSumInt: 1000,
                DiscountSum: 500,
                DishDiscountSumInt: 500,
              },
            ],
          )
        : makeData(),
    );
    render(page('operations'));
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Рейтинг кассиров' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(values('DiscountSum')).toEqual(['600', '250', '150']);
    fireEvent.click(within(bodyRows()[0]).getByRole('button', { name: 'Чеки' }));
    expect(values('OrderNum')).toEqual(['101', '102']);
    expect(screen.getByRole('button', { name: 'Все кассиры' })).toBeVisible();
    fireEvent.click(within(bodyRows()[0]).getByRole('button', { name: 'Открыть' }));
    const dialog = screen.getByRole('dialog', { name: 'Чек № 101' });
    expect(await within(dialog).findByText('Булочка')).toBeVisible();
    const receiptCall = vi
      .mocked(loadControls)
      .mock.calls.find((call) => call[2] === '/iiko-dashboard/receipt');
    expect(receiptCall?.[0]).toEqual({
      serverId: base.serverId,
      orderId: receiptRows[0]['UniqOrderId.Id'],
      date: receiptRows[0]['OpenDate.Typed'],
      department: branch,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    fireEvent.click(screen.getByRole('button', { name: 'Все кассиры' }));
    expect(values('DiscountSum')).toEqual(['600', '250', '150']);
    fireEvent.click(within(bodyRows()[2]).getByRole('button', { name: 'Чеки' }));
    expect(values('OrderNum')).toEqual(['103']);
    fireEvent.click(screen.getByRole('button', { name: 'Скидки' }));
    expect(values('OrderNum')).toEqual(['101', '104', '103', '102']);
  });

  it('uses flagged-only aggregate amounts and ranks, then only flagged receipts for the exact cashier', async () => {
    render(page('operations'));
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Только для проверки' }));
    expect(values('DiscountSum')).toEqual(['150', '100']);
    expect(values('Rank')).toEqual(['1', '2']);
    expect(values('CheckCount')).toEqual(['1', '1']);
    fireEvent.click(within(bodyRows()[1]).getByRole('button', { name: 'Чеки' }));
    expect(values('OrderNum')).toEqual(['102']);
    expect(screen.getByText('Высокая скидка')).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Только для проверки' }));
    expect(values('OrderNum')).toEqual(['101', '102']);
    fireEvent.click(screen.getByRole('button', { name: 'Все кассиры' }));
    expect(values('DiscountSum')).toEqual(['600', '250', '150']);
  });

  it('exports the flagged ranking or a selected cashier with the exact opaque key', async () => {
    const blob = new Blob(['xlsx']);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal('fetch', fetchMock);
    render(page('operations'));
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Только для проверки' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      table: 'discountCashiersFlagged',
      flaggedOnly: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('cashierKey');
    fireEvent.click(within(bodyRows()[0]).getByRole('button', { name: 'Чеки' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      query: {
        serverId: base.serverId,
        from: base.from,
        to: base.to,
        department: '',
        mode: 'operations',
        discountThreshold: 30,
        returnThreshold: 50000,
      },
      table: 'discounts',
      cashierKey: keyB,
      flaggedOnly: true,
      adviceOnly: false,
    });
  });

  it('closes an open receipt when its filters change and clears cashier selection after query changes', async () => {
    const view = render(page('operations'));
    await screen.findByRole('table');
    fireEvent.click(within(bodyRows()[0]).getByRole('button', { name: 'Чеки' }));
    const pendingReceipt = new Promise<Report>(() => {});
    vi.mocked(loadControls).mockReturnValueOnce(pendingReceipt);
    fireEvent.click(within(bodyRows()[0]).getByRole('button', { name: 'Открыть' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    const receiptSignal = vi.mocked(loadControls).mock.lastCall?.[1];
    fireEvent.click(screen.getByRole('checkbox', { name: 'Только для проверки' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(receiptSignal?.aborted).toBe(true);
    expect(values('OrderNum')).toEqual(['102']);
    view.rerender(page('operations', { ...base, from: '2026-10-01' }));
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Все кассиры' })).not.toBeInTheDocument();
    expect(values('OrderNum')).toEqual(['103', '102']);
  });
});
