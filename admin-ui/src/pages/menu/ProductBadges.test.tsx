import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { it, expect, vi, beforeEach } from 'vitest';
import ProductBadges from './ProductBadges';
const request = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({ request }));
beforeEach(() => request.mockReset());
it('reuses an existing badge instead of creating a new one for each product', async () => {
  request.mockResolvedValue({
    badges: [{ id: 'shared', label: 'Хит', background: '#782b0e', foreground: '#ffffff' }],
    selected: [],
  });
  render(<ProductBadges productId="product-two" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Хит' }));
  await user.click(screen.getByRole('button', { name: 'Сохранить метки товара' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/menu/badges/assignment',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ productId: 'product-two', badgeIds: ['shared'] }),
      }),
    ),
  );
  expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
});

it('creates a shared badge with Russian and Kazakh names', async () => {
  request.mockImplementation(async (_path, options) =>
    options?.method === 'POST'
      ? { badge: { id: 'new', ...JSON.parse(options.body) } }
      : { badges: [], selected: [] },
  );
  const onSaved = vi.fn();
  render(<ProductBadges productId="one" onSaved={onSaved} />);
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText('Название на русском')).toBeEnabled());
  await user.type(screen.getByLabelText('Название на русском'), 'Острое');
  await user.type(screen.getByLabelText('Название на казахском'), 'Ащы');
  await user.click(screen.getByRole('button', { name: 'Создать общую метку' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  const post = request.mock.calls.find((call) => call[1]?.method === 'POST');
  expect(JSON.parse(post![1].body)).toMatchObject({ label: 'Острое', labelKk: 'Ащы' });
  expect(await screen.findByRole('button', { name: 'Острое' })).toBeVisible();
});

it('loads both names when editing and allows clearing the Kazakh translation', async () => {
  request.mockImplementation(async (_path, options) =>
    options?.method === 'POST'
      ? { badge: JSON.parse(options.body) }
      : {
          badges: [
            {
              id: 'shared',
              label: 'Острое',
              labelKk: 'Ащы',
              background: '#dd4422',
              foreground: '#ffffff',
            },
          ],
          selected: [],
        },
  );
  render(<ProductBadges productId="one" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Изменить метку Острое' }));
  expect(screen.getByLabelText('Название на русском')).toHaveValue('Острое');
  expect(screen.getByLabelText('Название на казахском')).toHaveValue('Ащы');
  await user.clear(screen.getByLabelText('Название на казахском'));
  await user.click(screen.getByRole('button', { name: 'Обновить общую метку' }));
  await waitFor(() =>
    expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true),
  );
  const post = request.mock.calls.find((call) => call[1]?.method === 'POST');
  expect(JSON.parse(post![1].body)).toMatchObject({ id: 'shared', label: 'Острое', labelKk: '' });
});
