import { afterEach, expect, it } from 'vitest';
import { dashboardUrlState, preferredServer } from './IikoDashboardPage';
import type { Server } from './iiko-dashboard/model';

afterEach(() => window.history.replaceState(null, '', '/'));

it('restores the shared dashboard scope from the URL', () => {
  window.history.replaceState(
    null,
    '',
    '/admin/iiko-dashboard?tab=invoices&server=rms-1&from=2026-09-01&to=2026-09-13&department=Bakery&supplier=Supplier&comparison=none',
  );
  expect(dashboardUrlState()).toMatchObject({
    tab: 'invoices',
    serverId: 'rms-1',
    from: '2026-09-01',
    to: '2026-09-13',
    department: 'Bakery',
    supplier: 'Supplier',
    comparison: 'none',
  });
});

it('falls back to an active RMS server when a city chain is absent', () => {
  const servers: Server[] = [
    {
      id: 'aktau-rms',
      city: 'aktau',
      kind: 'rms',
      host: 'aktau.iiko.it',
      configured: true,
      active: true,
    },
    {
      id: 'astana-chain',
      city: 'astana',
      kind: 'chain',
      host: 'astana.iiko.it',
      configured: true,
      active: true,
    },
  ];
  expect(preferredServer(servers, 'aktau')).toBe('aktau-rms');
});
