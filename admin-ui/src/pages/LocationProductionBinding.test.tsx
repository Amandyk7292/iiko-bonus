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
  const save = dialog.getByRole('button', { name: 'Сохранить настройки' });
  expect(save).toBeEnabled();
  await user.click(save);
  expect(dialog.getByLabelText('Склад ингредиентов')).toHaveFocus();
  expect(dialog.getByLabelText('Склад ингредиентов')).toHaveAttribute('aria-invalid', 'true');
  expect(request.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
});
it('saves explicit mapping, branch URL and draft mode without arbitrary credentials', async () => {
  const user = userEvent.setup();
  start();
  await user.click(screen.getByRole('button', { name: 'Акты приготовления' }));
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() =>
    expect(dialog.getByRole('button', { name: 'Сохранить настройки' })).toBeEnabled(),
  );
  await user.click(dialog.getByRole('button', { name: 'Сохранить настройки' }));
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
  expect(dialog.getByRole('button', { name: 'Сохранить настройки' })).toBeDisabled();
  resolve({ binding: null, directory: { ...directory, departments: [], stores: [] } });
  await waitFor(() => expect(dialog.queryByRole('status')).toBeNull());
  expect(dialog.queryByRole('option', { name: 'Наш склад' })).toBeNull();
  expect(dialog.getByRole('button', { name: 'Сохранить настройки' })).toBeEnabled();
  await user.click(dialog.getByRole('button', { name: 'Сохранить настройки' }));
  expect(dialog.getByLabelText('Точка iiko')).toHaveFocus();
  expect(request.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
});

it('empty settings explain the missing server on Save and focus it without sending', async () => {
  request.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/production-acts') ? { acts: [] } : { binding: null, directory },
    ),
  );
  const user = userEvent.setup();
  start();
  await user.click(screen.getByRole('button', { name: 'Акты приготовления' }));
  const dialog = within(await screen.findByRole('dialog'));
  const save = dialog.getByRole('button', { name: 'Сохранить настройки' });
  await waitFor(() => expect(save).toBeEnabled());
  expect(dialog.getByLabelText('Точка iiko')).toBeDisabled();
  expect(dialog.getByLabelText('Склад ингредиентов')).toBeDisabled();
  await user.click(save);
  const server = dialog.getByLabelText('Сервер iiko');
  expect(server).toHaveFocus();
  expect(server).toHaveAttribute('aria-invalid', 'true');
  expect(
    dialog.getAllByRole('alert').some((alert) => /сервер iiko/i.test(alert.textContent || '')),
  ).toBe(true);
  expect(request.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
});

it('guides each missing selection in order and saves only after all four explicit choices', async () => {
  request.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/production-acts') ? { acts: [] } : { binding: null, directory },
    ),
  );
  const user = userEvent.setup();
  start();
  await user.click(screen.getByRole('button', { name: 'Акты приготовления' }));
  const dialog = within(await screen.findByRole('dialog'));
  const save = dialog.getByRole('button', { name: 'Сохранить настройки' });
  const server = dialog.getByLabelText('Сервер iiko');
  const point = dialog.getByLabelText('Точка iiko');
  const source = dialog.getByLabelText('Склад ингредиентов');
  const target = dialog.getByLabelText('Склад готовых блюд');
  await waitFor(() => expect(server).toBeEnabled());
  await user.selectOptions(server, 'server-a');
  await waitFor(() => expect(point).toBeEnabled());
  expect(point).toHaveValue('');
  await user.click(save);
  expect(point).toHaveFocus();
  expect(point).toHaveAttribute('aria-invalid', 'true');
  await user.selectOptions(point, 'branch-a');
  expect(point).not.toHaveAttribute('aria-invalid', 'true');
  expect(source).toBeEnabled();
  expect(source).toHaveValue('');
  expect(target).toHaveValue('');
  await user.click(save);
  expect(source).toHaveFocus();
  await user.selectOptions(source, 'store-a');
  await user.click(save);
  expect(target).toHaveFocus();
  expect(target).toHaveAttribute('aria-invalid', 'true');
  expect(request.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
  await user.selectOptions(target, 'store-a');
  await user.click(dialog.getByRole('checkbox', { name: 'Отправка из отчётов' }));
  await user.click(save);
  expect(request.mock.calls.filter(([, options]) => options?.method === 'PUT')).toEqual([
    ['/locations/point/production-binding', { method: 'PUT', body: JSON.stringify(binding) }],
  ]);
});

it('stale configured store is highlighted instead of saving an invalid mapping', async () => {
  request.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/production-acts')
        ? { acts: [] }
        : {
            binding: { ...binding, targetStoreId: 'store-b' },
            directory,
          },
    ),
  );
  const user = userEvent.setup();
  start();
  await user.click(screen.getByRole('button', { name: 'Акты приготовления' }));
  const dialog = within(await screen.findByRole('dialog'));
  const save = dialog.getByRole('button', { name: 'Сохранить настройки' });
  await waitFor(() => expect(save).toBeEnabled());
  await user.click(save);
  expect(dialog.getByLabelText('Склад готовых блюд')).toHaveFocus();
  expect(dialog.getByLabelText('Склад готовых блюд')).toHaveAttribute('aria-invalid', 'true');
  expect(request.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
});

it('failed save keeps the selected mapping for a retry', async () => {
  let writes = 0;
  request.mockImplementation((path: string, options?: { method?: string }) => {
    if (options?.method === 'PUT' && ++writes === 1)
      return Promise.reject(new Error('Не удалось сохранить. Попробуйте ещё раз.'));
    return Promise.resolve(
      path.endsWith('/production-acts') ? { acts: [] } : { binding, directory },
    );
  });
  const user = userEvent.setup();
  start();
  await user.click(screen.getByRole('button', { name: 'Акты приготовления' }));
  const dialog = within(await screen.findByRole('dialog'));
  const save = dialog.getByRole('button', { name: 'Сохранить настройки' });
  await waitFor(() => expect(save).toBeEnabled());
  await user.click(save);
  expect(await dialog.findByRole('alert')).toHaveTextContent('Не удалось сохранить');
  expect(dialog.getByLabelText('Склад готовых блюд')).toHaveValue('store-a');
  await waitFor(() => expect(save).toBeEnabled());
  await user.click(save);
  expect(writes).toBe(2);
});
