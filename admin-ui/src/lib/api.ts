const BASE_URL = '/admin/api';

function getToken() {
  return localStorage.getItem('adminPwd');
}

async function request(endpoint: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('adminPwd');
      window.dispatchEvent(new Event('unauthorized'));
    }
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP Error ${response.status}`);
  }

  return response.json();
}

export const api = {
  login: async (password: string) => {
    // The backend just expects a Bearer token. To verify, we fetch stats.
    const response = await fetch(`${BASE_URL}/stats?type=sales`, {
      headers: { Authorization: `Bearer ${password}` }
    });
    if (!response.ok) throw new Error('Неверный пароль');
    localStorage.setItem('adminPwd', password);
    return true;
  },
  
  logout: () => {
    localStorage.removeItem('adminPwd');
    window.location.reload();
  },

  getStats: (type?: string) => request(`/stats${type ? `?type=${type}` : ''}`),
  
  getCustomers: (query = '') => request(`/customers${query ? `?search=${encodeURIComponent(query)}` : ''}`),
  updateCustomer: (id: string, data: any) => request(`/customers/update`, { method: 'POST', body: JSON.stringify({ id, ...data }) }),
  notifyInactive: () => request(`/customers/notify-inactive`, { method: 'POST' }),
  expireInactive: () => request(`/customers/expire-inactive`, { method: 'POST' }),
  deleteCustomer: (id: string) => request(`/customers/${id}`, { method: 'DELETE' }),

  getTransactions: () => request(`/transactions`),
  
  getIikoOperations: () => request(`/iiko-operations`),
  
  getSettings: () => request(`/settings`),
  updateSettings: (data: any) => request(`/settings`, { method: 'POST', body: JSON.stringify(data) }),
  
  getStories: () => request(`/stories`),
  addStory: (data: any) => request(`/stories`, { method: 'POST', body: JSON.stringify(data) }),
  updateStory: (data: any) => request(`/stories/update`, { method: 'POST', body: JSON.stringify(data) }),
  deleteStory: (id: string) => request(`/stories/${id}`, { method: 'DELETE' }),
  
  getNews: () => request(`/news`),
  addNews: (data: any) => request(`/news`, { method: 'POST', body: JSON.stringify(data) }),
  updateNews: (data: any) => request(`/news/update`, { method: 'POST', body: JSON.stringify(data) }),
  deleteNews: (id: string) => request(`/news/${id}`, { method: 'DELETE' }),
  
  getLocations: () => request(`/locations`),
  addLocation: (data: any) => request(`/locations`, { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (id: string, data: any) => request(`/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLocation: (id: string) => request(`/locations/${id}`, { method: 'DELETE' }),
  
  uploadPhoto: async (base64: string, filename: string) => {
    return request(`/upload`, { 
      method: 'POST', 
      body: JSON.stringify({ imageBase64: base64, filename })
    });
  },
  
  sendBroadcast: (message: string) => request(`/broadcast`, { method: 'POST', body: JSON.stringify({ message }) }),
};
