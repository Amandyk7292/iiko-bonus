export interface LocalizedText {
  ru: string;
  kk: string;
  en: string;
}

export type TaplinkLocale = 'kk' | 'ru';
export type TaplinkLocalizedText = Record<TaplinkLocale, string>;
export type TaplinkButtonStyle = 'soft' | 'outlined' | 'solid';
export type TaplinkBackgroundMode = 'brand' | 'solid' | 'gradient' | 'image';
export type TaplinkGradientDirection =
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left'
  | 'top-left';
export type TaplinkAnimation = 'none' | 'fade' | 'rise' | 'stagger';
export type TaplinkButtonEffect = 'none' | 'lift' | 'glow' | 'shine';
export type TaplinkLinkStyle = 'primary' | 'standard' | 'city';
export type TaplinkIcon =
  'phone' | 'whatsapp' | '2gis' | 'instagram' | 'telegram' | 'globe' | 'location' | 'none';

export type TaplinkTarget =
  | { type: 'whatsapp'; value: string }
  | { type: 'phone'; value: string }
  | { type: 'email'; value: string }
  | { type: 'url'; value: string };

export interface TaplinkSectionBlock {
  id: string;
  type: 'section';
  enabled: boolean;
  labels: TaplinkLocalizedText;
}

export interface TaplinkLinkBlock {
  id: string;
  type: 'link';
  enabled: boolean;
  style: TaplinkLinkStyle;
  labels: TaplinkLocalizedText;
  subtitles?: TaplinkLocalizedText;
  ariaLabels?: TaplinkLocalizedText;
  icon: TaplinkIcon;
  target: TaplinkTarget;
  href?: string;
}

export type TaplinkBlock = TaplinkSectionBlock | TaplinkLinkBlock;

export interface TaplinkDocument {
  schemaVersion: 1;
  defaultLocale: TaplinkLocale;
  enabledLocales: TaplinkLocale[];
  profile: {
    title: TaplinkLocalizedText;
    description: TaplinkLocalizedText;
    footer: TaplinkLocalizedText;
    logoUrl?: string;
  };
  seo: {
    title: TaplinkLocalizedText;
    description: TaplinkLocalizedText;
    ogImageUrl?: string;
  };
  theme: {
    preset: 'bulka';
    backgroundMode: TaplinkBackgroundMode;
    backgroundColor: string;
    gradientFrom: string;
    gradientTo: string;
    gradientDirection: TaplinkGradientDirection;
    backgroundImageUrl?: string;
    backgroundOverlayColor: string;
    backgroundOverlayOpacity: number;
    textColor: string;
    mutedTextColor: string;
    surfaceColor: string;
    buttonBackgroundColor: string;
    buttonTextColor: string;
    primaryButtonBackgroundColor: string;
    primaryButtonTextColor: string;
    buttonStyle: TaplinkButtonStyle;
    animation: TaplinkAnimation;
    buttonEffect: TaplinkButtonEffect;
    radius: number;
  };
  blocks: TaplinkBlock[];
}

export interface TaplinkAdminPage {
  slug: 'main' | string;
  draft: TaplinkDocument;
  published: TaplinkDocument;
  draftRevision: number;
  publishedRevision: number;
  updatedAt: string | null;
  updatedBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
}

