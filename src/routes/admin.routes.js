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
const { emptyBodySchema, validateRequest } = require('../middlewares/validation.middleware');
const {
  kitchenStatusBodySchema,
  orderParamsSchema,
} = require('../contracts/backend-safety.contract');
const { adminMutationSchemas } = require('../contracts/admin-mutations.contract');
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
  resetWhatsAppPairing,
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
const { registerPaymentIntegrationAdminRoutes } = require('./admin/payment-integration.routes');
const { registerOrderSubstitutionAdminRoutes } = require('./admin/order-substitution.routes');
const { registerBackendSafetyAdminRoutes } = require('./admin/backend-safety.routes');
const { registerBusinessFoundationAdminRoutes } = require('./admin/business-foundation.routes');
const {
  registerInventoryAdminRoutes,
  registerMenuAdminRoutes,
  registerMenuProductOptionAdminRoutes,
} = require('./admin/menu.routes');

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
      selectedBranchIds: normalizeBranchIds(req.admin?.selectedBranchIds),
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
    selectedBranchIds: normalizeBranchIds(req.admin?.selectedBranchIds),
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
registerPaymentIntegrationAdminRoutes(router);
registerOrderSubstitutionAdminRoutes(router, { assertOrderAccess });
registerBackendSafetyAdminRoutes(router, { assertOrderAccess });
registerBusinessFoundationAdminRoutes(router, { assertOrderAccess });
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
router.post(
  '/admin/api/whatsapp/pairing/reset',
  requireWhatsAppConfigurationRole,
  validateRequest({ body: emptyBodySchema }),
  async (_req, res) => {
    try {
      const connection = await resetWhatsAppPairing();
      res.json({ success: true, connection });
    } catch (error) {
      whatsappErrorResponse(res, error);
    }
  },
);
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
router.put(
  '/admin/api/whatsapp/settings',
  requireWhatsAppConfigurationRole,
  validateRequest(adminMutationSchemas.whatsappSettings),
  async (req, res) => {
    try {
      const settings = await updateAssistantSettings(req.body, {
        updatedBy: req.admin?.sub || '',
      });
      res.json({ success: true, settings });
    } catch (error) {
      whatsappErrorResponse(res, error);
    }
  },
);
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
  validateRequest(adminMutationSchemas.whatsappConversationUpdate),
  async (req, res) => {
    try {
      const conversation = await updateConversation(req.params.id, req.body);
      res.json({ success: true, conversation });
    } catch (error) {
      whatsappErrorResponse(res, error);
    }
  },
);
router.post(
  '/admin/api/whatsapp/conversations/:id/messages',
  validateRequest(adminMutationSchemas.whatsappMessage),
  async (req, res) => {
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
  },
);
router.post(
  '/admin/api/whatsapp/conversations/:id/voice',
  parseWhatsAppVoiceUpload,
  validateRequest(adminMutationSchemas.whatsappVoice),
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
  validateRequest(adminMutationSchemas.whatsappMemory),
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
  validateRequest(adminMutationSchemas.whatsappMemoryDelete),
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
router.post(
  '/admin/api/whatsapp/knowledge',
  requireWhatsAppConfigurationRole,
  validateRequest(adminMutationSchemas.whatsappKnowledge),
  async (req, res) => {
    try {
      const document = await createKnowledgeDocument(req.body, {
        createdBy: req.admin?.sub || '',
      });
      res.json({ success: true, document });
    } catch (error) {
      whatsappErrorResponse(res, error);
    }
  },
);
router.put(
  '/admin/api/whatsapp/knowledge/:id',
  requireWhatsAppConfigurationRole,
  validateRequest(adminMutationSchemas.whatsappKnowledgeUpdate),
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
  validateRequest(adminMutationSchemas.whatsappKnowledgeDelete),
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
router.put(
  '/admin/api/site-access',
  validateRequest(adminMutationSchemas.siteAccess),
  async (req, res) => {
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
  },
);
router.post(
  '/admin/api/settings',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.settings),
  adminController.updateSettingsHandler,
);

registerContactCenterAdminRoutes(router);

router.get('/admin/api/loyalty-tiers', adminAuthMiddleware, tierController.listAdminTiers);
router.post(
  '/admin/api/loyalty-tiers',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.tierCreate),
  tierController.createAdminTier,
);
router.put(
  '/admin/api/loyalty-tiers/reorder',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.tierReorder),
  tierController.reorderAdminTiers,
);

