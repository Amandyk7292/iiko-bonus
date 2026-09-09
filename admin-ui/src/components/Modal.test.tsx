import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import Modal from './Modal';
import SelectControl from './SelectControl';
import userEvent from '@testing-library/user-event';

describe('Modal motion and accessibility', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes an open dropdown with Escape before closing the dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <Modal open title="Проверка" onClose={onClose}>
          <SelectControl
            ariaLabel="Город"
            value="aktau"
            onChange={() => {}}
            options={[{ value: 'aktau', label: 'Актау' }]}
          />
        </Modal>
      </I18nProvider>,
    );
    await user.click(screen.getByRole('combobox', { name: 'Город' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
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
    expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveAttribute('title', 'Закрыть');
    rerender(view(false));
    expect(screen.getByRole('dialog', { name: 'Проверка' })).toBeInTheDocument();
    expect(document.querySelector('.modal-backdrop')).toHaveClass('is-exiting');

    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('dialog', { name: 'Проверка' })).not.toBeInTheDocument();
  });
});
