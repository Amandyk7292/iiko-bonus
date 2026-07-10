const BASE_URL = '/admin/api';
localStorage.removeItem('adminPwd');

function getToken() {
  return localStorage.getItem('adminToken');
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
      localStorage.removeItem('adminToken');
      window.dispatchEvent(new Event('unauthorized'));
    }
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP Error ${response.status}`);
  }

  return response.json();
}

export const api = {
  login: async (password: string) => {
    const response = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!response.ok) throw new Error('Неверный пароль');
    const data = await response.json();
    if (!data.token) throw new Error('Сервер не выдал сессию');
    localStorage.setItem('adminToken', data.token);
    return true;
  },
  
  logout: () => {
    localStorage.removeItem('adminToken');
    window.location.reload();
  },

  getStats: (type?: string) => request(`/stats${type ? `?type=${type}` : ''}`),
  
  getCustomers: (query = '') => request(`/customers${query ? `?search=${encodeURIComponent(query)}` : ''}`),
  updateCustomer: (id: string, data: any) => request(`/customers/update`, { method: 'POST', body: JSON.stringify({ customerId: id, ...data }) }),
  notifyInactive: () => request(`/customers/notify-inactive`, { method: 'POST' }),
  expireInactive: () => request(`/customers/expire-inactive`, { method: 'POST' }),
  deleteCustomer: (id: string) => request(`/customers/${id}`, { method: 'DELETE' }),

  getTransactions: () => request(`/transactions`),
  
  getIikoOperations: () => request(`/iiko-operations`),
  
  getSettings: () => request(`/settings`),
  updateSettings: (data: any) => request(`/settings`, { method: 'POST', body: JSON.stringify(data) }),
  
  getStories: () => request(`/stories`),
  addStory: (data: any) => request(`/stories`, { method: 'POST', body: JSON.stringify(data) }),
  updateStory: (data: any) => request(`/stories/${data.id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStory: (id: string) => request(`/stories/${id}`, { method: 'DELETE' }),
  
  getNews: () => request(`/news`),
  addNews: (data: any) => request(`/news`, { method: 'POST', body: JSON.stringify(data) }),
  updateNews: (data: any) => request(`/news/${data.id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNews: (id: string) => request(`/news/${id}`, { method: 'DELETE' }),
  
  getCities: () => request(`/cities`),
  addCity: (data: any) => request(`/cities`, { method: 'POST', body: JSON.stringify(data) }),
  updateCity: (id: string, data: any) => request(`/cities/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCity: (id: string) => request(`/cities/${id}`, { method: 'DELETE' }),
  
  addPoint: (cityId: string, data: any) => request(`/points`, { method: 'POST', body: JSON.stringify({ ...data, city_id: cityId }) }),
  updatePoint: (id: string, data: any) => request(`/points/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePoint: (id: string) => request(`/points/${id}`, { method: 'DELETE' }),

  
  uploadPhoto: async (base64: string, filename: string) => {
    return request(`/upload`, { 
      method: 'POST', 
      body: JSON.stringify({ imageBase64: base64, filename })
    });
  },
  
  sendBroadcast: (message: string) => request(`/broadcast`, { method: 'POST', body: JSON.stringify({ message }) }),
};
