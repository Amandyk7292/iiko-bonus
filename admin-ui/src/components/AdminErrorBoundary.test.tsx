import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminErrorBoundary, { adminSupportCode } from './AdminErrorBoundary';

describe('AdminErrorBoundary', () => {
  it('reuses a safe API request id as the support code', () => {
    expect(adminSupportCode({ requestId: 'req-safe-123' })).toBe('req-safe-123');
  });

  it('reports a benign unhandled rejection without replacing or unmounting the interface', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AdminErrorBoundary>
        <div>Рабочий экран</div>
      </AdminErrorBoundary>,
    );
    const reason = new TypeError('Failed to fetch chrome-extension://invalid');
    const event = new Event('unhandledrejection', { cancelable: true }) as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: reason });
    fireEvent(window, event);

    expect(screen.getByText('Рабочий экран')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(event.defaultPrevented).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'admin_ui_unhandled_rejection',
        errorName: 'TypeError',
      }),
    );
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('chrome-extension://invalid');
    consoleSpy.mockRestore();
  });

  it('keeps React render errors fatal and shows the recovery screen', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const BrokenView = () => {
      throw Object.assign(new Error('render failed'), { requestId: 'req-render' });
    };

    render(
      <AdminErrorBoundary>
        <BrokenView />
      </AdminErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('req-render');
    expect(screen.queryByText('Рабочий экран')).not.toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