registerMenuAdminRoutes(router);
router.patch(
  '/admin/api/loyalty-tiers/:id/active',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.tierActive),
  tierController.setAdminTierActive,
);
registerInventoryAdminRoutes(router, { assertBranchAccess, scopedBranchIds });
router.get('/admin/api/couriers', async (_req, res) => {
  try {
    res.json({ success: true, couriers: await listCouriers() });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post(
  '/admin/api/couriers',
  validateRequest(adminMutationSchemas.courierCreate),
  async (req, res) => {
    try {
      res.status(201).json({ success: true, courier: await saveCourier(req.body) });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);
router.put(
  '/admin/api/couriers/:id',
  validateRequest(adminMutationSchemas.courierUpdate),
  async (req, res) => {
    try {
      res.json({ success: true, courier: await saveCourier(req.body, req.params.id) });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);
router.patch(
  '/admin/api/couriers/:id/active',
  validateRequest(adminMutationSchemas.courierActive),
  async (req, res) => {
    try {
      res.json({ success: true, courier: await setCourierActive(req.params.id, req.body?.active) });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);
router.post(
  '/admin/api/couriers/:id/revoke-sessions',
  validateRequest(adminMutationSchemas.courierEmpty),
  async (req, res) => {
    try {
      if (!['owner', 'admin'].includes(req.admin.role)) {
        return res.status(403).json({ success: false, error: 'Доступно только владельцу' });
      }
      await revokeCourierSessions(req.params.id, `admin:${req.admin.sub}`);
      return res.json({ success: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);
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
router.patch(
  '/admin/api/orders/:id/courier',
  validateRequest(adminMutationSchemas.assignCourier),
  async (req, res) => {
    try {
      const order = await assignCourier(
        req.params.id,
        req.body?.courierId,
        req.body?.estimatedDeliveryAt,
        { branchIds: scopedBranchIds(req) },
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
  },
);
router.patch(
  '/admin/api/orders/:id/delivery-status',
  validateRequest(adminMutationSchemas.deliveryStatus),
  async (req, res) => {
    try {
      if (req.body?.status === 'delivered') {
        return res.status(409).json({
          success: false,
          error: 'Курьер завершает доставку по PIN клиента и фото подтверждения',
        });
      }
      const order = await updateDeliveryStatus(req.params.id, req.body?.status, {
        branchIds: scopedBranchIds(req),
      });
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
  },
);
router.get('/admin/api/orders/:id/delivery-proof', async (req, res) => {
  try {
    await assertOrderAccess(req, req.params.id);
    return res.json({ success: true, proof: await getDeliveryProof(req.params.id) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.put(
  '/admin/api/loyalty-tiers/:id',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.tierUpdate),
  tierController.updateAdminTier,
);
router.delete(
  '/admin/api/loyalty-tiers/:id',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.tierDelete),
  tierController.deleteAdminTier,
);

registerCustomerAdminRoutes(router);
router.get('/admin/api/orders', adminAuthMiddleware, orderController.listAdmin);
router.patch(
  '/admin/api/orders/:id/status',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.orderStatus),
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
router.post(
  '/admin/api/locations/cities',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.locationCity),
  async (req, res) => {
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
  },
);
router.post(
  '/admin/api/locations',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.locationCreate),
  async (req, res) => {
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
  },
);
router.patch(
  '/admin/api/locations/delivery-zones/bulk',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.locationBulk),
  async (req, res) => {
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
  },
);
router.patch(
  '/admin/api/locations/:id',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.locationUpdate),
  async (req, res) => {
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
  },
);
router.get('/admin/api/transactions', adminAuthMiddleware, adminController.getTransactionsHandler);
router.get('/admin/api/stats', adminAuthMiddleware, adminController.getStatsHandler);
router.get(
  '/admin/api/iiko-operations',
  adminAuthMiddleware,
  adminController.getIikoOperationsHandler,
);

router.post(
  '/admin/api/push/test',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.pushTest),
  adminController.pushTestHandler,
);
router.post(
  '/admin/api/push/mass',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.pushMass),
  adminController.pushMassHandler,
);

router.post(
  '/admin/api/broadcast',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.broadcast),
  adminController.broadcastHandler,
);
router.post(
  '/admin/api/upload',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.upload),
  adminController.uploadPhotoHandler,
);

router.get('/admin/api/stories', adminAuthMiddleware, adminController.getStoriesHandler);
router.post(
  '/admin/api/stories',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.storyCreate),
  adminController.addStoryHandler,
);
router.put(
  '/admin/api/stories/:id',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.storyUpdate),
  adminController.updateStoryHandler,
);
router.delete(
  '/admin/api/stories/:id',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.numericDelete),
  adminController.deleteStoryHandler,
);

router.get('/admin/api/news', adminAuthMiddleware, adminController.getNewsHandler);
router.post(
  '/admin/api/news',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.newsCreate),
  adminController.addNewsHandler,
);
router.put(
  '/admin/api/news/:id',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.newsUpdate),
  adminController.updateNewsHandler,
);
router.delete(
  '/admin/api/news/:id',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.numericDelete),
  adminController.deleteNewsHandler,
);

router.get('/admin/api/cities', adminAuthMiddleware, adminController.getCitiesHandler);
router.post(
  '/admin/api/cities',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.legacyCityCreate),
  adminController.addCityHandler,
);
router.put(
  '/admin/api/cities/:id',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.legacyCityUpdate),
  adminController.updateCityHandler,
);
router.delete(
  '/admin/api/cities/:id',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.numericDelete),
  adminController.deleteCityHandler,
);

router.post(
  '/admin/api/points',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.legacyPointCreate),
  adminController.addPointHandler,
);
router.put(
  '/admin/api/points/:id',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.legacyPointUpdate),
  adminController.updatePointHandler,
);
router.delete(
  '/admin/api/points/:id',
  adminAuthMiddleware,
  validateRequest(adminMutationSchemas.numericDelete),
  adminController.deletePointHandler,
);

