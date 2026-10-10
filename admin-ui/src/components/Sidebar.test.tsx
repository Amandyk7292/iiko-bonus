import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ALLOWED_PATHS } from '../lib/admin-permissions';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import Sidebar from './Sidebar';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';

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
    .queryAllByRole('link', { hidden: true })
    .map((link) => new URL((link as HTMLAnchorElement).href).pathname.replace(/^\/admin/, ''));

describe('Sidebar role navigation', () => {
  it('moves focus into the mobile drawer, contains Tab, closes with Escape and restores focus', async () => {
    function Mobile() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Sidebar role="owner" isOpen={open} onClose={() => setOpen(false)} />
          <main id="main-content">
            <button onClick={() => setOpen(true)}>Открыть меню</button>
            <input aria-label="Фоновое поле" />
          </main>
        </>
      );
    }
    const user = userEvent.setup();
    render(
      <BrowserRouter>
        <I18nProvider>
          <Mobile />
        </I18nProvider>
      </BrowserRouter>,
    );
    const trigger = screen.getByRole('button', { name: 'Открыть меню' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const drawer = screen.getByRole('dialog');
    const close = drawer.querySelector<HTMLElement>('.sidebar-close')!;
    expect(close).toHaveFocus();
    expect(document.getElementById('main-content')).toHaveAttribute('inert');
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(drawer).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Tab}');
    expect(close).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.getElementById('main-content')).not.toHaveAttribute('inert');
    expect(trigger).toHaveFocus();
    expect(document.body).not.toHaveClass('modal-open');
  });
  it('dashboard account sees only Dashboard', () => {
    renderSidebar('iiko_dashboard');
    expect(visiblePaths()).toEqual(['/iiko-dashboard']);
    expect(screen.getByRole('link', { name: /^Dashboard$/ })).toBeInTheDocument();
  });
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    window.history.replaceState({}, '', '/admin/operations');
  });

  for (const role of [
    'employee',
    'branch_manager',
    'operator',
    'marketer',
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

  it('does not advertise a retired courier workspace', () => {
    renderSidebar('courier');
    expect(visiblePaths()).toEqual([]);
  });

  it('keeps privileged owner navigation complete', () => {
    renderSidebar('owner');
    const paths = visiblePaths();
    for (const privilegedPath of ['/access', '/security', '/settings', '/integrations']) {
      expect(paths).toContain(privilegedPath);
    }
    expect(paths.length).toBeGreaterThan(20);
    expect(paths).not.toContain('/couriers');
    expect(paths).not.toContain('/dispatch');
    expect(paths).not.toContain('/reviews');
  });

  it('marks only academy management active on its separate route', () => {
    window.history.replaceState({}, '', '/admin/learning/manage');
    renderSidebar('owner');
    expect(screen.getByRole('link', { name: 'Управление обучением' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Моё обучение' })).not.toHaveAttribute('aria-current');
  });

  it.each(['owner', 'admin', 'editor', 'marketer'])(
    'places FAQ beside loyalty tiers for %s',
    (role) => {
      renderSidebar(role);
      const paths = visiblePaths();
      expect(paths[paths.indexOf('/tiers') + 1]).toBe('/faq');
    },
  );

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
