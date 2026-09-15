import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MenuPhotoUploadsProvider, useMenuPhotoUploads } from './MenuPhotoUploads';

const mocks = vi.hoisted(() => ({ uploadMenuPhoto: vi.fn() }));
vi.mock('../lib/menu-photo-api', () => mocks);
const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
const target = {
  targetType: 'product' as const,
  targetId: 'cake',
  branchId: 'branch-a',
  profileKey: 'default',
};
function Editor() {
  const { enqueue, jobs } = useMenuPhotoUploads();
  return (
    <>
      <button onClick={() => enqueue(target, file, 'Рулет')}>Загрузить</button>
      <output data-testid="pending">
        {jobs.filter((job) => job.status === 'uploading').length}
      </output>
    </>
  );
}
function Workspace() {
  const [editor, show] = useState(true);
  return (
    <MenuPhotoUploadsProvider>
      <button onClick={() => show((value) => !value)}>Другой раздел</button>
      {editor ? <Editor /> : <p>Настройки</p>}
    </MenuPhotoUploadsProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:photo'), revokeObjectURL: vi.fn() }),
  );
});

it('continues and reports completion after leaving the originating page', async () => {
  let finish!: (result: unknown) => void;
  mocks.uploadMenuPhoto.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<Workspace />);
  fireEvent.click(screen.getByText('Загрузить'));
  fireEvent.click(screen.getByText('Загрузить'));
  expect(mocks.uploadMenuPhoto).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Другой раздел'));
  expect(screen.getByText('Настройки')).toBeInTheDocument();
  expect(screen.getByText('Загрузка и сохранение…')).toBeInTheDocument();
  await act(async () => finish({ success: true, imageUrl: 'https://example.com/new.jpg' }));
  expect(screen.getByText('Фото сохранено')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Другой раздел'));
  expect(screen.getByTestId('pending')).toHaveTextContent('0');
  expect(mocks.uploadMenuPhoto.mock.calls[0][1]).toMatchObject(target);
});

it('keeps a failed upload retryable across pages with its original target', async () => {
  mocks.uploadMenuPhoto
    .mockResolvedValueOnce({ success: false })
    .mockResolvedValueOnce({ success: true, imageUrl: 'https://example.com/new.jpg' });
  render(<Workspace />);
  fireEvent.click(screen.getByText('Загрузить'));
  fireEvent.click(screen.getByText('Другой раздел'));
  await screen.findByText('Повторить');
  expect(screen.queryByText('Фото сохранено')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Повторить'));
  await waitFor(() => expect(screen.getByText('Фото сохранено')).toBeInTheDocument());
  expect(mocks.uploadMenuPhoto.mock.calls[1][1]).toMatchObject(target);
  expect(mocks.uploadMenuPhoto.mock.calls[1][0]).toBe(file);
});
