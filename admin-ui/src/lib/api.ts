const BASE_URL = '/admin/api';

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface LocalizedText {
  ru: string;
  kk: string;
  en: string;
}

export interface LoyaltyTier {
  id: string;
  code: string;
  names: LocalizedText;
  descriptions: LocalizedText;
  minSpend: number;
  cashbackPercent: number;
  sortOrder: number;
  isActive: boolean;
}

export type LoyaltyTierInput = Omit<LoyaltyTier, 'id'>;

function getToken() {
  return localStorage.getItem('adminToken');
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    return text as T;
  }
  return response.json() as Promise<T>;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);

  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : 'Network request failed', 0, 'NETWORK_ERROR');
  }

  if (!response.ok) {
    const errorData: { error?: string; message?: string; code?: string; details?: unknown } = await parseResponse<{ error?: string; message?: string; code?: string; details?: unknown }>(response).catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('adminToken');
      window.dispatchEvent(new Event('unauthorized'));
    }
    throw new ApiError(
      errorData.error || errorData.message || `HTTP ${response.status}`,
      response.status,
      errorData.code,
      errorData.details,
    );
  }

  return parseResponse<T>(response);
}

function json(method: string, data?: unknown): RequestInit {
  return { method, body: data === undefined ? undefined : JSON.stringify(data) };
}

export const api = {
  login: async (password: string) => {
    const response = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ password }),
    }).catch(() => { throw new ApiError('Network request failed', 0, 'NETWORK_ERROR'); });
    if (!response.ok) throw new ApiError('Invalid password', response.status, 'AUTH_INVALID');
    const data = await parseResponse<{ token?: string }>(response);
    if (!data.token) throw new ApiError('Missing session token', 500, 'AUTH_NO_SESSION');
    localStorage.setItem('adminToken', data.token);
  },

  logout: () => {
    localStorage.removeItem('adminToken');
    window.dispatchEvent(new Event('unauthorized'));
  },

  getStats: () => request<Record<string, number>>('/stats'),
  getCustomers: () => request<any[] | { customers: any[] }>('/customers'),
  updateCustomer: (id: string, data: Record<string, unknown>) => request<{ success: boolean }>('/customers/update', json('POST', { customerId: id, ...data })),
  addCustomerBonus: (customerId: string, amount: number, reason: string) => request<{ success: boolean }>('/customers/bonus', json('POST', { customerId, amount, reason })),
  notifyInactive: () => request<{ success: boolean; notifiedCount?: number; totalNotifiedBalance?: number }>('/customers/notify-inactive', json('POST')),
  expireInactive: () => request<{ success: boolean; expiredCount?: number; totalExpiredAmount?: number }>('/customers/expire-inactive', json('POST')),
  deleteCustomer: (id: string) => request<{ success: boolean }>(`/customers/${encodeURIComponent(id)}`, json('DELETE')),

  getTransactions: () => request<any[]>('/transactions'),
  getIikoOperations: () => request<any[]>('/iiko-operations'),

  getSettings: () => request<Record<string, any>>('/settings'),
  updateSettings: (data: Record<string, unknown>) => request<{ success: boolean }>('/settings', json('POST', data)),

  getStories: () => request<{ success: boolean; stories: any[] }>('/stories'),
  addStory: (data: Record<string, unknown>) => request('/stories', json('POST', data)),
  updateStory: (data: Record<string, any>) => request(`/stories/${encodeURIComponent(data.id)}`, json('PUT', data)),
  deleteStory: (id: string) => request(`/stories/${encodeURIComponent(id)}`, json('DELETE')),

  getNews: () => request<{ success: boolean; news: any[] }>('/news'),
  addNews: (data: Record<string, unknown>) => request('/news', json('POST', data)),
  updateNews: (data: Record<string, any>) => request(`/news/${encodeURIComponent(data.id)}`, json('PUT', data)),
  deleteNews: (id: string) => request(`/news/${encodeURIComponent(id)}`, json('DELETE')),

  getCities: () => request<{ success: boolean; cities: any[] }>('/cities'),
  addCity: (data: Record<string, unknown>) => request('/cities', json('POST', data)),
  updateCity: (id: string, data: Record<string, unknown>) => request(`/cities/${encodeURIComponent(id)}`, json('PUT', data)),
  deleteCity: (id: string) => request(`/cities/${encodeURIComponent(id)}`, json('DELETE')),
  addPoint: (cityId: string, data: Record<string, unknown>) => request('/points', json('POST', { ...data, city_id: cityId })),
  updatePoint: (id: string, data: Record<string, unknown>) => request(`/points/${encodeURIComponent(id)}`, json('PUT', data)),
  deletePoint: (id: string) => request(`/points/${encodeURIComponent(id)}`, json('DELETE')),

  uploadPhoto: (base64: string, filename: string) => request<{ success: boolean; url?: string }>('/upload', json('POST', { imageBase64: base64, filename })),
  sendBroadcast: (message: string) => request<{ success: boolean; count?: number }>('/broadcast', json('POST', { message })),
  sendPushMass: (title: string, body: string) => request<{ success: boolean; count?: number }>('/push/mass', json('POST', { title, body })),

  getLoyaltyTiers: async () => {
    const result = await request<LoyaltyTier[] | { tiers?: LoyaltyTier[]; data?: LoyaltyTier[] }>('/loyalty-tiers');
    return Array.isArray(result) ? result : result.tiers ?? result.data ?? [];
  },
  createLoyaltyTier: async (data: LoyaltyTierInput) => {
    const result = await request<LoyaltyTier | { tier?: LoyaltyTier; data?: LoyaltyTier }>('/loyalty-tiers', json('POST', data));
    return 'id' in result ? result : result.tier ?? result.data;
  },
  updateLoyaltyTier: async (id: string, data: LoyaltyTierInput) => {
    const result = await request<LoyaltyTier | { tier?: LoyaltyTier; data?: LoyaltyTier }>(`/loyalty-tiers/${encodeURIComponent(id)}`, json('PUT', data));
    return 'id' in result ? result : result.tier ?? result.data;
  },
  deleteLoyaltyTier: (id: string) => request(`/loyalty-tiers/${encodeURIComponent(id)}`, json('DELETE')),
  setLoyaltyTierActive: (id: string, isActive: boolean) => request(`/loyalty-tiers/${encodeURIComponent(id)}/active`, json('PATCH', { isActive })),
  reorderLoyaltyTiers: (ids: string[]) => request('/loyalty-tiers/reorder', json('PUT', { ids })),

  // --- Menu Management ---
  getAdminMenu: () => request<{ success: boolean; rawMenu: any; overrides: any }>('/menu'),
  setProductOverride: (iikoProductId: string, overrides: Record<string, any>) =>
    request<{ success: boolean }>('/menu/product/override', json('POST', { iikoProductId, overrides })),
  setCategoryOverride: (iikoCategoryId: string, overrides: Record<string, any>) =>
    request<{ success: boolean }>('/menu/category/override', json('POST', { iikoCategoryId, overrides })),
  upsertCustomProduct: (product: Record<string, any>) =>
    request<{ success: boolean }>('/menu/custom-product', json('POST', product)),
  deleteCustomProduct: (id: string) =>
    request<{ success: boolean }>(`/menu/custom-product/${encodeURIComponent(id)}`, json('DELETE')),
  uploadMenuPhoto: async (file: File): Promise<{ success: boolean; imageUrl?: string }> => {
    const token = getToken();
    const formData = new FormData();
    formData.append('image', file);
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${BASE_URL}/menu/upload-image`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) throw new ApiError('Ошибка загрузки фото', response.status);
    return response.json();
  },
};