registerMenuProductOptionAdminRoutes(router);

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
router.post(
  '/admin/api/dispatch/:orderId/auto-assign',
  validateRequest(adminMutationSchemas.dispatchEmpty),
  async (req, res) => {
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
  },
);
router.get('/admin/api/dispatch/yandex/status', (req, res) => {
  res.json({
    success: true,
    ...yandexDelivery.getConfigurationStatus(),
    canManage: canManageYandexDispatch(req),
  });
});
router.post(
  '/admin/api/dispatch/:orderId/yandex/quote',
  validateRequest(adminMutationSchemas.dispatchEmpty),
  async (req, res) => {
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
  },
);
router.post(
  '/admin/api/dispatch/:orderId/yandex/request',
  validateRequest(adminMutationSchemas.dispatchEmpty),
  async (req, res) => {
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
  },
);
router.post(
  '/admin/api/dispatch/:orderId/yandex/sync',
  validateRequest(adminMutationSchemas.dispatchEmpty),
  async (req, res) => {
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
  },
);
router.post(
  '/admin/api/dispatch/:orderId/yandex/cancel-info',
  validateRequest(adminMutationSchemas.dispatchEmpty),
  async (req, res) => {
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
  },
);
router.post(
  '/admin/api/dispatch/:orderId/yandex/cancel',
  validateRequest(adminMutationSchemas.yandexCancel),
  async (req, res) => {
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
  },
);
router.patch(
  '/admin/api/dispatch/couriers/:id/availability',
  validateRequest(adminMutationSchemas.courierAvailability),
  async (req, res) => {
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
  },
);

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
router.patch(
  '/admin/api/kitchen/:id/status',
  validateRequest({ params: orderParamsSchema, body: kitchenStatusBodySchema }),
  async (req, res) => {
    try {
      res.json({
        success: true,
        order: await kitchenService.updateKitchenStatus(
          req.params.id,
          req.body?.status,
          req.body?.preparationMinutes,
          {
            branchIds: scopedBranchIds(req),
            cancellationReason: req.body?.cancellationReason,
          },
        ),
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);

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
router.patch(
  '/admin/api/reviews/:id/status',
  validateRequest(adminMutationSchemas.reviewStatus),
  async (req, res) => {
    try {
      await assertReviewAccess(req, req.params.id);
      res.json({
        success: true,
        review: await reviewService.updateReviewStatus(req.params.id, req.body?.status),
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);
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
router.post(
  '/admin/api/support/:id/messages',
  validateRequest(adminMutationSchemas.supportMessage),
  async (req, res) => {
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
  },
);
router.patch(
  '/admin/api/support/:id',
  validateRequest(adminMutationSchemas.supportUpdate),
  async (req, res) => {
    try {
      await assertSupportAccess(req, req.params.id);
      res.json({
        success: true,
        request: await supportService.updateSupportRequest(req.params.id, req.body, req.admin.sub),
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);

router.get('/admin/api/promotions', async (_req, res) => {
  try {
    res.json({ success: true, promotions: await commerceMarketing.listPromotions() });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post(
  '/admin/api/promotions',
  validateRequest(adminMutationSchemas.promotionCreate),
  async (req, res) => {
    try {
      res
        .status(201)
        .json({ success: true, promotion: await commerceMarketing.savePromotion(req.body) });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);
router.put(
  '/admin/api/promotions/:id',
  validateRequest(adminMutationSchemas.promotionUpdate),
  async (req, res) => {
    try {
      res.json({
        success: true,
        promotion: await commerceMarketing.savePromotion(req.body, req.params.id),
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);
router.get('/admin/api/gift-cards', async (_req, res) => {
  try {
    res.json({ success: true, giftCards: await commerceMarketing.listGiftCards() });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post(
  '/admin/api/gift-cards',
  validateRequest(adminMutationSchemas.giftCard),
  async (req, res) => {
    try {
      res.status(201).json({
        success: true,
        giftCard: await commerceMarketing.issueGiftCard(req.body, req.admin.sub),
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);

router.get('/admin/api/automations', async (_req, res) => {
  const { data, error } = await supabase
    .from('marketing_automations')
    .select('*')
    .order('trigger_type');
  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, automations: data || [] });
});
router.put(
  '/admin/api/automations/:id',
  validateRequest(adminMutationSchemas.automation),
  async (req, res) => {
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
  },
);

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
router.post(
  '/admin/api/access',
  validateRequest(adminMutationSchemas.accessCreate),
  async (req, res) => {
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
      return res
        .status(409)
        .json({ success: false, error: 'Сотрудник с этим номером уже добавлен' });
    }
    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(201).json({ success: true, profile: data });
  },
);
router.put(
  '/admin/api/access/:username',
  validateRequest(adminMutationSchemas.accessUpdate),
  async (req, res) => {
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
  },
);

module.exports = router;
