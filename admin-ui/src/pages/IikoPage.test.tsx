import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import IikoPage from './IikoPage';

const apiMocks = vi.hoisted(() => ({ getIikoOperations: vi.fn() }));
vi.mock('../lib/api', () => ({ api: apiMocks }));

beforeEach(() => {
  localStorage.clear();
  apiMocks.getIikoOperations.mockReset();
});

it('marks a failed refresh as an error while preserving the journal and supports retry', async () => {
  const operations = [
    { id: 'operation-1', order_id: '12345', created_at: '2026-09-07T09:00:00Z', order_total: 35 },
  ];
  apiMocks.getIikoOperations
    .mockResolvedValueOnce(operations)
    .mockRejectedValueOnce(new Error('Сервер временно недоступен'))
    .mockResolvedValueOnce(operations);
  render(
    <I18nProvider>
      <IikoPage />
    </I18nProvider>,
  );
  await screen.findByText('12345');
  expect(screen.getByRole('status')).toHaveClass('value-positive');

  await userEvent.click(screen.getByRole('button', { name: 'Обновить' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Сервер временно недоступен');
  expect(screen.getByRole('status')).toHaveTextContent('Не удалось загрузить данные');
  expect(screen.getByRole('status')).toHaveClass('value-negative');
  expect(screen.getByText('12345')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Обновить' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByRole('status')).toHaveClass('value-positive');
  expect(apiMocks.getIikoOperations).toHaveBeenCalledTimes(3);
});
