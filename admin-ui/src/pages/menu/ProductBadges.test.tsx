import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { it, expect, vi } from 'vitest';
import ProductBadges from './ProductBadges';
const request = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({ request }));
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
