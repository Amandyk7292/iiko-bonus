import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { FeedbackProvider } from '../components/Feedback';
import SettingsPage from './SettingsPage';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shows a retryable error when settings headers arrive but the response body stalls', async () => {
  vi.useFakeTimers();
  localStorage.setItem('adminLocale', 'ru');
  const fetch = vi
    .fn()
    .mockImplementationOnce((_url: string, options: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          options.signal!.addEventListener('abort', () =>
            controller.error(new DOMException('Response aborted', 'AbortError')),
          );
        },
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    })
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ app_release_policy: { android: { latest_version: '1.2.0' } } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
  vi.stubGlobal('fetch', fetch);
  render(
    <I18nProvider>
      <FeedbackProvider>
        <SettingsPage />
      </FeedbackProvider>
    </I18nProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Сервер не ответил вовремя. Повторите попытку.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await act(async () => {});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getAllByLabelText('Последняя версия')[0]).toHaveValue('1.2.0');
  expect(fetch).toHaveBeenCalledTimes(2);
});
