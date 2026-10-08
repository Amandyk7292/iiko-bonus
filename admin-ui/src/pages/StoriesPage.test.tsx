import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import StoriesPage from './StoriesPage';

const api = vi.hoisted(() => ({ getStories: vi.fn(), uploadPhoto: vi.fn(), updateStory: vi.fn() }));
const feedback = vi.hoisted(() => ({ toast: vi.fn(), confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../components/Feedback', () => ({ useFeedback: () => feedback }));
const images: Array<{
  naturalWidth: number;
  naturalHeight: number;
  onload?: () => void;
  onerror?: () => void;
}> = [];
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.resetAllMocks();
  images.length = 0;
  localStorage.setItem('adminLocale', 'ru');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:decoding'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 1080;
      naturalHeight = 1920;
      src = '';
      constructor() {
        images.push(this);
      }
    },
  );
  api.getStories.mockResolvedValue({
    stories: [
      { id: 'A', title: 'История A', contentUrl: 'https://example.test/A.jpg' },
      { id: 'B', title: 'История B', contentUrl: 'https://example.test/B.jpg' },
    ],
  });
  api.uploadPhoto.mockResolvedValue({ url: 'https://example.test/NEW-A.jpg' });
  api.updateStory.mockResolvedValue({ success: true });
});

async function openAndUpload() {
  const user = userEvent.setup();
  const view = render(
    <I18nProvider>
      <StoriesPage />
    </I18nProvider>,
  );
  await screen.findByText('История A');
  await user.click(screen.getAllByRole('button', { name: 'Редактировать' })[0]);
  fireEvent.change(document.querySelector('#story-content-ru')!, {
    target: { files: [new File(['image'], 'A.jpg', { type: 'image/jpeg' })] },
  });
  return { user, view };
}

it('locks dismissal, save and other language uploads throughout dimension validation and upload', async () => {
  const { user } = await openAndUpload();
  expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'Казахский' }));
  expect(document.querySelector('#story-content-kz')).toBeDisabled();
  fireEvent.change(document.querySelector('#story-content-kz')!, {
    target: { files: [new File(['image'], 'KZ.jpg', { type: 'image/jpeg' })] },
  });
  expect(images).toHaveLength(1);
  await act(async () => images[0].onload?.());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Отмена' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Отмена' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await user.click(screen.getAllByRole('button', { name: 'Редактировать' })[1]);
  expect(document.querySelector('.story-upload img')).toHaveAttribute(
    'src',
    'https://example.test/B.jpg',
  );
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() =>
    expect(api.updateStory).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'B', contentUrl: 'https://example.test/B.jpg' }),
    ),
  );
});

it('releases the busy state after invalid dimensions without uploading', async () => {
  await openAndUpload();
  images[0].naturalWidth = 100;
  await act(async () => images[0].onload?.());
  expect(api.uploadPhoto).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Отмена' })).toBeEnabled();
});

it('invalidates a pending dimension check when the editor unmounts', async () => {
  const { view } = await openAndUpload();
  view.unmount();
  await act(async () => images[0].onload?.());
  expect(api.uploadPhoto).not.toHaveBeenCalled();
  expect(feedback.toast).not.toHaveBeenCalled();
});
