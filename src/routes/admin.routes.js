const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const multer = require('multer');
const adminController = require('../controllers/admin.controller');
const tierController = require('../controllers/tier.controller');
const orderController = require('../controllers/order.controller');
const {
  adminAuditMiddleware,
  adminAuthMiddleware,
  adminCsrfMiddleware,
  adminMutationRoleMiddleware,
  ROLE_AREAS,
} = require('../middlewares/auth.middleware');
const { adminRateLimit } = require('../middlewares/rate-limit.middleware');
const menuService = require('../services/menu.service');
const iikoApi = require('../services/iiko.service');
const {
  createBulkaCity,
  createBulkaLocation,
  getBulkaCities,
  getBulkaLocations,
  updateActiveLocationDeliveryZones,
  updateBulkaLocation,
} = require('../services/location.service');
const { supabase } = require('../config/supabase');
const realtime = require('../services/realtime.service');
const {
  listInventory,
  syncAllBranchInventory,
  updateInventory,
} = require('../services/inventory.service');
const {
  assignCourier,
  getDeliveryProof,
  listCourierActivity,
  listCouriers,
  revokeCourierSessions,
  saveCourier,
  setCourierActive,
  updateDeliveryStatus,
} = require('../services/courier.service');
const { normalizeOrder } = require('../services/customer-order.service');
const { getProductOptions, saveProductOptions } = require('../services/product-options.service');
const { createPartialRefund, getRefundOptions } = require('../services/partial-refund.service');
const dispatchService = require('../services/dispatch.service');
const yandexDelivery = require('../services/yandex-delivery.service');
const kitchenService = require('../services/kitchen.service');
const reviewService = require('../services/review.service');
const supportService = require('../services/support.service');
const commerceMarketing = require('../services/commerce-marketing.service');
const { ADMIN_PHONE_ROLES } = require('../services/admin-phone-auth.service');
const {
  branchScopeForAdmin,
  hasGlobalBranchAccess,
  normalizeBranchIds,
} = require('../utils/admin-scope.util');
const { normalizeKazakhstanPhone } = require('../utils/phone.util');
const { optimizeUploadedImage } = require('../utils/image.util');
const { registerCustomerAdminRoutes } = require('./admin/customer.routes');
const { registerContactCenterAdminRoutes } = require('./admin/contact-center.routes');
const { registerAdminAuthRoutes } = require('./admin/auth.routes');
const {
  getSiteAccessConfig,
  normalizeIpAddress,
  updateSiteAccessConfig,
} = require('../services/site-access.service');
const {
  createConversationMemory,
  createKnowledgeDocument,
  deleteConversationMemory,
  deleteKnowledgeDocument,
  getAssistantSettings,
  getConversationDetail,
  listConversations,
  listKnowledgeDocuments,
  readConversation,
  recordConversationMessage,
  updateAssistantSettings,
  updateConversation,
  updateKnowledgeDocument,
} = require('../services/whatsapp-assistant-console.service');
const {
  getWhatsAppStatus,
  sendWhatsAppChatMessage,
  sendWhatsAppVoiceMessage,
} = require('../services/whatsapp-baileys.service');
const { whatsappOutboxDedupeKey } = require('../services/whatsapp-outbox.service');
const {
  MAX_VOICE_NOTE_BYTES,
  normalizeVoiceNoteDuration,
  validateVoiceNoteUpload,
} = require('../services/voice-note.service');
const { getOperationsSummary } = require('../services/operations-dashboard.service');
const { getIntegrationHealth } = require('../services/integration-health.service');

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) =>
    callback(null, allowedImageTypes.has(String(file.mimetype).toLowerCase())),
});

const allowedVoiceTypes = new Set([
  'audio/webm',
  'audio/ogg',
  'application/ogg',
  'audio/mp4',
  'audio/x-m4a',
]);
const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VOICE_NOTE_BYTES, files: 1, fields: 2 },
  fileFilter: (_req, file, callback) => {
    const mimeType = String(file.mimetype || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (allowedVoiceTypes.has(mimeType)) return callback(null, true);
    return callback(
      Object.assign(new Error('Поддерживаются голосовые WebM, OGG и M4A'), {
        statusCode: 415,
        code: 'WHATSAPP_INVALID_AUDIO',
      }),
    );
  },
});

const parseWhatsAppVoiceUpload = (req, res, next) => {
  voiceUpload.single('audio')(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : error.statusCode || 400).json({
      success: false,
      error: tooLarge ? 'Голосовое должно быть не больше 8 МБ' : error.message,
      code: tooLarge ? 'WHATSAPP_AUDIO_TOO_LARGE' : error.code || 'WHATSAPP_INVALID_AUDIO',
    });
  });
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalizeAccessBranchIds = (value) => {
  if (value !== undefined && !Array.isArray(value)) return null;
  const branchIds = normalizeBranchIds(value);
  if (branchIds.length > 50 || branchIds.some((branchId) => !uuidPattern.test(branchId))) {
    return null;
  }
  return branchIds;
};