export interface TaplinkAdminResponse {
  success: boolean;
  page: TaplinkAdminPage;
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
  kitchenStatus?: string;
  courierDispatchStatus?: string | null;
  courierDispatchProvider?: string | null;
  courierDispatchRequestedAt?: string | null;
  courierDispatchError?: string | null;
  iikoSyncStatus?: string | null;
  iikoSyncError?: string | null;
  iikoDeliveryStatus?: string | null;
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
    transportType?: string | null;
    isAutomobile?: boolean | null;
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

export interface PartialRefundLine {
  lineKey: string;
  productId: string;
  name: string;
  quantity: number;
  unitAmount: number;
  refundableQuantity: number;
  refundedQuantity: number;
  refundedAmount: number;
  imageUrl?: string | null;
  configuration?: unknown;
  modifiers?: unknown[];
}

export interface PartialRefundAdjustment {
  spentBonusRestored: number;
  earnedBonusReversed: number;
}

export interface PartialRefundPreview {
  amount: number;
  remainingAfter: number;
  currency: 'KZT';
  items: Array<{
    lineKey: string;
    quantity: number;
    amount: number;
  }>;
  adjustment: PartialRefundAdjustment;
}

export interface PartialRefundOptions {
  orderId: string;
  orderNumber: number;
  paidAmount: number;
  alreadyRefunded: number;
  remainingAmount: number;
  deliveryFee: number;
  deliveryFeeRefunded: boolean;
  lines: PartialRefundLine[];
  /**
   * Set by the server after POST /orders/:id/partial-refund-preview is available.
   * The admin client must never derive the payable/refundable amount itself.
   */
  previewSupported?: boolean;
}

export interface PartialRefundResult {
  id: string;
  orderId: string;
  amount: number;
  status: string;
  reference?: string | null;
  adjustment?: PartialRefundAdjustment | null;
  items?: Array<{
    line_key: string;
    product_id: string;
    product_name: string;
    quantity: number;
    unit_amount: number;
    refund_amount: number;
  }>;
}

export interface Courier {
  id: string;
  name: string;
  phone: string;
  vehicle?: string | null;
  transportType?: 'car' | 'motorcycle' | 'bicycle' | 'foot';
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
  courier?: {
    name: string;
    phone?: string;
    vehicle?: string | null;
    transportType?: string | null;
    isAutomobile?: boolean | null;
  } | null;
  automobileRequired?: boolean;
  transportWarning?: string | null;
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
  kitchenStatus?: string;
  courierDispatchStatus?: string | null;
  courierDispatchProvider?: string | null;
  courierDispatchRequestedAt?: string | null;
  courierDispatchError?: string | null;
  iikoSyncStatus?: string | null;
  iikoSyncError?: string | null;
  iikoDeliveryStatus?: string | null;
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
  cargoOptions?: string[];
  automobileOnly?: boolean;
  thermobagRequired?: boolean;
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

export interface BranchPosCredentialStatus {
  branchId: string;
  branchName: string | null;
  branchActive: boolean;
  configured: boolean;
  version: number | null;
  rotatedBy: string | null;
  rotatedAt: string | null;
}

export interface BranchPosCredentialSecret {
  branchId: string;
  token: string;
  version: number;
  rotatedAt: string;
  headers: {
    branch: string;
    token: string;
  };
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

export type AdminGlobalEntityType = 'order' | 'customer' | 'support';

export interface AdminGlobalSearchResult {
  type: AdminGlobalEntityType;
  id: string;
  title: string;
  subtitle?: string | null;
  status?: string | null;
  branch?: string | null;
  updatedAt?: string | null;
}

export interface AdminGlobalTimelineEvent {
  id: string;
  kind: 'order' | 'payment' | 'refund' | 'support' | 'audit' | 'customer' | string;
  title: string;
  description?: string | null;
  status?: string | null;
  occurredAt: string;
  actor?: string | null;
  requestId?: string | null;
}

export interface AdminGlobalCustomerProfile {
  id: string;
  name?: string | null;
  phone?: string | null;
  balance?: number | null;
  totalSpent?: number | null;
}

export interface AdminGlobalSupportSummary {
  id: string;
  customerId?: string | null;
  orderId?: string | null;
  orderNumber?: number | null;
  branch?: string | null;
  category?: string | null;
  message?: string | null;
  status?: string | null;
  priority?: string | null;
  refundRequested?: boolean;
  resolution?: string | null;
  assignedTo?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  resolvedAt?: string | null;
  dueAt?: string | null;
}

export interface AdminGlobalDetail {
  type: AdminGlobalEntityType;
  id: string;
  title: string;
  subtitle?: string | null;
  status?: string | null;
  branch?: string | null;
  customer?: { id?: string | null; name?: string | null; phone?: string | null } | null;
  order?: AdminOrder | null;
  customerProfile?: AdminGlobalCustomerProfile | null;
  support?: AdminGlobalSupportSummary | null;
  timeline: AdminGlobalTimelineEvent[];
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

export interface OnlineOrderingConfig {
  disabled: boolean;
}

export interface OnlineOrderingResponse {
  success: boolean;
  config: OnlineOrderingConfig;
}

export interface AuditLog {
  id: string;
  admin_subject?: string | null;
  admin_username?: string | null;
  admin_role?: string | null;
  action?: string | null;
  action_code?: string | null;
  method: string;
  path: string;
  status_code?: number | null;
  outcome?: 'success' | 'rejected' | 'server_error' | string | null;
  request_id?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  branch_id?: string | null;
  reason?: string | null;
  amount_change?: number | null;
  context?: Record<string, unknown> | null;
  ip_hash?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  created_at: string;
}
