import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import Modal from './Modal';

describe('Modal motion and accessibility', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the dialog mounted for its exit animation', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const view = (open: boolean) => (
      <I18nProvider>
        <Modal open={open} title="Проверка" onClose={onClose}>
          <div className="modal-body">Содержимое</div>
        </Modal>
      </I18nProvider>
    );
    const { rerender } = render(view(true));

    expect(screen.getByRole('dialog', { name: 'Проверка' })).toBeInTheDocument();
    rerender(view(false));
    expect(screen.getByRole('dialog', { name: 'Проверка' })).toBeInTheDocument();
    expect(document.querySelector('.modal-backdrop')).toHaveClass('is-exiting');

    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('dialog', { name: 'Проверка' })).not.toBeInTheDocument();
  });
});
