import type { PaymentDiagnostics } from './payment-diagnostics';
const BASE_URL = '/admin/api';
const BRANCH_SCOPE_STORAGE_KEY = 'adminSelectedBranchId';

export function getAdminBranchScope() {
  return localStorage.getItem(BRANCH_SCOPE_STORAGE_KEY) || '';
}

export function setAdminBranchScope(branchId: string) {
  const value = String(branchId || '').trim();
  if (value) localStorage.setItem(BRANCH_SCOPE_STORAGE_KEY, value);
  else localStorage.removeItem(BRANCH_SCOPE_STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  requestId?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

type ApiErrorPayload = {
  error?: string;
  message?: string;
  code?: string;
  details?: unknown;
  requestId?: string;
};

export function adminApiErrorMessage(payload: ApiErrorPayload, status: number) {
  const rawMessage = String(payload.error || payload.message || '').trim();
  const requestId = String(payload.requestId || '').trim();
  const requestHint = requestId ? `Код запроса: ${requestId}.` : '';
  if (status >= 500 || rawMessage === 'Internal Server Error') {
    return [
      'Не удалось выполнить действие. Обновите данные и повторите попытку.',
      requestHint ? `Если ошибка повторится, сообщите поддержке. ${requestHint}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return [rawMessage || `Ошибка запроса (${status})`, requestHint].filter(Boolean).join(' ');
}

const responseRequestId = (response: Response) =>
  String(
    response.headers.get('x-request-id') || response.headers.get('x-correlation-id') || '',
  ).trim();

const REQUEST_TIMEOUT_MS = 30000;

export function composeRequestAbortSignal(
  callerSignal?: AbortSignal | null,
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  let timedOut = false;
  let cleanedUp = false;
  const abortFromCaller = () => controller.abort();

  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const timeout = window.setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (cleanedUp) return;
      cleanedUp = true;
      window.clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

import type {
  LocalizedText,
  LoyaltyTier,
  LoyaltyTierInput,
  ContactDisplayMode,
  ContactActionType,
  ContactAction,
  ContactCard,
  ContactCardInput,
  ContactActionInput,
  OrderSubstitution,
  AdminOrder,
  InventoryItem,
  PartialRefundOptions,
  PartialRefundPreview,
  PartialRefundResult,
  Courier,
  CourierActivity,
  DeliveryProof,
  ExternalDelivery,
  DispatchOrder,
  YandexDeliveryConfiguration,
  AdminUser,
  AdminScopeLocation,
  AdminLocationCity,
  BranchPosCredentialStatus,
  BranchPosCredentialSecret,
  OperationsSummary,
  IntegrationHealthService,
  SupportRequest,
  SupportMessage,
  AdminGlobalEntityType,
  AdminGlobalSearchResult,
  AdminGlobalDetail,
  AdminGlobalTimelineEvent,
  AdminGlobalCustomerProfile,
  AdminGlobalSupportSummary,
  AdminPhoneLoginChallenge,
  WhatsAppAssistantSettings,
  WhatsAppConnectionStatus,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppMemory,
  WhatsAppKnowledgeDocument,
  SecurityStatus,
  SiteAccessConfig,
  SiteAccessResponse,
  AuditLog,
} from './api-types';
export type {
  LocalizedText,
  LoyaltyTier,
  LoyaltyTierInput,
  ContactDisplayMode,
  ContactActionType,
  ContactAction,
  ContactCard,
  ContactCardInput,
  ContactActionInput,
  OrderSubstitution,
  AdminOrder,
  InventoryItem,
  PartialRefundOptions,
  PartialRefundPreview,
  PartialRefundResult,
  Courier,
  CourierActivity,
  DeliveryProof,
  ExternalDelivery,
  DispatchOrder,
  YandexDeliveryConfiguration,
  AdminUser,
  AdminScopeLocation,
  AdminLocationCity,
  BranchPosCredentialStatus,
  BranchPosCredentialSecret,
  OperationsSummary,
  IntegrationHealthService,
  SupportRequest,
  SupportMessage,
  AdminGlobalEntityType,
  AdminGlobalSearchResult,
  AdminGlobalDetail,
  AdminGlobalTimelineEvent,
  AdminGlobalCustomerProfile,
  AdminGlobalSupportSummary,
  AdminPhoneLoginChallenge,
  WhatsAppAssistantSettings,
  WhatsAppConnectionStatus,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppMemory,
  WhatsAppKnowledgeDocument,
  SecurityStatus,
  SiteAccessConfig,
  SiteAccessResponse,
  AuditLog,
} from './api-types';

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const requestId = responseRequestId(response);
    throw new ApiError(
      adminApiErrorMessage(
        { error: 'Сервер вернул некорректный ответ API', requestId },
        response.status,
      ),
      response.status,
      'INVALID_API_RESPONSE',
      undefined,
      requestId || undefined,
    );
  }
  return response.json() as Promise<T>;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);

  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');
  const selectedBranchId = getAdminBranchScope();
  if (
    selectedBranchId &&
    endpoint !== '/session' &&
    endpoint !== '/scope' &&
    !endpoint.startsWith('/login')
  ) {
    headers.set('X-Bulka-Branch-Id', selectedBranchId);
  }

  let response: Response;
  const requestAbort = composeRequestAbortSignal(options.signal);
  try {
    response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
      credentials: 'same-origin',
      signal: requestAbort.signal,
    });
  } catch (error) {
    throw new ApiError(
      requestAbort.didTimeout() || (error instanceof Error && error.name === 'AbortError')
        ? 'Сервер не ответил вовремя. Повторите попытку.'
        : 'Нет связи с сервером. Проверьте интернет и повторите попытку.',
      0,
      'NETWORK_ERROR',
    );
  } finally {
    requestAbort.cleanup();
  }

  if (!response.ok) {
    const errorData = await parseResponse<ApiErrorPayload>(response).catch(
      (): ApiErrorPayload => ({}),
    );
    const requestId = errorData.requestId || responseRequestId(response) || undefined;
    const payload = { ...errorData, requestId };
    if (response.status === 401) {
      window.dispatchEvent(new Event('unauthorized'));
    }
    throw new ApiError(
      adminApiErrorMessage(payload, response.status),
      response.status,
      errorData.code,
      errorData.details,
      requestId,
    );
  }

  return parseResponse<T>(response);
}

function json(method: string, data?: unknown): RequestInit {
  return { method, body: data === undefined ? undefined : JSON.stringify(data) };
}

async function publicAuthRequest<T>(endpoint: string, data: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(data),
  }).catch(() => {
    throw new ApiError(
      'Нет связи с сервером. Проверьте интернет и повторите попытку.',
      0,
      'NETWORK_ERROR',
    );
  });
  if (!response.ok) {
    const errorData = await parseResponse<ApiErrorPayload>(response).catch(
      (): ApiErrorPayload => ({}),
    );
    const requestId = errorData.requestId || responseRequestId(response) || undefined;
    const payload = {
      ...errorData,
      error: errorData.error || 'Не удалось выполнить вход',
      requestId,
    };
    throw new ApiError(
      adminApiErrorMessage(payload, response.status),
      response.status,
      errorData.code,
      errorData.details,
      requestId,
    );
  }
  return parseResponse<T>(response);
}

export const api = {
  login: async (username: string, password: string, code: string) => {
    const loginData = { username, password, ...(code.trim() && { code: code.trim() }) };
    const response = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(loginData),
    }).catch(() => {
      throw new ApiError(
        'Нет связи с сервером. Проверьте интернет и повторите попытку.',
        0,
        'NETWORK_ERROR',
      );
    });
    if (!response.ok) {
      const errorData = await parseResponse<ApiErrorPayload>(response).catch(
        (): ApiErrorPayload => ({}),
      );
      const requestId = errorData.requestId || responseRequestId(response) || undefined;
      throw new ApiError(
        adminApiErrorMessage(
          {
            ...errorData,
            error: errorData.error || 'Не удалось выполнить вход',
            requestId,
          },
          response.status,
        ),
        response.status,
        response.status === 401 ? 'AUTH_INVALID' : 'AUTH_CONFIG',
        errorData.details,
        requestId,
      );
    }
    return parseResponse<{ user: AdminUser }>(response);
  },

  requestAdminPhoneLogin: (phone: string) =>
    publicAuthRequest<AdminPhoneLoginChallenge>('/login/phone/request', { phone }),

  verifyAdminPhoneLogin: (phone: string, code: string) =>
    publicAuthRequest<{ user: AdminUser }>('/login/phone/verify', { phone, code }),

  exchangeWhatsAppOperatorAccess: (token: string) =>
    publicAuthRequest<{ user: AdminUser }>('/whatsapp/operator-access', { token }),

  session: () => request<{ user: AdminUser }>('/session'),
  getAdminScope: () =>
    request<{
      success: boolean;
      locations: AdminScopeLocation[];
      selectedBranchId: string | null;
    }>('/scope'),
  logout: async () => {
    await request('/logout', json('POST')).catch(() => undefined);
    window.dispatchEvent(new Event('unauthorized'));
  },

  getStats: () => request<Record<string, any>>('/stats'),
  globalSearch: (query: string, limit = 20, signal?: AbortSignal) => {
    const params = new URLSearchParams({
      q: query.trim(),
      limit: String(Math.max(1, Math.min(20, limit))),
    });
    return request<{ success: boolean; results: AdminGlobalSearchResult[] }>(
      `/global-search?${params}`,
      { signal },
    );
  },
  getGlobalSearchDetail: (type: AdminGlobalEntityType, id: string, signal?: AbortSignal) =>
    request<{ success: boolean; detail: AdminGlobalDetail }>(
      `/global-search/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
      { signal },
    ),
  getOperationsSummary: () =>
    request<OperationsSummary & { success: boolean }>('/operations/summary'),
  getIntegrationHealth: () =>
    request<{
      success: boolean;
      checkedAt: string;
      services: IntegrationHealthService[];
      payments: PaymentDiagnostics;
    }>('/integrations/status'),
  setForteWidgetEnabled: (enabled: boolean) =>
    request<{ success: boolean; payments: PaymentDiagnostics }>(
      '/integrations/payments/widget',
      json('PUT', { enabled }),
    ),
  runPaymentProbe: () =>
    request<{ success: boolean; payments: PaymentDiagnostics }>(
      '/integrations/payments/probe',
      json('POST'),
    ),
  getCustomers: ({ page = 1, pageSize = 50, search = '' } = {}) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) params.set('search', search.trim());
    return request<{ customers: any[]; total: number; page: number; pageSize: number }>(
      `/customers?${params}`,
    );
  },
  getOrders: ({
    page = 1,
    pageSize = 50,
    search = '',
    paymentStatus = '',
    orderStatus = '',
  } = {}) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) params.set('search', search.trim());
    if (paymentStatus) params.set('paymentStatus', paymentStatus);
    if (orderStatus) params.set('orderStatus', orderStatus);
    return request<{ orders: AdminOrder[]; total: number; page: number; pageSize: number }>(
      `/orders?${params}`,
    );
  },
  updateOrderStatus: (id: string, status: string, cancellationReason = '') =>
    request<{ success: boolean; order: AdminOrder }>(
      `/orders/${encodeURIComponent(id)}/status`,
      json('PATCH', { status, cancellationReason }),
    ),
  assignCourier: (id: string, courierId: string, estimatedDeliveryAt?: string | null) =>
    request<{ success: boolean; order: AdminOrder }>(
      `/orders/${encodeURIComponent(id)}/courier`,
      json('PATCH', { courierId, estimatedDeliveryAt: estimatedDeliveryAt || null }),
    ),
  updateDeliveryStatus: (id: string, status: string) =>
    request<{ success: boolean; order: AdminOrder }>(
      `/orders/${encodeURIComponent(id)}/delivery-status`,
      json('PATCH', { status }),
    ),
  getRefundOptions: (id: string) =>
    request<{ success: boolean; refund: PartialRefundOptions }>(
      `/orders/${encodeURIComponent(id)}/refund-options`,
    ),
  previewPartialRefund: (
    id: string,
    data: {
      reason?: string;
      items: Array<{ lineKey: string; quantity: number }>;
    },
    signal?: AbortSignal,
  ) =>
    request<{ success: boolean; preview: PartialRefundPreview }>(
      `/orders/${encodeURIComponent(id)}/partial-refund-preview`,
      { ...json('POST', data), signal },
    ),
  partialRefund: (
    id: string,
    data: {
      idempotencyKey: string;
      reason?: string;
      items: Array<{ lineKey: string; quantity: number }>;
    },
  ) =>
    request<{ success: boolean; refund: PartialRefundResult }>(
      `/orders/${encodeURIComponent(id)}/partial-refund`,
      json('POST', data),
    ),
  getSubstitutionOptions: (id: string) =>
    request<{
      success: boolean;
      options: {
        lines: Array<{
          lineKey: string;
          productId: string;
          name: string;
          quantity: number;
          refundableQuantity: number;
        }>;
        replacements: Array<{
          productId: string;
          productName: string;
          availableQuantity: number | null;
        }>;
      };
    }>(`/orders/${encodeURIComponent(id)}/substitution-options`),
  createSubstitution: (
    id: string,
    data: {
      lineKey: string;
      quantity: number;
      action: OrderSubstitution['action'];
      replacementProductId?: string;
      note?: string;
    },
  ) =>
    request<{ success: boolean; substitution: OrderSubstitution }>(
      `/orders/${encodeURIComponent(id)}/substitutions`,
      json('POST', data),
    ),
  completeSubstitution: (id: string, requestId: string) =>
    request<{ success: boolean; substitution: OrderSubstitution }>(
      `/orders/${encodeURIComponent(id)}/substitutions/${encodeURIComponent(requestId)}/complete`,
      json('PATCH'),
    ),
  updateCustomer: (id: string, data: Record<string, unknown>) =>
    request<{ success: boolean }>('/customers/update', json('POST', { customerId: id, ...data })),
  addCustomerBonus: (customerId: string, amount: number, reason: string) =>
    request<{ success: boolean }>('/customers/bonus', json('POST', { customerId, amount, reason })),
  notifyInactive: () =>
    request<{ success: boolean; notifiedCount?: number; totalNotifiedBalance?: number }>(
      '/customers/notify-inactive',
      json('POST'),
    ),
  expireInactive: () =>
    request<{ success: boolean; expiredCount?: number; totalExpiredAmount?: number }>(
      '/customers/expire-inactive',
      json('POST'),
    ),
  deleteCustomer: (id: string) =>
    request<{ success: boolean }>(`/customers/${encodeURIComponent(id)}`, json('DELETE')),

  getTransactions: ({
    page = 1,
    pageSize = 50,
    search = '',
    dateFrom = '',
    dateTo = '',
    type = '',
  } = {}) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) params.set('search', search.trim());
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (type) params.set('type', type);
    return request<{
      transactions: any[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/transactions?${params}`);
  },
  getIikoOperations: () => request<any[]>('/iiko-operations'),

  getSettings: () => request<Record<string, any>>('/settings'),
  updateSettings: (data: Record<string, unknown>) =>
    request<{ success: boolean }>('/settings', json('POST', data)),

  getWhatsAppConsoleStatus: () =>
    request<{
      success: boolean;
      connection: WhatsAppConnectionStatus;
      settings: WhatsAppAssistantSettings | null;
    }>('/whatsapp/status'),
  getWhatsAppSettings: () =>
    request<{ success: boolean; settings: WhatsAppAssistantSettings }>('/whatsapp/settings'),
  updateWhatsAppSettings: (data: Partial<WhatsAppAssistantSettings> & { apiKey?: string }) =>
    request<{ success: boolean; settings: WhatsAppAssistantSettings }>(
      '/whatsapp/settings',
      json('PUT', data),
    ),
  getWhatsAppConversations: (
    { search = '', status = '', page = 1, pageSize = 50 } = {},
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    return request<{
      success: boolean;
      conversations: WhatsAppConversation[];
      total: number;
      unread: number;
      page: number;
      pageSize: number;
    }>(`/whatsapp/conversations${params.size ? `?${params}` : ''}`, { signal });
  },
  getWhatsAppConversation: (id: string, signal?: AbortSignal) =>
    request<{
      success: boolean;
      conversation: WhatsAppConversation;
      messages: WhatsAppMessage[];
      memories: WhatsAppMemory[];
    }>(`/whatsapp/conversations/${encodeURIComponent(id)}`, { signal }),
  updateWhatsAppConversation: (
    id: string,
    data: Partial<Pick<WhatsAppConversation, 'status' | 'assistantEnabled' | 'displayName'>> & {
      markRead?: boolean;
    },
  ) =>
    request<{ success: boolean; conversation: WhatsAppConversation }>(
      `/whatsapp/conversations/${encodeURIComponent(id)}`,
      json('PATCH', data),
    ),
  sendWhatsAppReply: (id: string, text: string, clientMessageId: string) =>
    request<{
      success: boolean;
      message: WhatsAppMessage;
      conversation: WhatsAppConversation;
      queued: boolean;
    }>(
      `/whatsapp/conversations/${encodeURIComponent(id)}/messages`,
      json('POST', { text, clientMessageId }),
    ),
  sendWhatsAppVoice: (
    id: string,
    audio: Blob,
    durationSeconds: number,
    clientMessageId: string,
  ) => {
    const form = new FormData();
    const extension = audio.type.includes('ogg')
      ? 'ogg'
      : audio.type.includes('mp4')
        ? 'm4a'
        : 'webm';
    form.append('audio', audio, `voice-${Date.now()}.${extension}`);
    form.append('durationSeconds', String(durationSeconds));
    form.append('clientMessageId', clientMessageId);
    return request<{
      success: boolean;
      message: WhatsAppMessage;
      conversation: WhatsAppConversation;
      queued: boolean;
    }>(`/whatsapp/conversations/${encodeURIComponent(id)}/voice`, {
      method: 'POST',
      body: form,
    });
  },
  createWhatsAppMemory: (
    conversationId: string,
    data: {
      label: string;
      content: string;
      sourceType?: WhatsAppMemory['sourceType'];
      sourceMessageId?: string | null;
    },
  ) =>
    request<{ success: boolean; memory: WhatsAppMemory }>(
      `/whatsapp/conversations/${encodeURIComponent(conversationId)}/memories`,
      json('POST', data),
    ),
  deleteWhatsAppMemory: (conversationId: string, memoryId: string) =>
    request<{ success: boolean }>(
      `/whatsapp/conversations/${encodeURIComponent(conversationId)}/memories/${encodeURIComponent(memoryId)}`,
      json('DELETE'),
    ),
  getWhatsAppKnowledge: () =>
    request<{ success: boolean; documents: WhatsAppKnowledgeDocument[] }>('/whatsapp/knowledge'),
  createWhatsAppKnowledge: (
    data: Omit<WhatsAppKnowledgeDocument, 'id' | 'createdAt' | 'updatedAt'>,
  ) =>
    request<{ success: boolean; document: WhatsAppKnowledgeDocument }>(
      '/whatsapp/knowledge',
      json('POST', data),
    ),
  updateWhatsAppKnowledge: (
    id: string,
    data: Partial<Omit<WhatsAppKnowledgeDocument, 'id' | 'createdAt' | 'updatedAt'>>,
  ) =>
    request<{ success: boolean; document: WhatsAppKnowledgeDocument }>(
      `/whatsapp/knowledge/${encodeURIComponent(id)}`,
      json('PUT', data),
    ),
  deleteWhatsAppKnowledge: (id: string) =>
    request<{ success: boolean }>(`/whatsapp/knowledge/${encodeURIComponent(id)}`, json('DELETE')),

  getStories: () => request<{ success: boolean; stories: any[] }>('/stories'),
  addStory: (data: Record<string, unknown>) => request('/stories', json('POST', data)),
  updateStory: (data: Record<string, any>) =>
    request(`/stories/${encodeURIComponent(data.id)}`, json('PUT', data)),
  deleteStory: (id: string) => request(`/stories/${encodeURIComponent(id)}`, json('DELETE')),

  getNews: () => request<{ success: boolean; news: any[] }>('/news'),
  addNews: (data: Record<string, unknown>) => request('/news', json('POST', data)),
  updateNews: (data: Record<string, any>) =>
    request(`/news/${encodeURIComponent(data.id)}`, json('PUT', data)),
  deleteNews: (id: string) => request(`/news/${encodeURIComponent(id)}`, json('DELETE')),

  getCities: () => request<{ success: boolean; cities: any[] }>('/cities'),
  addCity: (data: Record<string, unknown>) => request('/cities', json('POST', data)),
  updateCity: (id: string, data: Record<string, unknown>) =>
    request(`/cities/${encodeURIComponent(id)}`, json('PUT', data)),
  deleteCity: (id: string) => request(`/cities/${encodeURIComponent(id)}`, json('DELETE')),
  addPoint: (cityId: string, data: Record<string, unknown>) =>
    request('/points', json('POST', { ...data, city_id: cityId })),
  updatePoint: (id: string, data: Record<string, unknown>) =>
    request(`/points/${encodeURIComponent(id)}`, json('PUT', data)),
  deletePoint: (id: string) => request(`/points/${encodeURIComponent(id)}`, json('DELETE')),
  getFulfillmentLocations: () => request<{ success: boolean; locations: any[] }>('/locations'),
  getLocationCities: () =>
    request<{ success: boolean; cities: AdminLocationCity[] }>('/locations/cities'),
  createLocationCity: (data: { name: string; latitude: number; longitude: number }) =>
    request<{ success: boolean; city: AdminLocationCity }>('/locations/cities', json('POST', data)),
  createFulfillmentLocation: (data: Record<string, unknown>) =>
    request<{ success: boolean; location: any }>('/locations', json('POST', data)),
  updateFulfillmentLocation: (id: string, data: Record<string, unknown>) =>
    request<{ success: boolean; location: any }>(
      `/locations/${encodeURIComponent(id)}`,
      json('PATCH', data),
    ),
  getBranchPosCredential: (id: string) =>
    request<{ success: boolean; credential: BranchPosCredentialStatus }>(
      `/locations/${encodeURIComponent(id)}/pos-credential`,
    ),
  rotateBranchPosCredential: (id: string) =>
    request<{ success: boolean; credential: BranchPosCredentialSecret }>(
      `/locations/${encodeURIComponent(id)}/pos-credential/rotate`,
      json('POST'),
    ),
  updateAllFulfillmentDeliveryZones: (data: {
    deliveryZones: Array<Record<string, unknown>>;
    enableDelivery: boolean;
  }) =>
    request<{ success: boolean; locations: any[]; updatedCount: number }>(
      '/locations/delivery-zones/bulk',
      json('PATCH', data),
    ),

  getInventory: (branchId = '') => {
    const params = new URLSearchParams();
    if (branchId) params.set('branchId', branchId);
    return request<{ success: boolean; inventory: InventoryItem[] }>(
      `/inventory${params.size ? `?${params}` : ''}`,
    );
  },
  syncInventory: () =>
    request<{ success: boolean; results: unknown[] }>('/inventory/sync', json('POST')),
  updateInventory: (
    branchId: string,
    productId: string,
    data: {
      productName?: string;
      sourceQuantity: number | null;
      manualStop: boolean;
      preparationMinutes?: number | null;
    },
  ) =>
    request<{ success: boolean; inventory: InventoryItem }>(
      `/inventory/${encodeURIComponent(branchId)}/${encodeURIComponent(productId)}`,
      json('PUT', data),
    ),

  getCouriers: () => request<{ success: boolean; couriers: Courier[] }>('/couriers'),
  createCourier: (data: Pick<Courier, 'name' | 'phone' | 'vehicle' | 'active'>) =>
    request<{ success: boolean; courier: Courier }>('/couriers', json('POST', data)),
  updateCourier: (id: string, data: Pick<Courier, 'name' | 'phone' | 'vehicle' | 'active'>) =>
    request<{ success: boolean; courier: Courier }>(
      `/couriers/${encodeURIComponent(id)}`,
      json('PUT', data),
    ),
  setCourierActive: (id: string, active: boolean) =>
    request<{ success: boolean; courier: Courier }>(
      `/couriers/${encodeURIComponent(id)}/active`,
      json('PATCH', { active }),
    ),
  revokeCourierSessions: (id: string) =>
    request<{ success: boolean }>(
      `/couriers/${encodeURIComponent(id)}/revoke-sessions`,
      json('POST'),
    ),
  getCourierActivity: (id: string) =>
    request<{ success: boolean; activity: CourierActivity[] }>(
      `/couriers/${encodeURIComponent(id)}/activity`,
    ),
  getDeliveryProof: (orderId: string) =>
    request<{ success: boolean; proof: DeliveryProof }>(
      `/orders/${encodeURIComponent(orderId)}/delivery-proof`,
    ),

  getDispatch: () =>
    request<{
      success: boolean;
      couriers: any[];
      orders: DispatchOrder[];
      yandexDelivery: YandexDeliveryConfiguration;
    }>('/dispatch'),
  autoAssignCourier: (orderId: string) =>
    request<{ success: boolean; courier: any; eta: string }>(
      `/dispatch/${encodeURIComponent(orderId)}/auto-assign`,
      json('POST'),
    ),
  quoteYandexDelivery: (orderId: string) =>
    request<{ success: boolean; delivery: ExternalDelivery }>(
      `/dispatch/${encodeURIComponent(orderId)}/yandex/quote`,
      json('POST'),
    ),
  requestYandexDelivery: (orderId: string) =>
    request<{ success: boolean; delivery: ExternalDelivery }>(
      `/dispatch/${encodeURIComponent(orderId)}/yandex/request`,
      json('POST'),
    ),
  syncYandexDelivery: (orderId: string) =>
    request<{ success: boolean; delivery: ExternalDelivery | null }>(
      `/dispatch/${encodeURIComponent(orderId)}/yandex/sync`,
      json('POST'),
    ),
  getYandexCancellationInfo: (orderId: string) =>
    request<{
      success: boolean;
      cancellation: {
        cancelState: 'free' | 'paid' | 'unavailable';
        price: number;
        currency: string;
      };
    }>(`/dispatch/${encodeURIComponent(orderId)}/yandex/cancel-info`, json('POST')),
  cancelYandexDelivery: (orderId: string, allowPaid = false) =>
    request<{ success: boolean; delivery: ExternalDelivery }>(
      `/dispatch/${encodeURIComponent(orderId)}/yandex/cancel`,
      json('POST', { allowPaid }),
    ),
  setCourierAvailability: (id: string, status: string) =>
    request<{ success: boolean; courier: any }>(
      `/dispatch/couriers/${encodeURIComponent(id)}/availability`,
      json('PATCH', { status }),
    ),
  getKitchenOrders: (branchId = '', includeClosed = false) => {
    const params = new URLSearchParams({ includeClosed: String(includeClosed) });
    if (branchId) params.set('branchId', branchId);
    return request<{ success: boolean; orders: any[] }>(`/kitchen?${params}`);
  },
  updateKitchenStatus: (id: string, status: string, preparationMinutes?: number) =>
    request<{ success: boolean; order: any }>(
      `/kitchen/${encodeURIComponent(id)}/status`,
      json('PATCH', { status, preparationMinutes }),
    ),
  getReviews: ({ status = '', search = '', page = 1, pageSize = 30 } = {}) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) params.set('status', status);
    if (search.trim()) params.set('search', search.trim());
    return request<{
      success: boolean;
      reviews: any[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/reviews?${params}`);
  },
  updateReviewStatus: (id: string, status: string) =>
    request<{ success: boolean; review: any }>(
      `/reviews/${encodeURIComponent(id)}/status`,
      json('PATCH', { status }),
    ),
  getSupportRequests: ({
    status = '',
    queue = '',
    priority = '',
    search = '',
    page = 1,
    pageSize = 30,
  } = {}) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) params.set('status', status);
    if (queue) params.set('queue', queue);
    if (priority) params.set('priority', priority);
    if (search.trim()) params.set('search', search.trim());
    return request<{
      success: boolean;
      requests: SupportRequest[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/support?${params}`);
  },
  getSupportRequest: (id: string, signal?: AbortSignal) =>
    request<{
      success: boolean;
      request: SupportRequest;
      messages: SupportMessage[];
    }>(`/support/${encodeURIComponent(id)}`, { signal }),
  updateSupportRequest: (
    id: string,
    data: {
      status?: string;
      priority?: string;
      resolution?: string;
      assignedTo?: string | null;
      assignToMe?: boolean;
    },
  ) =>
    request<{ success: boolean; request: SupportRequest }>(
      `/support/${encodeURIComponent(id)}`,
      json('PATCH', data),
    ),
  sendSupportMessage: (id: string, body: string, internal = false) =>
    request<{
      success: boolean;
      request: SupportRequest;
      messages: SupportMessage[];
    }>(`/support/${encodeURIComponent(id)}/messages`, json('POST', { body, internal })),
  getPromotions: () => request<{ success: boolean; promotions: any[] }>('/promotions'),
  createPromotion: (data: Record<string, unknown>) =>
    request<{ success: boolean; promotion: any }>('/promotions', json('POST', data)),
  updatePromotion: (id: string, data: Record<string, unknown>) =>
    request<{ success: boolean; promotion: any }>(
      `/promotions/${encodeURIComponent(id)}`,
      json('PUT', data),
    ),
  getGiftCards: () => request<{ success: boolean; giftCards: any[] }>('/gift-cards'),
  issueGiftCard: (data: Record<string, unknown>) =>
    request<{ success: boolean; giftCard: any }>('/gift-cards', json('POST', data)),
  getAutomations: () => request<{ success: boolean; automations: any[] }>('/automations'),
  updateAutomation: (id: string, data: Record<string, unknown>) =>
    request<{ success: boolean; automation: any }>(
      `/automations/${encodeURIComponent(id)}`,
      json('PUT', data),
    ),
  getAccessProfiles: () =>
    request<{ success: boolean; profiles: any[]; configuredUsers: string[] }>('/access'),
  createAccessProfile: (data: Record<string, unknown>) =>
    request<{ success: boolean; profile: any }>('/access', json('POST', data)),
  updateAccessProfile: (username: string, data: Record<string, unknown>) =>
    request<{ success: boolean; profile: any }>(
      `/access/${encodeURIComponent(username)}`,
      json('PUT', data),
    ),
  getSiteAccess: () => request<SiteAccessResponse>('/site-access'),
  updateSiteAccess: (data: SiteAccessConfig) =>
    request<SiteAccessResponse>('/site-access', json('PUT', data)),

  getSecurityStatus: () => request<SecurityStatus & { success: boolean }>('/security/status'),
  getAuditLogs: ({
    page = 1,
    pageSize = 50,
    search = '',
    method = '',
    outcome = '',
  }: {
    page?: number;
    pageSize?: number;
    search?: string;
    method?: string;
    outcome?: string;
  } = {}) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) params.set('search', search.trim());
    if (method) params.set('method', method);
    if (outcome) params.set('outcome', outcome);
    return request<{
      success: boolean;
      logs: AuditLog[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/audit-logs?${params}`);
  },

  uploadPhoto: (base64: string, filename: string) =>
    request<{ success: boolean; url?: string }>(
      '/upload',
      json('POST', { imageBase64: base64, filename }),
    ),
  sendBroadcast: (message: string) =>
    request<{ success: boolean; count?: number }>('/broadcast', json('POST', { message })),
  sendPushMass: (titles: LocalizedText, bodies: LocalizedText) =>
    request<{ success: boolean; count?: number }>(
      '/push/mass',
      json('POST', { titleTranslations: titles, bodyTranslations: bodies }),
    ),

  getLoyaltyTiers: async () => {
    const result = await request<LoyaltyTier[] | { tiers?: LoyaltyTier[]; data?: LoyaltyTier[] }>(
      '/loyalty-tiers',
    );
    return Array.isArray(result) ? result : (result.tiers ?? result.data ?? []);
  },
  createLoyaltyTier: async (data: LoyaltyTierInput) => {
    const result = await request<LoyaltyTier | { tier?: LoyaltyTier; data?: LoyaltyTier }>(
      '/loyalty-tiers',
      json('POST', data),
    );
    return 'id' in result ? result : (result.tier ?? result.data);
  },
  updateLoyaltyTier: async (id: string, data: LoyaltyTierInput) => {
    const result = await request<LoyaltyTier | { tier?: LoyaltyTier; data?: LoyaltyTier }>(
      `/loyalty-tiers/${encodeURIComponent(id)}`,
      json('PUT', data),
    );
    return 'id' in result ? result : (result.tier ?? result.data);
  },
  deleteLoyaltyTier: (id: string) =>
    request(`/loyalty-tiers/${encodeURIComponent(id)}`, json('DELETE')),
  setLoyaltyTierActive: (id: string, isActive: boolean) =>
    request(`/loyalty-tiers/${encodeURIComponent(id)}/active`, json('PATCH', { isActive })),
  reorderLoyaltyTiers: (ids: string[]) => request('/loyalty-tiers/reorder', json('PUT', { ids })),

  getContactCards: async () => {
    const result = await request<{ cards: ContactCard[] }>('/contact-cards');
    return result.cards ?? [];
  },
  createContactCard: async (data: ContactCardInput) => {
    const result = await request<{ card: ContactCard }>('/contact-cards', json('POST', data));
    return result.card;
  },
  updateContactCard: async (id: string, data: ContactCardInput) => {
    const result = await request<{ card: ContactCard }>(
      `/contact-cards/${encodeURIComponent(id)}`,
      json('PUT', data),
    );
    return result.card;
  },
  deleteContactCard: (id: string) =>
    request(`/contact-cards/${encodeURIComponent(id)}`, json('DELETE')),
  reorderContactCards: (ids: string[]) =>
    request<{ cards: ContactCard[] }>('/contact-cards/reorder', json('PUT', { ids })),
  createContactAction: async (cardId: string, data: ContactActionInput) => {
    const result = await request<{ action: ContactAction }>(
      `/contact-cards/${encodeURIComponent(cardId)}/actions`,
      json('POST', data),
    );
    return result.action;
  },
  updateContactAction: async (id: string, data: ContactActionInput) => {
    const result = await request<{ action: ContactAction }>(
      `/contact-actions/${encodeURIComponent(id)}`,
      json('PUT', data),
    );
    return result.action;
  },
  deleteContactAction: (id: string) =>
    request(`/contact-actions/${encodeURIComponent(id)}`, json('DELETE')),
  reorderContactActions: (cardId: string, ids: string[]) =>
    request<{ actions: ContactAction[] }>(
      `/contact-cards/${encodeURIComponent(cardId)}/actions/reorder`,
      json('PUT', { ids }),
    ),

  // --- Menu Management ---
  getAdminMenu: () => request<{ success: boolean; rawMenu: any; overrides: any }>('/menu'),
  syncIikoMenu: () =>
    request<{
      success: boolean;
      productsCount: number;
      categoriesCount: number;
      syncedAt: string;
    }>('/menu/sync', json('POST', {})),
  setProductOverride: (iikoProductId: string, overrides: Record<string, any>) =>
    request<{ success: boolean }>(
      '/menu/product/override',
      json('POST', { iikoProductId, overrides }),
    ),
  setCategoryOverride: (iikoCategoryId: string, overrides: Record<string, any>) =>
    request<{ success: boolean }>(
      '/menu/category/override',
      json('POST', { iikoCategoryId, overrides }),
    ),
  upsertCustomProduct: (product: Record<string, any>) =>
    request<{ success: boolean }>('/menu/custom-product', json('POST', product)),
  deleteCustomProduct: (id: string) =>
    request<{ success: boolean }>(`/menu/custom-product/${encodeURIComponent(id)}`, json('DELETE')),
  uploadMenuPhoto: async (file: File): Promise<{ success: boolean; imageUrl?: string }> => {
    const formData = new FormData();
    formData.append('image', file);
    const headers = new Headers();
    const selectedBranchId = getAdminBranchScope();
    if (selectedBranchId) headers.set('X-Bulka-Branch-Id', selectedBranchId);
    const response = await fetch(`${BASE_URL}/menu/upload-image`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'same-origin',
    });
    if (!response.ok) {
      const errorData = await parseResponse<ApiErrorPayload>(response).catch(
        (): ApiErrorPayload => ({}),
      );
      const requestId = errorData.requestId || responseRequestId(response) || undefined;
      throw new ApiError(
        adminApiErrorMessage(
          {
            ...errorData,
            error: errorData.error || 'Не удалось загрузить фото. Повторите попытку.',
            requestId,
          },
          response.status,
        ),
        response.status,
        errorData.code,
        errorData.details,
        requestId,
      );
    }
    return response.json();
  },
  translate: (text: string, targetLang: string) =>
    request<{ success: boolean; translated: string }>(
      '/translate',
      json('POST', { text, targetLang }),
    ),
  getProductOptions: (productId: string) =>
    request<{ success: boolean; products: Record<string, any> }>(
      `/menu/product-options?ids=${encodeURIComponent(productId)}`,
    ),
  saveProductOptions: (productId: string, data: Record<string, unknown>) =>
    request<{ success: boolean; options: any }>(
      `/menu/product-options/${encodeURIComponent(productId)}`,
      json('PUT', data),
    ),
};
