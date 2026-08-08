import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ALLOWED_PATHS } from '../lib/admin-permissions';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import Sidebar from './Sidebar';

vi.mock('../lib/admin-realtime', () => ({
  useAdminRealtime: () => ({
    summary: {
      counts: {
        newOrders: 120,
        supportNew: 3,
        whatsappUnread: 7,
        kitchenOverdue: 2,
      },
    },
  }),
}));

const renderSidebar = (
  role: string,
  callbacks: {
    onClose?: () => void;
    onCollapse?: () => void;
  } = {},
) =>
  render(
    <BrowserRouter basename="/admin">
      <I18nProvider>
        <Sidebar role={role} isOpen onClose={callbacks.onClose} onCollapse={callbacks.onCollapse} />
      </I18nProvider>
    </BrowserRouter>,
  );

const visiblePaths = () =>
  screen
    .getAllByRole('link', { hidden: true })
    .map((link) => new URL((link as HTMLAnchorElement).href).pathname.replace(/^\/admin/, ''));

describe('Sidebar role navigation', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    window.history.replaceState({}, '', '/admin/operations');
  });

  for (const role of [
    'branch_manager',
    'operator',
    'marketer',
    'courier',
    'editor',
    'viewer',
    'cashier',
    'whatsapp_operator',
  ]) {
    it(`shows exactly the allowed destinations for ${role}`, () => {
      renderSidebar(role);
      expect(new Set(visiblePaths())).toEqual(new Set(ADMIN_ALLOWED_PATHS[role]));
    });
  }

  it('keeps privileged owner navigation complete', () => {
    renderSidebar('owner');
    const paths = visiblePaths();
    for (const privilegedPath of ['/access', '/security', '/settings', '/integrations']) {
      expect(paths).toContain(privilegedPath);
    }
    expect(paths.length).toBeGreaterThan(20);
  });

  it('caps live badges and invokes mobile and desktop controls immediately', () => {
    const onClose = vi.fn();
    const onCollapse = vi.fn();
    renderSidebar('operator', { onClose, onCollapse });

    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    const collapseButton = screen.getByRole('button', { name: 'Скрыть боковое меню' });
    expect(collapseButton).toHaveAttribute('title', 'Скрыть боковое меню');
    fireEvent.click(collapseButton);
    for (const closeButton of screen.getAllByRole('button', { name: 'Закрыть меню' })) {
      if (closeButton.classList.contains('sidebar-close')) {
        expect(closeButton).toHaveAttribute('title', 'Закрыть меню');
      }
      fireEvent.click(closeButton);
    }

    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
