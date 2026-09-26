import { fireEvent, render, screen, waitFor, within, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import IikoDashboardPage from './IikoDashboardPage';
vi.mock('./iiko-dashboard/api', () => ({
  dashboardApi: {
    servers: async () => ({
      servers: [
        {
          id: 'aktau-chain',
          city: 'aktau',
          kind: 'chain',
          configured: false,
          active: true,
          host: 'test.iiko.it',
        },
      ],
    }),
  },
  exportReport: vi.fn(),
}));
vi.mock('./iiko-dashboard/Invoices', () => ({ default: () => <div data-testid="invoices" /> }));
vi.mock('./iiko-dashboard/Settings', () => ({
  default: () => <div data-testid="settings" />,
  parsePreferences: () => ({ auto: false, cards: [], templates: [] }),
}));
it('Back and Forward restore the rendered dashboard tab without adding history entries', async () => {
  window.history.replaceState(
    { router: 'preserved' },
    '',
    '/admin/iiko-dashboard?tab=settings&server=aktau-chain&from=2026-09-01&to=2026-09-13&comparison=none',
  );
  const view = render(
    <I18nProvider>
      <IikoDashboardPage />
    </I18nProvider>,
  );
  await screen.findByTestId('settings');
  const before = window.history.length;
  const nav = screen.getByRole('navigation');
  fireEvent.click(within(nav).getByRole('button', { name: /^(Накладные|Жүкқұжаттар|Invoices)$/ }));
  await screen.findByTestId('invoices');
  expect(window.history.length).toBe(before + 1);
  await act(async () => {
    window.history.back();
  });
  await waitFor(() => expect(screen.getByTestId('settings')).toBeVisible());
  await act(async () => {
    window.history.forward();
  });
  await waitFor(() => expect(screen.getByTestId('invoices')).toBeVisible());
  expect(window.history.length).toBe(before + 1);
  expect(window.history.state).toEqual({ router: 'preserved' });
  view.unmount();
  window.history.replaceState(null, '', '/');
});
