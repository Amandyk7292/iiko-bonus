import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import BroadcastPage from './BroadcastPage';
const mocks = vi.hoisted(() => ({ send: vi.fn(), toast: vi.fn(), confirm: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { sendPushMass: mocks.send } }));
vi.mock('../components/Feedback', () => ({
  useFeedback: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('adminLocale', 'ru');
  mocks.confirm.mockResolvedValue(true);
});
async function sendForm() {
  const user = userEvent.setup();
  render(
    <I18nProvider>
      <BroadcastPage />
    </I18nProvider>,
  );
  for (const language of ['Русский', 'Казахский', 'Английский']) {
    await user.click(screen.getByRole('tab', { name: language }));
    await user.type(screen.getByLabelText(new RegExp(`Заголовок \\(${language}\\)`)), 'Заголовок');
    await user.type(
      screen.getByLabelText(new RegExp(`Текст сообщения \\(${language}\\)`)),
      'Текст',
    );
  }
  await user.click(screen.getByRole('button', { name: 'Отправить всем' }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
}
it('keeps the draft and shows an error for zero available devices', async () => {
  mocks.send.mockResolvedValue({
    success: false,
    count: 0,
    status: 'no_recipients',
    savedCount: 25,
  });
  await sendForm();
  expect(await screen.findByRole('alert')).toHaveTextContent('Push не отправлен');
  expect(screen.getByDisplayValue('Заголовок')).toBeInTheDocument();
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.stringContaining('нет доступных устройств'),
    'error',
  );
});
it('reports the retry queue without claiming zero deliveries were sent', async () => {
  mocks.send.mockResolvedValue({ success: true, count: 0, queuedCount: 2, status: 'queued' });
  await sendForm();
  await waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.stringContaining('повторной попытки: 2'),
      'info',
    ),
  );
});