const detectImageType = (buffer) => {
  if (buffer?.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (
    buffer?.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (
    buffer?.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer?.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', extension: 'webp' };
  }
  return null;
};

const scopedBranchIds = (req) => branchScopeForAdmin(req.admin);

const assertBranchAccess = (req, branchId) => {
  const allowed = scopedBranchIds(req);
  if (allowed.length && !allowed.includes(String(branchId || ''))) {
    throw Object.assign(new Error('Филиал не входит в область доступа'), { statusCode: 403 });
  }
};

const assertLocationStructureAccess = (req) => {
  if (!['owner', 'admin'].includes(String(req.admin?.role || ''))) {
    throw Object.assign(new Error('Создавать города и филиалы могут только owner и admin'), {
      statusCode: 403,
    });
  }
};

const assertOrderAccess = async (req, orderId) => {
  const allowed = scopedBranchIds(req);
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('id,branch_id,customer_id')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data || (allowed.length && !allowed.includes(String(data.branch_id || '')))) {
    throw Object.assign(new Error('Заказ не найден'), { statusCode: 404 });
  }
  return data;
};

const canManageYandexDispatch = (req) =>
  ['admin', 'owner', 'branch_manager', 'operator'].includes(req.admin.role);

const assertYandexDispatchMutationAccess = (req) => {
  if (!canManageYandexDispatch(req)) {
    throw Object.assign(new Error('Недостаточно прав для заказа Яндекс.Доставки'), {
      statusCode: 403,
    });
  }
};

const assertReviewAccess = async (req, reviewId) => {
  const allowed = scopedBranchIds(req);
  if (!allowed.length) return;
  const { data, error } = await supabase
    .from('order_reviews')
    .select('kaspi_orders!inner(branch_id)')
    .eq('id', reviewId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !allowed.includes(String(data.kaspi_orders?.branch_id || ''))) {
    throw Object.assign(new Error('Отзыв не найден'), { statusCode: 404 });
  }
};

const assertSupportAccess = async (req, requestId) => {
  const allowed = scopedBranchIds(req);
  if (!allowed.length) return;
  const { data, error } = await supabase
    .from('customer_support_requests')
    .select('kaspi_orders!inner(branch_id)')
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !allowed.includes(String(data.kaspi_orders?.branch_id || ''))) {
    throw Object.assign(new Error('Обращение не найдено'), { statusCode: 404 });
  }
};

const validateUploadedImage = (req, res, next) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Выберите изображение' });
  const detected = detectImageType(req.file.buffer);
  if (!detected || detected.mime !== req.file.mimetype) {
    return res.status(400).json({ success: false, error: 'Допустимы JPEG, PNG и WebP до 5 МБ' });
  }
  req.detectedImageType = detected;
  return next();
};

const requireWhatsAppConfigurationRole = (req, res, next) => {
  if (!['admin', 'owner'].includes(req.admin?.role)) {
    return res.status(403).json({
      success: false,
      error: 'Настройки ассистента доступны только владельцу и администратору',
    });
  }
  return next();
};

const rejectWhatsAppOperatorConfiguration = (req, res, next) => {
  if (req.admin?.role === 'whatsapp_operator') {
    return res.status(403).json({
      success: false,
      error: 'Ссылка оператора даёт доступ только к перепискам и ответам',
      code: 'WHATSAPP_OPERATOR_SCOPE',
    });
  }
  return next();
};

const restrictWhatsAppOperatorConversationUpdate = (req, res, next) => {
  if (req.admin?.role !== 'whatsapp_operator') return next();
  const allowedFields = new Set(['status', 'markRead']);
  const requestedFields = Object.keys(req.body || {});
  if (requestedFields.some((field) => !allowedFields.has(field))) {
    return res.status(403).json({
      success: false,
      error: 'Оператор может только читать, отвечать и менять статус диалога',
      code: 'WHATSAPP_OPERATOR_SCOPE',
    });
  }
  return next();
};

const whatsappErrorResponse = (res, error) =>
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message,
    code: error.code || 'WHATSAPP_CONSOLE_ERROR',
  });

const voiceDurationLabel = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

router.use('/admin/api', adminRateLimit);
registerAdminAuthRoutes(router, {
  auth: adminAuthMiddleware,
  audit: adminAuditMiddleware,
});
router.use(
  '/admin/api',
  adminAuthMiddleware,
  adminCsrfMiddleware,
  adminMutationRoleMiddleware,
  adminAuditMiddleware,
);

