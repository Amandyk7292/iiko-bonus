import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { BrowserRouter } from '../lib/router';
import { I18nProvider } from '../lib/i18n';
import LocationProductionBinding from './LocationProductionBinding';

const request = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ request }));
vi.mock('../components/Feedback', () => ({ useFeedback: () => ({ toast: vi.fn() }) }));
const directory = {
  servers: [
    { id: 'server-a', name: 'Актау' },
    { id: 'server-b', name: 'Астана' },
  ],
  departments: [
    { id: 'branch-a', name: 'Наша точка' },
    { id: 'branch-b', name: 'Другая точка' },
  ],
  stores: [
    { id: 'store-a', name: 'Наш склад', parentId: 'branch-a' },
    { id: 'store-b', name: 'Чужой склад', parentId: 'branch-b' },
  ],
};
const binding = {
  serverId: 'server-a',
  departmentId: 'branch-a',
  sourceStoreId: 'store-a',
  targetStoreId: 'store-a',
  enabled: true,
  postImmediately: false,
};
const start = () =>
  render(
    <BrowserRouter>
      <I18nProvider>
        <LocationProductionBinding locationId="point" name="Жасыл дала" />
      </I18nProvider>
    </BrowserRouter>,
  );
beforeEach(() => {
  localStorage.setItem('adminLocale', 'ru');
  request
    .mockReset()
    .mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/production-acts') ? { acts: [] } : { binding, directory }),
    );
});
it('loads settings only when opened and offers only stores of the selected department', async () => {
  const user = userEvent.setup();
  start();
  expect(request).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Акты приготовления' }));
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(dialog.getByLabelText('Склад ингредиентов')).toHaveValue('store-a'));
  expect(dialog.getAllByRole('option', { name: 'Наш склад' })).toHaveLength(2);
  expect(dialog.queryByRole('option', { name: 'Чужой склад' })).toBeNull();
  await user.selectOptions(dialog.getByLabelText('Точка iiko'), 'branch-b');
  expect(dialog.getByLabelText('Склад ингредиентов')).toHaveValue('');
  expect(dialog.getByLabelText('Склад готовых блюд')).toHaveValue('');
  expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
});
it('saves explicit mapping, branch URL and draft mode without arbitrary credentials', async () => {
  const user = userEvent.setup();
  start();
  await user.click(screen.getByRole('button', { name: 'Акты приготовления' }));
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeEnabled());
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  expect(request).toHaveBeenLastCalledWith('/locations/point/production-binding', {
    method: 'PUT',
    body: JSON.stringify(binding),
  });
});
it('changing server discards all old stores and blocks save until the new directory arrives', async () => {
  const user = userEvent.setup();
  start();
  await user.click(screen.getByRole('button', { name: 'Акты приготовления' }));
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(dialog.getByLabelText('Сервер iiko')).toHaveValue('server-a'));
  let resolve!: (value: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await user.selectOptions(dialog.getByLabelText('Сервер iiko'), 'server-b');
  expect(dialog.getByLabelText('Склад ингредиентов')).toHaveValue('');
  expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  resolve({ binding: null, directory: { ...directory, departments: [], stores: [] } });
  await waitFor(() => expect(dialog.queryByRole('status')).toBeNull());
  expect(dialog.queryByRole('option', { name: 'Наш склад' })).toBeNull();
});
