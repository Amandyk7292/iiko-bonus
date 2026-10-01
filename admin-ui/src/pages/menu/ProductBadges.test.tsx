import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { it, expect, vi, beforeEach } from 'vitest';
import ProductBadges from './ProductBadges';
const request = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({ request }));
beforeEach(() => request.mockReset());
it('can recover a failed load without closing the product editor', async () => {
  request.mockRejectedValueOnce(new Error('Оформление временно недоступно')).mockResolvedValue({
    badges: [{ id: 'hit', label: 'Хит', background: '#782b0e', foreground: '#ffffff' }],
    selected: ['hit'],
  });
  const user = userEvent.setup();
  render(<ProductBadges productId="bread" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Оформление временно недоступно');
  await user.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
  expect(await screen.findByRole('button', { name: '✓ Хит' })).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('reuses an existing badge instead of creating a new one for each product', async () => {
  request.mockResolvedValue({
    badges: [{ id: 'shared', label: 'Хит', background: '#782b0e', foreground: '#ffffff' }],
    selected: [],
  });
  render(<ProductBadges productId="product-two" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Хит' }));
  await user.click(screen.getByRole('button', { name: 'Сохранить оформление товара' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/menu/badges/assignment',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ productId: 'product-two', badgeIds: ['shared'], stickerId: null }),
      }),
    ),
  );
  expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
});

it('switches between heart and round stickers without replacing text badges and can remove it', async () => {
  const sticker = {
    id: 'portrait',
    label: 'Менің таңдауым (сердце)',
    imageUrl: 'https://example.com/sticker.png',
    background: '#782b0e',
    foreground: '#ffffff',
  };
  request.mockResolvedValue({
    badges: [
      sticker,
      {
        ...sticker,
        id: 'round',
        label: 'Менің таңдауым (круг)',
        imageUrl: 'https://example.com/round.png',
      },
      { id: 'hit', label: 'Хит', background: '#782b0e', foreground: '#ffffff' },
    ],
    selected: ['hit'],
    stickerId: null,
  });
  render(<ProductBadges productId="bread" imageUrl="https://example.com/bread.jpg" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Менің таңдауым (сердце)' }));
  expect(screen.getByLabelText('Предпросмотр стикера на товаре')).toBeVisible();
  expect(screen.getByRole('button', { name: '✓ Хит' })).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('button', { name: 'Сохранить оформление товара' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/menu/badges/assignment',
      expect.objectContaining({
        body: JSON.stringify({ productId: 'bread', badgeIds: ['hit'], stickerId: 'portrait' }),
      }),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Менің таңдауым (круг)' }));
  expect(screen.getByRole('button', { name: 'Менің таңдауым (сердце)' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(screen.getByRole('button', { name: 'Менің таңдауым (круг)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await user.click(screen.getByRole('button', { name: 'Сохранить оформление товара' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/menu/badges/assignment',
      expect.objectContaining({
        body: JSON.stringify({ productId: 'bread', badgeIds: ['hit'], stickerId: 'round' }),
      }),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Без стикера' }));
  await user.click(screen.getByRole('button', { name: 'Сохранить оформление товара' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/menu/badges/assignment',
      expect.objectContaining({
        body: JSON.stringify({ productId: 'bread', badgeIds: ['hit'], stickerId: null }),
      }),
    ),
  );
  expect(screen.queryByLabelText('Предпросмотр стикера на товаре')).not.toBeInTheDocument();
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
  await user.click(screen.getByText('Создать метку'));
  await waitFor(() => expect(screen.getByLabelText('Название на русском')).toBeEnabled());
  await user.type(screen.getByLabelText('Название на русском'), 'Острое');
  await user.type(screen.getByLabelText('Название на казахском'), 'Ащы');
  await user.click(screen.getByRole('button', { name: 'Создать общую метку' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  const post = request.mock.calls.find((call) => call[1]?.method === 'POST');
  expect(JSON.parse(post![1].body)).toMatchObject({ label: 'Острое', labelKk: 'Ащы' });
  expect(await screen.findByRole('button', { name: 'Острое' })).toBeVisible();
});

it('uploads a transparent sticker to the shared catalog and selects it for this product', async () => {
  URL.createObjectURL = vi.fn(() => 'blob:sticker-preview');
  URL.revokeObjectURL = vi.fn();
  request.mockImplementation(async (path, options) => {
    if (path === '/menu/upload-image') return { imageUrl: 'https://example.com/uploaded.png' };
    if (options?.method === 'POST')
      return { badge: { id: 'uploaded', ...JSON.parse(options.body) } };
    return { badges: [], selected: [] };
  });
  render(<ProductBadges productId="bread" />);
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText('Название стикера')).toBeEnabled());
  await user.click(screen.getByText('Добавить свой стикер'));
  await user.type(screen.getByLabelText('Название стикера'), 'Выбор пекаря');
  await user.upload(
    screen.getByLabelText('Изображение стикера'),
    new File(['png'], 'sticker.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: 'Добавить стикер' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Выбор пекаря' })).toHaveAttribute(
      'aria-pressed',
      'true',
    ),
  );
  const upload = request.mock.calls.find(([path]) => path === '/menu/upload-image');
  expect(upload![1].body).toBeInstanceOf(FormData);
  await user.click(screen.getByRole('button', { name: 'Сохранить оформление товара' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/menu/badges/assignment',
      expect.objectContaining({
        body: JSON.stringify({ productId: 'bread', badgeIds: [], stickerId: 'uploaded' }),
      }),
    ),
  );
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