router.get('/admin/api/settings', adminAuthMiddleware, adminController.getSettingsHandler);
router.get('/admin/api/scope', async (req, res) => {
  try {
    const locations = await getBulkaLocations({ includeInactive: true });
    const assigned = hasGlobalBranchAccess(req.admin)
      ? locations
      : locations.filter((location) =>
          normalizeBranchIds(req.admin?.branchIds).includes(String(location.id)),
        );
    res.json({
      success: true,
      locations: assigned.map((location) => ({
        id: location.id,
        name: location.name,
        address: location.address,
        city: location.city,
        active: location.active,
      })),
      selectedBranchId: req.admin?.selectedBranchId || null,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/admin/api/events', (req, res) =>
  realtime.openStream(req, res, {
    admin: true,
    role: req.admin?.role,
    areas: [...(ROLE_AREAS[req.admin?.role] || [])],
    branchIds: hasGlobalBranchAccess(req.admin) ? [] : normalizeBranchIds(req.admin?.branchIds),
    selectedBranchId: req.admin?.selectedBranchId || null,
    globalBranchAccess: hasGlobalBranchAccess(req.admin),
  }),
);
router.get('/admin/api/operations/summary', async (req, res) => {
  try {
    const areas = ROLE_AREAS[req.admin?.role] || new Set();
    const canRead = (area) => areas.has('*') || areas.has(area);
    res.json({
      success: true,
      ...(await getOperationsSummary({
        branchIds: scopedBranchIds(req),
        includeOrders: canRead('orders'),
        includeKitchen: canRead('kitchen'),
        includeDispatch: canRead('dispatch'),
        includeSupport: canRead('support'),
        includeWhatsApp: canRead('whatsapp'),
        includeInventory: canRead('inventory'),
        assignedTo: req.admin?.sub || '',
      })),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/admin/api/integrations/status', async (_req, res) => {
  try {
    res.json({ success: true, ...(await getIntegrationHealth()) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/admin/api/whatsapp/status', async (req, res) => {
  try {
    const settings = await getAssistantSettings({ allowFallback: true });
    const connection = getWhatsAppStatus(settings);
    if (!['admin', 'owner'].includes(req.admin?.role)) connection.qrDataUrl = '';
    res.json({
      success: true,
      connection,
      settings: req.admin?.role === 'whatsapp_operator' ? null : settings,
    });
  } catch (error) {
    whatsappErrorResponse(res, error);
  }
});
router.get(
  '/admin/api/whatsapp/settings',
  rejectWhatsAppOperatorConfiguration,
  async (_req, res) => {
    try {
      const settings = await getAssistantSettings({ allowFallback: true });
      res.json({ success: true, settings });
    } catch (error) {
      whatsappErrorResponse(res, error);
    }
  },
);
router.put('/admin/api/whatsapp/settings', requireWhatsAppConfigurationRole, async (req, res) => {
  try {
    const settings = await updateAssistantSettings(req.body, {
      updatedBy: req.admin?.sub || '',
    });
    res.json({ success: true, settings });
  } catch (error) {
    whatsappErrorResponse(res, error);
  }
});
router.get('/admin/api/whatsapp/conversations', async (req, res) => {
  try {
    const result = await listConversations({
      search: req.query.search,
      status: req.query.status,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    whatsappErrorResponse(res, error);
  }
});
router.get('/admin/api/whatsapp/conversations/:id', async (req, res) => {
  try {
    const detail = await getConversationDetail(req.params.id);
    if (req.admin?.role === 'whatsapp_operator') detail.memories = [];
    res.json({ success: true, ...detail });
  } catch (error) {
    whatsappErrorResponse(res, error);
  }
});
router.patch(
  '/admin/api/whatsapp/conversations/:id',
  restrictWhatsAppOperatorConversationUpdate,
  async (req, res) => {
    try {
      const conversation = await updateConversation(req.params.id, req.body);
      res.json({ success: true, conversation });
    } catch (error) {
      whatsappErrorResponse(res, error);
    }
  },
);
router.post('/admin/api/whatsapp/conversations/:id/messages', async (req, res) => {
  try {
    const conversation = await readConversation(req.params.id);
    const text = String(req.body?.text || '').trim();
    const clientMessageId = String(
      req.body?.clientMessageId || req.get('Idempotency-Key') || crypto.randomUUID(),
    ).slice(0, 128);
    const sent = await sendWhatsAppChatMessage(conversation.chatJid, text, {
      dedupeKey: whatsappOutboxDedupeKey('operator-text', conversation.id, clientMessageId),
      sourceType: 'operator',
      metadata: { admin: req.admin?.sub || '', clientMessageId },
    });
    const message = await recordConversationMessage({
      chatJid: conversation.chatJid,
      phone: conversation.phone,
      displayName: conversation.displayName,
      whatsappMessageId: sent?.key?.id || null,
      outboxId: sent.outboxId,
      direction: 'outbound',
      senderType: 'operator',
      content: text,
      deliveryStatus: sent.deliveryStatus,
      metadata: { admin: req.admin?.sub || '', clientMessageId },
    });
    const updatedConversation = await updateConversation(conversation.id, {
      assistantEnabled: false,
      markRead: true,
      status: 'open',
    });
    res.json({
      success: true,
      message,
      conversation: updatedConversation,
      queued: sent.queued,
    });
  } catch (error) {
    whatsappErrorResponse(res, error);
  }
});
router.post(
  '/admin/api/whatsapp/conversations/:id/voice',
  parseWhatsAppVoiceUpload,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'Запишите голосовое перед отправкой',
          code: 'WHATSAPP_AUDIO_REQUIRED',
        });
      }
      validateVoiceNoteUpload(req.file.buffer, req.file.mimetype);
      const durationSeconds = normalizeVoiceNoteDuration(req.body?.durationSeconds);
      const conversation = await readConversation(req.params.id);
      const clientMessageId = String(
        req.body?.clientMessageId || req.get('Idempotency-Key') || crypto.randomUUID(),
      ).slice(0, 128);
      const sent = await sendWhatsAppVoiceMessage(conversation.chatJid, req.file.buffer, {
        declaredMimeType: req.file.mimetype,
        durationSeconds,
        dedupeKey: whatsappOutboxDedupeKey('operator-voice', conversation.id, clientMessageId),
        sourceType: 'operator',
        metadata: { admin: req.admin?.sub || '', clientMessageId },
      });
      const content = `Голосовое сообщение · ${voiceDurationLabel(durationSeconds)}`;
      const message = await recordConversationMessage({
        chatJid: conversation.chatJid,
        phone: conversation.phone,
        displayName: conversation.displayName,
        whatsappMessageId: sent?.key?.id || null,
        outboxId: sent.outboxId,
        direction: 'outbound',
        senderType: 'operator',
        content,
        deliveryStatus: sent.deliveryStatus,
        metadata: {
          admin: req.admin?.sub || '',
          clientMessageId,
          kind: 'voice',
          durationSeconds,
          mimetype: 'audio/ogg; codecs=opus',
        },
      });
      const updatedConversation = await updateConversation(conversation.id, {
        assistantEnabled: false,
        markRead: true,
        status: 'open',
      });
      return res.json({
        success: true,
        message,
        conversation: updatedConversation,
        queued: sent.queued,
      });
    } catch (error) {
      return whatsappErrorResponse(res, error);
    }
  },
);
router.post(
  '/admin/api/whatsapp/conversations/:id/memories',
  rejectWhatsAppOperatorConfiguration,
  async (req, res) => {
    try {
      const memory = await createConversationMemory(req.params.id, req.body, {
        createdBy: req.admin?.sub || '',
      });
      res.json({ success: true, memory });
    } catch (error) {
      whatsappErrorResponse(res, error);
    }
  },
);
router.delete(
  '/admin/api/whatsapp/conversations/:id/memories/:memoryId',
  rejectWhatsAppOperatorConfiguration,
  async (req, res) => {
    try {
      await deleteConversationMemory(req.params.id, req.params.memoryId);
      res.json({ success: true });
    } catch (error) {
      whatsappErrorResponse(res, error);
    }
  },
);
router.get(
  '/admin/api/whatsapp/knowledge',
  rejectWhatsAppOperatorConfiguration,
  async (_req, res) => {
    try {
      const documents = await listKnowledgeDocuments();
      res.json({ success: true, documents });
    } catch (error) {
      whatsappErrorResponse(res, error);
    }
  },
);
router.post('/admin/api/whatsapp/knowledge', requireWhatsAppConfigurationRole, async (req, res) => {
  try {
    const document = await createKnowledgeDocument(req.body, {
      createdBy: req.admin?.sub || '',
    });
    res.json({ success: true, document });
  } catch (error) {
    whatsappErrorResponse(res, error);
  }
});
router.put(
  '/admin/api/whatsapp/knowledge/:id',
  requireWhatsAppConfigurationRole,
  async (req, res) => {
    try {
      const document = await updateKnowledgeDocument(req.params.id, req.body, {
        updatedBy: req.admin?.sub || '',
      });
      res.json({ success: true, document });
    } catch (error) {
      whatsappErrorResponse(res, error);
    }
  },
);
router.delete(
  '/admin/api/whatsapp/knowledge/:id',
  requireWhatsAppConfigurationRole,
  async (req, res) => {
    try {
      await deleteKnowledgeDocument(req.params.id);
      res.json({ success: true });
    } catch (error) {
      whatsappErrorResponse(res, error);
    }
  },
);
router.get('/admin/api/security/status', (req, res) => {
  let users;
  try {
    users = process.env.ADMIN_USERS_JSON ? JSON.parse(process.env.ADMIN_USERS_JSON) : [];
  } catch {
    users = [];
  }
  res.json({
    success: true,
    user: { username: req.admin.sub, role: req.admin.role },
    multiAdmin: Array.isArray(users) && users.length > 1,
    configuredUsers:
      Array.isArray(users) && users.length
        ? users.map((user) => ({
            username: user.username,
            role: user.role,
            mfa: Boolean(user.totpSecret),
          }))
        : [
            {
              username: 'admin',
              role: req.admin.role,
              mfa: Boolean(process.env.ADMIN_TOTP_SECRET),
            },
          ],
    mfaRequired: process.env.ADMIN_REQUIRE_MFA === 'true',
    legacySingleAdmin: !process.env.ADMIN_USERS_JSON,
  });
});
router.get('/admin/api/site-access', async (req, res) => {
  try {
    const config = await getSiteAccessConfig({ forceRefresh: true });
    return res.json({
      success: true,
      config,
      currentIp: normalizeIpAddress(req.ip) || '',
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      ...(error.code && { code: error.code }),
    });
  }
});
router.put('/admin/api/site-access', async (req, res) => {
  try {
    const config = await updateSiteAccessConfig(req.body);
    return res.json({
      success: true,
      config,
      currentIp: normalizeIpAddress(req.ip) || '',
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      ...(error.code && { code: error.code }),
    });
  }
});
router.get('/admin/api/audit-logs', async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(req.query.pageSize, 10) || 50));
  const from = (page - 1) * pageSize;
  const { data, error, count } = await supabase
    .from('admin_audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, logs: data || [], total: count || 0, page, pageSize });
});
router.post('/admin/api/settings', adminAuthMiddleware, adminController.updateSettingsHandler);

registerContactCenterAdminRoutes(router);

router.get('/admin/api/loyalty-tiers', adminAuthMiddleware, tierController.listAdminTiers);
router.post('/admin/api/loyalty-tiers', adminAuthMiddleware, tierController.createAdminTier);
router.put(
  '/admin/api/loyalty-tiers/reorder',
  adminAuthMiddleware,
  tierController.reorderAdminTiers,
);

// --- MENU ADMIN ROUTES ---

// Получить сырое меню + оверрайды (для админки)
router.get('/admin/api/menu', adminAuthMiddleware, async (req, res) => {
  try {
    const rawMenu = await iikoApi.getMenu();
    const [productOverrides, categoryOverrides, customProducts] = await Promise.all([
      menuService.getProductOverrides(),
      menuService.getCategoryOverrides(),
      menuService.getCustomProducts(),
    ]);

    res.json({
      success: true,
      rawMenu,
      overrides: {
        products: productOverrides,
        categories: categoryOverrides,
        customProducts: customProducts,
      },
    });
  } catch (error) {
    console.error('Ошибка в /admin/api/menu:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Принудительно получить свежую номенклатуру из iiko, минуя двухчасовой кэш.
router.post('/admin/api/menu/sync', adminAuthMiddleware, async (req, res) => {
  try {
    iikoApi.invalidateMenuCache();
    const rawMenu = await iikoApi.getMenu({ strict: true });
    const productsCount = Array.isArray(rawMenu?.products) ? rawMenu.products.length : 0;
    const categoriesCount = Array.isArray(rawMenu?.groups) ? rawMenu.groups.length : 0;
    const syncedAt = new Date().toISOString();

    realtime.publish(
      'menu.updated',
      {
        source: 'iiko-sync',
        productsCount,
        categoriesCount,
        syncedAt,
      },
      { broadcast: true },
    );
    res.json({ success: true, productsCount, categoriesCount, syncedAt });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

// Сохранить оверрайд товара
router.post('/admin/api/menu/product/override', adminAuthMiddleware, async (req, res) => {
  try {
    const { iikoProductId, overrides } = req.body;
    await menuService.setProductOverride(iikoProductId, overrides);
    iikoApi.invalidateMenuCache(); // Сбрасываем кэш, чтобы изменения применились
    realtime.publish('menu.updated', { productId: String(iikoProductId) }, { broadcast: true });
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

// Сохранить оверрайд категории
router.post('/admin/api/menu/category/override', adminAuthMiddleware, async (req, res) => {
  try {
    const { iikoCategoryId, overrides } = req.body;
    await menuService.setCategoryOverride(iikoCategoryId, overrides);
    iikoApi.invalidateMenuCache();
    realtime.publish('menu.updated', { categoryId: String(iikoCategoryId) }, { broadcast: true });
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

// Кастомные товары
router.post('/admin/api/menu/custom-product', adminAuthMiddleware, async (req, res) => {
  try {
    await menuService.upsertCustomProduct(req.body);
    iikoApi.invalidateMenuCache();
    realtime.publish('menu.updated', { customProduct: true }, { broadcast: true });
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.delete('/admin/api/menu/custom-product/:id', adminAuthMiddleware, async (req, res) => {
  try {
    await menuService.deleteCustomProduct(req.params.id);
    iikoApi.invalidateMenuCache();
    realtime.publish(
      'menu.updated',
      { customProductId: String(req.params.id), deleted: true },
      { broadcast: true },
    );
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

// Загрузка фото для товара
router.post(
  '/admin/api/menu/upload-image',
  adminAuthMiddleware,
  upload.single('image'),
  validateUploadedImage,
  async (req, res) => {
    try {
      if (!req.file) throw new Error('Файл не загружен');

      const optimized = await optimizeUploadedImage(req.file.buffer, req.detectedImageType.mime);
      const fileName = `menu_${Date.now()}_${Math.random().toString(36).substring(7)}.${optimized.extension}`;

      // Загружаем в Supabase Storage (бакет 'menu_images')
      const { error } = await supabase.storage
        .from('menu_images')
        .upload(fileName, optimized.buffer, {
          contentType: optimized.mime,
          cacheControl: '31536000',
          upsert: false,
        });

      if (error) throw new Error('Ошибка Supabase Storage: ' + error.message);

      // Получаем публичный URL
      const { data: publicUrlData } = supabase.storage.from('menu_images').getPublicUrl(fileName);

      res.json({
        success: true,
        imageUrl: publicUrlData.publicUrl,
        optimized: optimized.optimized,
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);

// Автоперевод через Google Translate (Proxy)
router.post('/admin/api/translate', adminAuthMiddleware, async (req, res) => {
  try {
    const { text, targetLang } = req.body;
    if (!text) return res.json({ success: true, translated: '' });

    // Используем встроенный Node fetch или axios
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    const data = await response.json();
    const translatedText = data[0].map((item) => item[0]).join('');

    res.json({ success: true, translated: translatedText });
  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ success: false, error: 'Ошибка перевода' });
  }
});
router.patch(
  '/admin/api/loyalty-tiers/:id/active',
  adminAuthMiddleware,
  tierController.setAdminTierActive,
);
router.get('/admin/api/inventory', async (req, res) => {
  try {
    const branchId = String(req.query.branchId || '');
    if (branchId) assertBranchAccess(req, branchId);
    const inventory = await listInventory({ branchId, branchIds: scopedBranchIds(req) });
    res.json({ success: true, inventory });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post('/admin/api/inventory/sync', async (req, res) => {
  try {
    const rawMenu = await iikoApi.getMenu({ strict: true });
    const results = await syncAllBranchInventory({
      strict: true,
      products: rawMenu.products || [],
      branchIds: scopedBranchIds(req),
    });
    realtime.publish('menu.updated', { inventory: true }, { broadcast: true });
    res.json({ success: true, results });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.put('/admin/api/inventory/:branchId/:productId', async (req, res) => {
  try {
    assertBranchAccess(req, req.params.branchId);
    const inventory = await updateInventory(req.params.branchId, req.params.productId, req.body);
    realtime.publish(
      'menu.updated',
      {
        inventory: true,
        branchId: req.params.branchId,
        productId: req.params.productId,
      },
      { broadcast: true, branchId: req.params.branchId },
    );
    res.json({ success: true, inventory });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/admin/api/couriers', async (_req, res) => {
  try {
    res.json({ success: true, couriers: await listCouriers() });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post('/admin/api/couriers', async (req, res) => {
  try {
    res.status(201).json({ success: true, courier: await saveCourier(req.body) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.put('/admin/api/couriers/:id', async (req, res) => {
  try {
    res.json({ success: true, courier: await saveCourier(req.body, req.params.id) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.patch('/admin/api/couriers/:id/active', async (req, res) => {
  try {
    res.json({ success: true, courier: await setCourierActive(req.params.id, req.body?.active) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post('/admin/api/couriers/:id/revoke-sessions', async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.admin.role)) {
      return res.status(403).json({ success: false, error: 'Доступно только владельцу' });
    }
    await revokeCourierSessions(req.params.id, `admin:${req.admin.sub}`);
    return res.json({ success: true });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/admin/api/couriers/:id/activity', async (req, res) => {
  try {
    return res.json({
      success: true,
      activity: await listCourierActivity(req.params.id, {
        branchIds: scopedBranchIds(req),
        limit: req.query.limit,
      }),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.patch('/admin/api/orders/:id/courier', async (req, res) => {
  try {
    await assertOrderAccess(req, req.params.id);
    const order = await assignCourier(
      req.params.id,
      req.body?.courierId,
      req.body?.estimatedDeliveryAt,
    );
    realtime.publish(
      'order.updated',
      {
        orderId: order.id,
        orderNumber: order.order_number,
        deliveryStatus: order.delivery_status,
      },
      { customerId: order.customer_id, includeAdmins: true, branchId: order.branch_id },
    );
    res.json({ success: true, order: normalizeOrder(order) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.patch('/admin/api/orders/:id/delivery-status', async (req, res) => {
  try {
    await assertOrderAccess(req, req.params.id);
    if (req.body?.status === 'delivered') {
      return res.status(409).json({
        success: false,
        error: 'Курьер завершает доставку по PIN клиента и фото подтверждения',
      });
    }
    const order = await updateDeliveryStatus(req.params.id, req.body?.status);
    realtime.publish(
      'order.updated',
      {
        orderId: order.id,
        orderNumber: order.order_number,
        orderStatus: order.fulfillment_status,
        deliveryStatus: order.delivery_status,
      },
      { customerId: order.customer_id, includeAdmins: true, branchId: order.branch_id },
    );
    res.json({ success: true, order: normalizeOrder(order) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/admin/api/orders/:id/delivery-proof', async (req, res) => {
  try {
    await assertOrderAccess(req, req.params.id);
    return res.json({ success: true, proof: await getDeliveryProof(req.params.id) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.put('/admin/api/loyalty-tiers/:id', adminAuthMiddleware, tierController.updateAdminTier);
router.delete('/admin/api/loyalty-tiers/:id', adminAuthMiddleware, tierController.deleteAdminTier);

registerCustomerAdminRoutes(router);
router.get('/admin/api/orders', adminAuthMiddleware, orderController.listAdmin);
router.patch(
  '/admin/api/orders/:id/status',
  adminAuthMiddleware,
  orderController.updateAdminStatus,
);
router.get('/admin/api/locations', adminAuthMiddleware, async (req, res) => {
  try {
    let locations = await getBulkaLocations({ includeInactive: true });
    const allowed = scopedBranchIds(req);
    if (allowed.length)
      locations = locations.filter((location) => allowed.includes(String(location.id)));
    res.set('Cache-Control', 'private, no-store');
    res.json({ success: true, locations });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/admin/api/locations/cities', adminAuthMiddleware, async (req, res) => {
  try {
    const [cities, allLocations] = await Promise.all([
      getBulkaCities({ includeInactive: true }),
      getBulkaLocations({ includeInactive: true }),
    ]);
    const allowed = scopedBranchIds(req);
    const locations = allowed.length
      ? allLocations.filter((location) => allowed.includes(String(location.id)))
      : allLocations;
    const countsById = new Map();
    const countsByName = new Map();
    for (const location of locations) {
      if (location.cityId) {
        countsById.set(location.cityId, (countsById.get(location.cityId) || 0) + 1);
      } else {
        const key = String(location.city || '')
          .trim()
          .toLocaleLowerCase('ru-RU');
        countsByName.set(key, (countsByName.get(key) || 0) + 1);
      }
    }
    const includeEmptyCities = allowed.length === 0 && hasGlobalBranchAccess(req.admin);
    const visibleCities = cities
      .map((city) => ({
        ...city,
        branchCount:
          (countsById.get(city.id) || 0) +
          (countsByName.get(city.name.trim().toLocaleLowerCase('ru-RU')) || 0),
      }))
      .filter((city) => includeEmptyCities || city.branchCount > 0);
    res.set('Cache-Control', 'private, no-store');
    res.json({ success: true, cities: visibleCities });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Не удалось загрузить города',
    });
  }
});
router.post('/admin/api/locations/cities', adminAuthMiddleware, async (req, res) => {
  try {
    assertLocationStructureAccess(req);
    const city = await createBulkaCity(req.body);
    realtime.publish(
      'locations.updated',
      { cityId: city.id, action: 'city.created' },
      { adminOnly: true },
    );
    res.status(201).json({ success: true, city: { ...city, branchCount: 0 } });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Не удалось создать город',
    });
  }
});
router.post('/admin/api/locations', adminAuthMiddleware, async (req, res) => {
  try {
    assertLocationStructureAccess(req);
    const location = await createBulkaLocation(req.body);
    realtime.publish(
      'locations.updated',
      { locationId: location.id, cityId: location.cityId, action: 'location.created' },
      { adminOnly: true, branchId: location.id },
    );
    res.status(201).json({ success: true, location });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Не удалось создать филиал',
    });
  }
});
router.patch('/admin/api/locations/delivery-zones/bulk', adminAuthMiddleware, async (req, res) => {
  try {
    const result = await updateActiveLocationDeliveryZones(req.body, {
      locationIds: scopedBranchIds(req),
    });
    realtime.publish(
      'locations.updated',
      { bulk: true, updatedCount: result.updatedCount },
      { adminOnly: true },
    );
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.patch('/admin/api/locations/:id', adminAuthMiddleware, async (req, res) => {
  try {
    assertBranchAccess(req, req.params.id);
    const location = await updateBulkaLocation(req.params.id, req.body);
    realtime.publish(
      'locations.updated',
      { locationId: req.params.id },
      { adminOnly: true, branchId: req.params.id },
    );
    res.json({ success: true, location });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/admin/api/transactions', adminAuthMiddleware, adminController.getTransactionsHandler);
router.get('/admin/api/stats', adminAuthMiddleware, adminController.getStatsHandler);
router.get(
  '/admin/api/iiko-operations',
  adminAuthMiddleware,
  adminController.getIikoOperationsHandler,
);

router.post('/admin/api/push/test', adminAuthMiddleware, adminController.pushTestHandler);
router.post('/admin/api/push/mass', adminAuthMiddleware, adminController.pushMassHandler);

router.post('/admin/api/broadcast', adminAuthMiddleware, adminController.broadcastHandler);
router.post('/admin/api/upload', adminAuthMiddleware, adminController.uploadPhotoHandler);

router.get('/admin/api/stories', adminAuthMiddleware, adminController.getStoriesHandler);
router.post('/admin/api/stories', adminAuthMiddleware, adminController.addStoryHandler);
router.put('/admin/api/stories/:id', adminAuthMiddleware, adminController.updateStoryHandler);
router.delete('/admin/api/stories/:id', adminAuthMiddleware, adminController.deleteStoryHandler);

router.get('/admin/api/news', adminAuthMiddleware, adminController.getNewsHandler);
router.post('/admin/api/news', adminAuthMiddleware, adminController.addNewsHandler);
router.put('/admin/api/news/:id', adminAuthMiddleware, adminController.updateNewsHandler);
router.delete('/admin/api/news/:id', adminAuthMiddleware, adminController.deleteNewsHandler);

router.get('/admin/api/cities', adminAuthMiddleware, adminController.getCitiesHandler);
router.post('/admin/api/cities', adminAuthMiddleware, adminController.addCityHandler);
router.put('/admin/api/cities/:id', adminAuthMiddleware, adminController.updateCityHandler);
router.delete('/admin/api/cities/:id', adminAuthMiddleware, adminController.deleteCityHandler);

router.post('/admin/api/points', adminAuthMiddleware, adminController.addPointHandler);
router.put('/admin/api/points/:id', adminAuthMiddleware, adminController.updatePointHandler);
router.delete('/admin/api/points/:id', adminAuthMiddleware, adminController.deletePointHandler);

router.get('/admin/api/menu/product-options', async (req, res) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    res.json({ success: true, products: Object.fromEntries(await getProductOptions(ids)) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.put('/admin/api/menu/product-options/:productId', async (req, res) => {
  try {
    const options = await saveProductOptions(req.params.productId, req.body);
    realtime.publish(
      'menu.updated',
      { productId: req.params.productId, options: true },
      { broadcast: true },
    );
    res.json({ success: true, options });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/admin/api/orders/:id/refund-options', async (req, res) => {
  try {
    await assertOrderAccess(req, req.params.id);
    res.json({ success: true, refund: await getRefundOptions(req.params.id) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post('/admin/api/orders/:id/partial-refund', async (req, res) => {
  try {
    if (!['admin', 'owner', 'branch_manager'].includes(req.admin.role)) {
      return res.status(403).json({ success: false, error: 'Недостаточно прав для возврата' });
    }
    await assertOrderAccess(req, req.params.id);
    const refund = await createPartialRefund(req.params.id, req.body, req.admin.sub);
    res.json({ success: true, refund });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      ...(error.code && { code: error.code }),
    });
  }
});

router.get('/admin/api/dispatch', async (req, res) => {
  try {
    const state = await dispatchService.listDispatchState({ branchIds: scopedBranchIds(req) });
    res.json({
      success: true,
      ...state,
      yandexDelivery: {
        ...state.yandexDelivery,
        canManage: canManageYandexDispatch(req),
      },
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post('/admin/api/dispatch/:orderId/auto-assign', async (req, res) => {
  try {
    await assertOrderAccess(req, req.params.orderId);
    const result = await dispatchService.autoAssignOrder(req.params.orderId, {
      branchIds: scopedBranchIds(req),
    });
    realtime.publish(
      'order.updated',
      { orderId: req.params.orderId, autoAssigned: true },
      {
        customerId: result.order?.customer_id,
        includeAdmins: true,
        branchId: result.order?.branch_id,
      },
    );
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/admin/api/dispatch/yandex/status', (req, res) => {
  res.json({
    success: true,
    ...yandexDelivery.getConfigurationStatus(),
    canManage: canManageYandexDispatch(req),
  });
});
router.post('/admin/api/dispatch/:orderId/yandex/quote', async (req, res) => {
  try {
    assertYandexDispatchMutationAccess(req);
    const order = await assertOrderAccess(req, req.params.orderId);
    const delivery = await yandexDelivery.quoteOrder(req.params.orderId);
    realtime.publish(
      'delivery.updated',
      { orderId: req.params.orderId, quoted: true },
      { adminOnly: true, branchId: order.branch_id },
    );
    res.json({ success: true, delivery });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      ...(error.code && { code: error.code }),
      ...(error.details && { details: error.details }),
    });
  }
});
router.post('/admin/api/dispatch/:orderId/yandex/request', async (req, res) => {
  try {
    assertYandexDispatchMutationAccess(req);
    await assertOrderAccess(req, req.params.orderId);
    const delivery = await yandexDelivery.dispatchOrder(req.params.orderId);
    res.json({ success: true, delivery });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      ...(error.code && { code: error.code }),
      ...(error.details && { details: error.details }),
    });
  }
});
router.post('/admin/api/dispatch/:orderId/yandex/sync', async (req, res) => {
  try {
    await assertOrderAccess(req, req.params.orderId);
    res.json({
      success: true,
      delivery: await yandexDelivery.syncOrderDelivery(req.params.orderId),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      ...(error.code && { code: error.code }),
    });
  }
});
router.post('/admin/api/dispatch/:orderId/yandex/cancel-info', async (req, res) => {
  try {
    await assertOrderAccess(req, req.params.orderId);
    res.json({
      success: true,
      cancellation: await yandexDelivery.getCancellationInfo(req.params.orderId),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      ...(error.code && { code: error.code }),
    });
  }
});
router.post('/admin/api/dispatch/:orderId/yandex/cancel', async (req, res) => {
  try {
    assertYandexDispatchMutationAccess(req);
    await assertOrderAccess(req, req.params.orderId);
    res.json({
      success: true,
      delivery: await yandexDelivery.cancelDelivery(req.params.orderId, {
        allowPaid: req.body?.allowPaid === true,
      }),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      ...(error.code && { code: error.code }),
      ...(error.details && { details: error.details }),
    });
  }
});
router.patch('/admin/api/dispatch/couriers/:id/availability', async (req, res) => {
  try {
    const courier = await dispatchService.updateCourierAvailability(
      req.params.id,
      req.body?.status,
    );
    realtime.publish(
      'courier.updated',
      { courierId: courier.id, availabilityStatus: courier.availability_status },
      { adminOnly: true },
    );
    res.json({
      success: true,
      courier,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/admin/api/kitchen', async (req, res) => {
  try {
    if (req.query.branchId) assertBranchAccess(req, req.query.branchId);
    res.json({
      success: true,
      orders: await kitchenService.listKitchenOrders({
        branchId: req.query.branchId || null,
        branchIds: scopedBranchIds(req),
        includeClosed: req.query.includeClosed === 'true',
      }),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.patch('/admin/api/kitchen/:id/status', async (req, res) => {
  try {
    await assertOrderAccess(req, req.params.id);
    res.json({
      success: true,
      order: await kitchenService.updateKitchenStatus(
        req.params.id,
        req.body?.status,
        req.body?.preparationMinutes,
        { branchIds: scopedBranchIds(req) },
      ),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/admin/api/reviews', async (req, res) => {
  try {
    res.json({
      success: true,
      ...(await reviewService.listAdminReviews({
        ...req.query,
        branchIds: scopedBranchIds(req),
      })),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.patch('/admin/api/reviews/:id/status', async (req, res) => {
  try {
    await assertReviewAccess(req, req.params.id);
    res.json({
      success: true,
      review: await reviewService.updateReviewStatus(req.params.id, req.body?.status),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/admin/api/support', async (req, res) => {
  try {
    res.json({
      success: true,
      ...(await supportService.listAdminSupport({
        ...req.query,
        assignedTo: req.query.queue === 'mine' ? req.admin.sub : req.query.assignedTo,
        branchIds: scopedBranchIds(req),
      })),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/admin/api/support/:id', async (req, res) => {
  try {
    await assertSupportAccess(req, req.params.id);
    res.json({
      success: true,
      ...(await supportService.getSupportRequest(req.params.id)),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post('/admin/api/support/:id/messages', async (req, res) => {
  try {
    await assertSupportAccess(req, req.params.id);
    res.status(201).json({
      success: true,
      ...(await supportService.addSupportMessage(req.params.id, req.body, {
        senderType: 'admin',
        senderId: req.admin.sub,
      })),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.patch('/admin/api/support/:id', async (req, res) => {
  try {
    await assertSupportAccess(req, req.params.id);
    res.json({
      success: true,
      request: await supportService.updateSupportRequest(req.params.id, req.body, req.admin.sub),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/admin/api/promotions', async (_req, res) => {
  try {
    res.json({ success: true, promotions: await commerceMarketing.listPromotions() });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post('/admin/api/promotions', async (req, res) => {
  try {
    res
      .status(201)
      .json({ success: true, promotion: await commerceMarketing.savePromotion(req.body) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.put('/admin/api/promotions/:id', async (req, res) => {
  try {
    res.json({
      success: true,
      promotion: await commerceMarketing.savePromotion(req.body, req.params.id),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/admin/api/gift-cards', async (_req, res) => {
  try {
    res.json({ success: true, giftCards: await commerceMarketing.listGiftCards() });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post('/admin/api/gift-cards', async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      giftCard: await commerceMarketing.issueGiftCard(req.body, req.admin.sub),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/admin/api/automations', async (_req, res) => {
  const { data, error } = await supabase
    .from('marketing_automations')
    .select('*')
    .order('trigger_type');
  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, automations: data || [] });
});
router.put('/admin/api/automations/:id', async (req, res) => {
  const record = {
    title_translations: req.body?.titleTranslations || {},
    body_translations: req.body?.bodyTranslations || {},
    config: req.body?.config || {},
    active: req.body?.active !== false,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('marketing_automations')
    .update(record)
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();
  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data) return res.status(404).json({ success: false, error: 'Сценарий не найден' });
  return res.json({ success: true, automation: data });
});

router.get('/admin/api/access', async (_req, res) => {
  const { data, error } = await supabase.from('admin_user_profiles').select('*').order('username');
  if (error) return res.status(500).json({ success: false, error: error.message });
  let configured;
  try {
    configured = JSON.parse(process.env.ADMIN_USERS_JSON || '[]');
  } catch {
    configured = [];
  }
  if (!Array.isArray(configured) || !configured.length) configured = [{ username: 'admin' }];
  const configuredUsers = Array.from(
    new Set([
      ...configured.map((user) => String(user.username || '').trim()).filter(Boolean),
      ...(data || []).map((profile) => String(profile.username || '').trim()).filter(Boolean),
    ]),
  );
  return res.json({
    success: true,
    profiles: data || [],
    configuredUsers,
  });
});
router.post('/admin/api/access', async (req, res) => {
  const phone = normalizeKazakhstanPhone(req.body?.phone);
  const displayName = String(req.body?.displayName || '')
    .trim()
    .slice(0, 160);
  const role = String(req.body?.role || 'operator');
  const branchIds = normalizeAccessBranchIds(req.body?.branchIds);

  if (!phone) {
    return res
      .status(400)
      .json({ success: false, error: 'Введите номер в формате +7 700 000 00 00' });
  }
  if (!displayName) {
    return res.status(400).json({ success: false, error: 'Укажите имя сотрудника' });
  }
  if (!ADMIN_PHONE_ROLES.has(role)) {
    return res.status(400).json({ success: false, error: 'Некорректная роль сотрудника' });
  }
  if (!branchIds) {
    return res.status(400).json({ success: false, error: 'Некорректный список филиалов' });
  }

  const { data, error } = await supabase
    .from('admin_user_profiles')
    .insert({
      username: phone,
      display_name: displayName,
      role,
      branch_ids: branchIds,
      active: true,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error?.code === '23505') {
    return res.status(409).json({ success: false, error: 'Сотрудник с этим номером уже добавлен' });
  }
  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.status(201).json({ success: true, profile: data });
});
router.put('/admin/api/access/:username', async (req, res) => {
  const role = String(req.body?.role || 'viewer');
  if (!['owner', 'branch_manager', 'operator', 'marketer', 'courier', 'viewer'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Некорректная роль' });
  }
  const rawUsername = String(req.params.username || '').trim();
  const phoneUsername = normalizeKazakhstanPhone(rawUsername);
  if (phoneUsername && !ADMIN_PHONE_ROLES.has(role)) {
    return res
      .status(400)
      .json({ success: false, error: 'Роль владельца нельзя назначить по номеру телефона' });
  }
  const branchIds = normalizeAccessBranchIds(req.body?.branchIds);
  if (!branchIds) {
    return res.status(400).json({ success: false, error: 'Некорректный список филиалов' });
  }
  const { data, error } = await supabase
    .from('admin_user_profiles')
    .upsert(
      {
        username: phoneUsername || rawUsername.toLowerCase(),
        display_name:
          String(req.body?.displayName || '')
            .trim()
            .slice(0, 160) || null,
        role,
        branch_ids: branchIds,
        active: req.body?.active !== false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'username' },
    )
    .select('*')
    .single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, profile: data });
});

module.exports = router;
