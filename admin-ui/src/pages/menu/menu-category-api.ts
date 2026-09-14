import { request } from '../../lib/api';

export const moveMenuProducts = (
  productIds: string[],
  categoryId: string | null,
  profileKey: string,
) =>
  request<{ success: boolean; productIds: string[] }>('/menu/products/category', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productIds, categoryId, profileKey }),
  });
