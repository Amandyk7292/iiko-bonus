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

export type ContactDisplayMode = 'standard' | 'compact';

export type ContactActionType =
  | 'phone'
  | 'whatsapp'
  | 'telegram'
  | 'instagram'
  | 'vk'
  | 'email'
  | 'website'
  | 'online_chat'
  | 'custom_url';

export interface ContactAction {
  id: string;
  cardId: string;
  type: ContactActionType;
  labels: LocalizedText;
  target: string;
  iconKey: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ContactCard {
  id: string;
  displayMode: ContactDisplayMode;
  titles: LocalizedText;
  iconKey: string;
  sortOrder: number;
  isActive: boolean;
  actions: ContactAction[];
}

export type ContactCardInput = Omit<ContactCard, 'id' | 'actions'>;
export type ContactActionInput = Omit<ContactAction, 'id' | 'cardId'>;

export interface OrderSubstitution {
  id: string;
  orderId: string;
  lineKey: string;
  productId: string;
  productName: string;
  quantity: number;
  action: 'remove_refund' | 'call_customer' | 'replace_with_approval';
  status:
    | 'pending'
    | 'processing'
    | 'contacting'
    | 'awaiting_customer'
    | 'approved'
    | 'rejected'
    | 'completed'
    | 'failed'
    | 'cancelled';
  replacementProductId?: string | null;
  replacementProductName?: string | null;
  note?: string | null;
  error?: string | null;
  refundId?: string | null;
  createdAt: string;
  updatedAt: string;
  respondedAt?: string | null;
  completedAt?: string | null;
}

export interface AdminOrder {
  id: string;
  number: number;
  paymentStatus: string;
  paymentProvider?: 'kaspi' | 'forte' | string;
  orderStatus: string;
  amount: number;
  subtotal: number;
  discount: number;
  branch: string;
  branchId?: string | null;
  orderType?: 'pickup' | 'preorder' | 'delivery' | string;
  deliveryStatus?: string;
  estimatedDeliveryAt?: string | null;
  trackingCode?: string | null;
  trackingUrl?: string | null;
  deliveryProvider?: 'bulka' | 'yandex' | string | null;
  providerDeliveryStatus?: string | null;
  providerDeliveryPrice?: number | null;
  customerArrivedAt?: string | null;
  courier?: {
    id: string;
    name: string;
    phone: string;
    vehicle?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    locationUpdatedAt?: string | null;
  } | null;
  pickupTime?: string | null;
  comment?: string | null;
  substitutionPreference?: 'remove_refund' | 'call_customer' | 'replace_with_approval' | string;
  substitutions?: OrderSubstitution[];
  items: Array<{ name?: string; quantity?: number; price?: number }>;
  earnedBonus: number;
  refundStatus?: string | null;
  refundAmount?: number | null;
  refundedAt?: string | null;
  refundError?: string | null;
  lastError?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { name?: string; phone?: string };
}

export interface InventoryItem {
  branch_id: string;
  product_id: string;
  product_name: string;
  source_quantity: number | null;
  manual_stop: boolean;
  preparation_minutes?: number | null;
  source: string;
  last_synced_at?: string | null;
  updated_at?: string | null;
  bulka_locations?: { name?: string; address?: string } | null;
}

export interface Courier {
  id: string;
  name: string;
  phone: string;
  vehicle?: string | null;
  active: boolean;
  latitude?: number | null;
  longitude?: number | null;
  locationUpdatedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  accessUrl?: string | null;
  availabilityStatus?: string;
  maxActiveOrders?: number;
  activeSessions?: number;
  lastLoginAt?: string | null;
}

export interface CourierActivity {
  id: string;
  orderId?: string | null;
  type: string;
  latitude?: number | null;
  longitude?: number | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface DeliveryProof {
  id: string;
  orderId: string;
  courierId: string;
  courier?: { name?: string; phone?: string } | null;
  pinVerified: boolean;
  latitude?: number | null;
  longitude?: number | null;
  createdAt: string;
  photoUrl: string;
  photoExpiresIn: number;
}

export interface ExternalDelivery {
  id: string;
  provider: 'yandex';
  claimId?: string | null;
  status: string;
  statusLabel: string;
  deliveryStatus: string;
  quotedPrice?: number | null;
  price?: number | null;
  currency: string;
  etaMinutes?: number | null;
  distanceMeters?: number | null;
  trackingUrl?: string | null;
  courier?: { name: string; phone?: string; vehicle?: string | null } | null;
  canCancel: boolean;
  terminal: boolean;
  lastError?: string | null;
  lastSyncedAt?: string | null;
}

export interface DispatchOrder {
  id: string;
  number: number;
  amount: number;
  branchId?: string | null;
  branchName?: string;
  branchLatitude?: number | null;
  branchLongitude?: number | null;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
  deliveryAddress?: string | null;
  courierId?: string | null;
  deliveryStatus?: string;
  routeDistanceKm?: number | null;
  routeEtaMinutes?: number | null;
  externalDelivery?: ExternalDelivery | null;
}

export interface YandexDeliveryConfiguration {
  enabled: boolean;
  configured: boolean;
  canManage: boolean;
  missing: string[];
  taxiClass: string;
}

export interface AdminUser {
  username: string;
  role: string;
  branchIds?: string[];
  actions?: string[];
}

export interface AdminScopeLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  active: boolean;
}

export interface AdminLocationCity {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  branchCount: number;
}

export interface OperationsSummary {
  updatedAt: string;
  capabilities: {
    orders: boolean;
    kitchen: boolean;
    dispatch: boolean;
    support: boolean;
    whatsapp: boolean;
    inventory: boolean;
  };
  counts: {
    newOrders: number;
    activeOrders: number;
    kitchenOverdue: number;
    deliveryAttention: number;
    paymentIssues: number;
    supportNew: number;
    supportOverdue: number;
    supportMine: number;
    whatsappUnread: number;
    whatsappDialogs: number;
    stoppedProducts: number;
  };
  orders: Array<{
    id: string;
    number: number;
    amount: number;
    branchId: string | null;
    branch: string;
    paymentStatus: string;
    orderStatus: string;
    kitchenStatus: string | null;
    deliveryStatus: string | null;
    promisedReadyAt: string | null;
    createdAt: string;
    lastError: string | null;
  }>;
  support: Array<{
    id: string;
    category: string;
    status: string;
    priority: string;
    assignedTo: string | null;
    dueAt: string | null;
    lastMessageAt: string;
    createdAt: string;
    orderNumber: number | null;
    branchId: string | null;
    branch: string;
    customer: { name?: string; phone?: string } | null;
    preview: string;
  }>;
  whatsapp: Array<{
    id: string;
    displayName: string;
    phone: string;
    unreadCount: number;
    preview: string;
    lastMessageAt: string | null;
  }>;
}

export interface IntegrationHealthService {
  id: string;
  name: string;
  state: 'healthy' | 'attention' | 'error' | 'disabled';
  summary: string;
  detail: string;
  updatedAt: string | null;
}

export interface SupportRequest {
  id: string;
  orderId: string | null;
  orderNumber: number | null;
  branchId: string | null;
  branch: string;
  customer: { name?: string; phone?: string } | null;
  category: string;
  message: string;
  preview: string;
  status: 'new' | 'in_review' | 'resolved' | 'rejected';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  refundRequested: boolean;
  attachments: Array<{ path: string; url: string | null }>;
  resolution: string | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  dueAt: string | null;
  firstRespondedAt: string | null;
  lastMessageAt: string;
  overdue: boolean;
}

export interface SupportMessage {
  id: string;
  requestId: string;
  senderType: 'customer' | 'admin' | 'system';
  senderId: string | null;
  body: string;
  attachments: Array<{ path: string; url: string | null }>;
  internal: boolean;
  createdAt: string;
}

export interface AdminPhoneLoginChallenge {
  success: boolean;
  accepted: boolean;
  expiresIn: number;
  whatsappPhone?: string | null;
  whatsappUrl?: string | null;
}

export interface WhatsAppAssistantSettings {
  assistantEnabled: boolean;
  autoReplyEnabled: boolean;
  memoryEnabled: boolean;
  provider: 'gemini' | 'qwen' | 'deepseek';
  model: string;
  keyConfigured: boolean;
  providerKeys: Record<'gemini' | 'qwen' | 'deepseek', boolean>;
  botName: string;
  tone: 'friendly' | 'warm' | 'concise' | 'formal';
  supportedLanguages: Array<'ru' | 'kk' | 'en'>;
  historyMessages: number;
  businessDescription: string;
  customInstructions: string;
  welcomeMessage: string;
  fallbackMessage: string;
  storageReady: boolean;
  updatedAt: string | null;
}

export interface WhatsAppConnectionStatus {
  state:
    | 'starting'
    | 'connecting'
    | 'awaiting_scan'
    | 'connected'
    | 'reconnecting'
    | 'logged_out'
    | 'error';
  connected: boolean;
  connectedAt: string | null;
  updatedAt: string;
  phone: string;
  qrDataUrl: string;
  qrReceivedAt: string | null;
  lastError: string;
  assistant: {
    environmentEnabled: boolean;
    provider: 'gemini' | 'qwen' | 'deepseek';
    keyConfigured: boolean;
    model: string;
  };
}

export interface WhatsAppConversation {
  id: string;
  chatJid: string;
  phone: string;
  displayName: string;
  status: 'open' | 'closed' | 'spam';
  assistantEnabled: boolean;
  contextResetAt: string | null;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageAt: string | null;
  lastCustomerMessageAt: string | null;
  lastOperatorMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppMessage {
  id: string;
  conversationId: string;
  whatsappMessageId: string | null;
  outboxId: string | null;
  direction: 'inbound' | 'outbound';
  senderType: 'customer' | 'assistant' | 'operator' | 'system';
  content: string;
  deliveryStatus: 'received' | 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  createdAt: string;
}

export interface WhatsAppMemory {
  id: string;
  conversationId: string;
  label: string;
  content: string;
  sourceType: 'manual' | 'message' | 'assistant';
  sourceMessageId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppKnowledgeDocument {
  id: string;
  title: string;
  category: string;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SecurityStatus {
  user: { username: string; role: string };
  multiAdmin: boolean;
  configuredUsers: Array<{ username: string; role: string; mfa: boolean }>;
  mfaRequired: boolean;
  legacySingleAdmin: boolean;
}

export interface SiteAccessConfig {
  enabled: boolean;
  allowedIps: string[];
}

export interface SiteAccessResponse {
  success: boolean;
  config: SiteAccessConfig;
  currentIp: string;
}

export interface AuditLog {
  id: string;
  admin_username?: string | null;
  admin_role?: string | null;
  method: string;
  path: string;
  status_code?: number | null;
  ip?: string | null;
  user_agent?: string | null;
  created_at: string;
}
