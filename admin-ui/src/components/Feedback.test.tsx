import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { FeedbackProvider, useFeedback } from './Feedback';

function FeedbackHarness() {
  const { confirm, toast } = useFeedback();
  return (
    <>
      <button type="button" onClick={() => toast('Сохранено')}>
        Показать
      </button>
      <button
        type="button"
        onClick={() =>
          void confirm({
            title: 'Удалить блок?',
            body: 'Блок будет удалён из черновика.',
            destructive: true,
          })
        }
      >
        Удалить
      </button>
    </>
  );
}

describe('Feedback transitions', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces a toast and lets its exit animation finish', () => {
    vi.useFakeTimers();
    render(
      <I18nProvider>
        <FeedbackProvider>
          <FeedbackHarness />
        </FeedbackProvider>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Сохранено');
    const closeToast = within(toast).getByRole('button', { name: 'Закрыть' });
    expect(closeToast).toHaveAttribute('title', 'Закрыть');
    fireEvent.click(closeToast);
    expect(toast).toHaveClass('is-exiting');

    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('pauses auto-dismiss while the operator is reading or interacting with a toast', () => {
    vi.useFakeTimers();
    render(
      <I18nProvider>
        <FeedbackProvider>
          <FeedbackHarness />
        </FeedbackProvider>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    const toast = screen.getByRole('status');
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(6000));
    expect(toast).not.toHaveClass('is-exiting');

    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(4500));
    expect(toast).toHaveClass('is-exiting');
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('associates the confirmation description and renders both actions', () => {
    render(
      <I18nProvider>
        <FeedbackProvider>
          <FeedbackHarness />
        </FeedbackProvider>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Удалить блок?' });
    expect(dialog).toHaveAccessibleDescription('Блок будет удалён из черновика.');
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Подтвердить' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Закрыть' })).toHaveAttribute(
      'title',
      'Закрыть',
    );
  });
});
