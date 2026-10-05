const crypto = require('node:crypto');
const {
  chatgptCartPrepareSchema,
  chatgptCartTokenSchema,
} = require('../contracts/chatgpt-cart.contract');
const { AppError, publicError } = require('../utils/app-error.util');
const { validQuantity, addQuantity } = require('../utils/quantity.util');

const TOKEN_TTL_SECONDS = 30 * 60;
const TOKEN_AUDIENCE = 'bulka:chatgpt-cart:web:v1';
const TOKEN_PURPOSE = 'cart-handoff';
const invalidCart = (message = 'Некорректная корзина Bulka') =>
  publicError(400, 'CHATGPT_CART_INVALID', message);
const unavailableCart = (message) => publicError(409, 'CHATGPT_CART_UNAVAILABLE', message);
const text = (value, maximum = 160) =>
  String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
const title = (value, language) =>
  text(typeof value === 'object' && value ? value[language] || value.ru || value.en : value);
const safeImage = (value) => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2000
      ? url.href
      : null;
  } catch {
    return null;
  }
};
const priceDelta = (value) => {
  const amount = Number(value || 0);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 10_000_000)
    throw unavailableCart('Варианты товара временно недоступны');
  return amount;
};
const canonicalId = (value) => text(value, 128);
const optionById = (options, value) =>
  options.find((option) => [String(option.id), String(option.code)].includes(String(value)));
const translations = (value, fallback = '') =>
  Object.fromEntries(
    ['ru', 'kk', 'en'].map((language) => [language, title(value, language) || text(fallback)]),
  );
const safeHours = (value = {}) =>
  Object.fromEntries(
    Object.entries(value)
      .filter(([day]) => ['daily', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(day))
      .map(([day, schedule]) => [
        day,
        schedule?.closed === true
          ? { closed: true }
          : { open: text(schedule?.open, 5), close: text(schedule?.close, 5) },
      ]),
  );

function signingKey(env) {
  const secret = env.CHATGPT_CART_SECRET || env.CUSTOMER_JWT_SECRET || env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new AppError('Cart signing is not configured', { code: 'CHATGPT_CART_CONFIGURATION' });
  }
  return crypto.hkdfSync(
    'sha256',
    Buffer.from(secret),
    Buffer.from('bulka-cart-v1'),
    Buffer.from(TOKEN_AUDIENCE),
    32,
  );
}

function checkoutOrigin(env) {
  try {
    const url = new URL(env.PUBLIC_BASE_URL || 'https://bulka.com.kz');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['', '/'].includes(url.pathname)
    )
      throw new Error('Invalid public origin');
    return url.origin;
  } catch {
    throw new AppError('Public checkout origin is not configured', {
      code: 'CHATGPT_CART_CONFIGURATION',
    });
  }
}

function canonicalSelections(item) {
  const configuration = item.configuration || {};
  const modifiers = item.modifiers || [];
  if (new Set(modifiers.map((group) => group.groupId)).size !== modifiers.length)
    throw invalidCart('Не повторяйте одну группу вариантов товара');
  return {
    id: item.id,
    quantity: item.quantity,
    ...(Object.keys(configuration).length ? { configuration } : {}),
    ...(modifiers.length
      ? {
          modifiers: modifiers
            .map((group) => ({
              groupId: group.groupId,
              optionIds: [...new Set(group.optionIds)].sort(),
            }))
            .sort((first, second) => first.groupId.localeCompare(second.groupId)),
        }
      : {}),
  };
}

function resolveOptions(item, source, language) {
  const configuration = source?.configuration;
  const groups = Array.isArray(source?.modifierGroups) ? source.modifierGroups : [];
  const builderEnabled =
    configuration?.enabled !== false &&
    configuration?.productKind &&
    configuration.productKind !== 'standard';
  let totalDelta = 0;
  let requiresSelection = false;
  const missing = [];
  let builder = null;
  const safeConfiguration = builderEnabled
    ? {
        enabled: true,
        productKind: text(configuration.productKind, 30),
        minLeadHours: Number(configuration.minLeadHours || 0),
        maxAdvanceDays: Number(configuration.maxAdvanceDays || 30),
        allowInscription: configuration.allowInscription === true,
        allowCandles: configuration.allowCandles === true,
        allowReferenceUpload: configuration.allowReferenceUpload === true,
      }
    : null;
  if (!builderEnabled && Object.keys(item.configuration || {}).length)
    throw unavailableCart('Выбранная конфигурация товара больше недоступна');
  if (builderEnabled) {
    builder = { inscription: null, candles: 0, referenceUrl: null, readyAt: null, priceDelta: 0 };
    for (const field of ['weight', 'filling', 'design']) {
      const options = Array.isArray(configuration[`${field}Options`])
        ? configuration[`${field}Options`]
        : [];
      safeConfiguration[`${field}Options`] = options.map((option) => ({
        code: canonicalId(option.code || option.id),
        title: translations(option.title || option.translations, option.name || option.code),
        priceDelta: priceDelta(option.priceDelta ?? option.price_delta),
      }));
      const selectedId = item.configuration?.[field];
      if (!options.length) {
        if (selectedId) throw unavailableCart('Выбранный вариант товара больше недоступен');
        continue;
      }
      if (!selectedId) {
        requiresSelection = true;
        missing.push(field);
        continue;
      }
      const selected = optionById(options, selectedId);
      if (!selected) throw unavailableCart('Выбранный вариант товара больше недоступен');
      const delta = priceDelta(selected.priceDelta ?? selected.price_delta);
      builder[field] = {
        code: canonicalId(selected.code || selected.id),
        title: translations(
          selected.title || selected.translations,
          selected.name || selected.code,
        ),
        priceDelta: delta,
      };
      totalDelta += delta;
      builder.priceDelta += delta;
    }
  }
  const selectedGroups = [];
  const usedGroups = new Set();
  const safeGroups = groups.map((group) => {
    const minimum = Math.max(group.required === true ? 1 : 0, Number(group.minSelected || 0));
    const maximum = Number(group.maxSelected || 1);
    if (
      !Number.isInteger(minimum) ||
      !Number.isInteger(maximum) ||
      minimum < 0 ||
      maximum < minimum ||
      maximum > 100
    )
      throw unavailableCart('Варианты товара временно недоступны');
    const entry = (item.modifiers || []).find((selection) =>
      [String(group.id), String(group.code)].includes(selection.groupId),
    );
    if (entry) usedGroups.add(entry.groupId);
    const ids = entry?.optionIds || [];
    if (ids.length > maximum || (group.selectionType === 'single' && ids.length > 1))
      throw invalidCart(`Проверьте количество вариантов «${title(group.title, language)}»`);
    if (ids.length < minimum) {
      requiresSelection = true;
      missing.push(canonicalId(group.id));
    }
    const options = (Array.isArray(group.options) ? group.options : []).map((option) => ({
      id: canonicalId(option.id),
      code: canonicalId(option.code),
      title: translations(option.title, option.code),
      priceDelta: priceDelta(option.priceDelta),
      isDefault: option.isDefault === true,
    }));
    const canonicalOptionIds = new Set();
    const selected = ids.map((id) => {
      const option = optionById(options, id);
      if (!option) throw unavailableCart('Один из выбранных вариантов товара больше недоступен');
      const optionKey = option.id || option.code;
      if (canonicalOptionIds.has(optionKey)) throw invalidCart('Не повторяйте один вариант товара');
      canonicalOptionIds.add(optionKey);
      totalDelta += option.priceDelta;
      return option;
    });
    const safeGroup = {
      id: canonicalId(group.id),
      code: canonicalId(group.code),
      title: translations(group.title, group.code),
      selectionType: group.selectionType === 'multiple' ? 'multiple' : 'single',
      required: group.required === true,
      minSelected: minimum,
      maxSelected: maximum,
      options,
    };
    if (selected.length) selectedGroups.push({ ...safeGroup, options: selected });
    return safeGroup;
  });
  if ((item.modifiers || []).some((group) => !usedGroups.has(group.groupId)))
    throw unavailableCart('Выбранные добавки или упаковка больше недоступны');
  return {
    configuration: builder,
    modifiers: selectedGroups,
    options: { configuration: safeConfiguration, modifierGroups: safeGroups },
    requiresSelection,
    missing,
    priceDelta: totalDelta,
    scheduled: Boolean(builderEnabled),
  };
}

function safeProduct(product, language, hasOptions) {
  return {
    id: canonicalId(product.id),
    name: text(product.name),
    description: text(product.description, 2000),
    price: Number(product.price),
    imageUrl: safeImage(product.imageUrl),
    categoryId: canonicalId(product.categoryId),
    unit: text(product.unit || 'шт.', 20),
    quantityStep: Number(product.quantityStep || 1),
    isAvailable: product.isAvailable === true,
    onlineOrderable: product.onlineOrderable !== false,
    availableQuantity: product.availableQuantity == null ? null : Number(product.availableQuantity),
    hasConfigurableOptions: hasOptions,
    ingredients: text(product.ingredients, 3000),
    allergens: (Array.isArray(product.allergens) ? product.allergens : [])
      .slice(0, 30)
      .map((value) => text(value, 80)),
    preparationMinutes: Number(product.preparationMinutes || 15),
    language,
  };
}

const priceFingerprint = (items) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          price: item.price,
          unit: item.unit,
          quantityStep: item.quantityStep,
          configuration: item.configuration,
          modifiers: item.modifiers,
          requiresSelection: item.requiresSelection,
        })),
      ),
    )
    .digest('hex');

function createChatgptCartService({
  loadCatalog = (query) => require('./chatgpt-catalog.service').getFullMenu(query),
  loadOptions = (ids) => require('./product-options.service').getProductOptions(ids),
  loadOrderingConfig = () => require('./online-ordering.service').getOnlineOrderingConfig(),
  env = process.env,
  now = () => Date.now(),
} = {}) {
  async function draftCart(request) {
    const parsed = chatgptCartPrepareSchema.safeParse(request);
    if (!parsed.success) throw invalidCart();
    const input = { ...parsed.data, items: parsed.data.items.map(canonicalSelections) };
    if ((await loadOrderingConfig()).disabled === true)
      throw publicError(503, 'ONLINE_ORDERING_DISABLED', 'Онлайн-заказы временно отключены');
    let snapshot;
    try {
      snapshot = await loadCatalog({
        branchId: input.branchId,
        orderType: input.orderType,
        language: input.language,
      });
    } catch (error) {
      if ([400, 404].includes(error.statusCode)) throw unavailableCart(error.message);
      throw error;
    }
    const branch = snapshot?.branch;
    if (!branch || branch.id !== input.branchId || branch.active === false)
      throw unavailableCart('Выбранная точка больше недоступна');
    if (
      (input.orderType === 'pickup' && branch.pickupEnabled === false) ||
      (input.orderType === 'preorder' && branch.preorderEnabled === false) ||
      (input.orderType === 'delivery' && branch.deliveryEnabled !== true)
    )
      throw unavailableCart('Выбранный способ получения в этой точке недоступен');
    const productMap = new Map(
      (snapshot.products || []).map((product) => [String(product.id), product]),
    );
    const quantities = new Map();
    for (const item of input.items) {
      const quantity = addQuantity(quantities.get(item.id) || 0, item.quantity);
      if (quantity > 99) throw invalidCart('Количество одного товара не может превышать 99');
      quantities.set(item.id, quantity);
    }
    for (const [id, quantity] of quantities) {
      const product = productMap.get(id);
      if (
        !product ||
        product.isAvailable !== true ||
        product.onlineOrderable === false ||
        product.inStopList === true
      )
        throw unavailableCart(
          product
            ? `«${text(product.name)}» сейчас недоступен`
            : 'Один из товаров больше недоступен',
        );
      if (!validQuantity(quantity, { max: 99, step: Number(product.quantityStep || 1) }))
        throw invalidCart('Количество не соответствует единице товара');
      if (
        product.availableQuantity != null &&
        (!Number.isFinite(Number(product.availableQuantity)) ||
          quantity > Number(product.availableQuantity))
      )
        throw unavailableCart(`Недостаточно товара «${text(product.name)}». Обновите корзину.`);
    }
    const optionMap = await loadOptions([...quantities.keys()]);
    const warnings = [];
    const resolvedItems = input.items.map((item) => {
      const product = productMap.get(item.id);
      const options = resolveOptions(item, optionMap.get(item.id), input.language);
      const basePrice = Number(product.price);
      const price = basePrice + options.priceDelta;
      if (
        !Number.isSafeInteger(basePrice) ||
        basePrice <= 0 ||
        !Number.isSafeInteger(price) ||
        price > 10_000_000
      )
        throw unavailableCart('Цена товара временно недоступна');
      if (!validQuantity(item.quantity, { max: 99, step: Number(product.quantityStep || 1) }))
        throw invalidCart('Количество не соответствует единице товара');
      if (options.requiresSelection)
        warnings.push({
          code: 'OPTIONS_REQUIRED',
          productId: item.id,
          message: `Выберите варианты «${text(product.name)}» на сайте Bulka`,
          fields: options.missing,
        });
      if (options.scheduled)
        warnings.push({
          code: 'SCHEDULE_REQUIRED',
          productId: item.id,
          message: 'Время получения настроенного товара выбирается при оформлении',
        });
      return {
        id: item.id,
        quantity: item.quantity,
        product: safeProduct(
          product,
          input.language,
          Boolean(options.configuration || options.options.modifierGroups.length),
        ),
        price,
        basePrice,
        lineTotal: Math.round(price * item.quantity),
        unit: text(product.unit || 'шт.', 20),
        quantityStep: Number(product.quantityStep || 1),
        configuration: options.configuration
          ? Object.fromEntries(
              ['weight', 'filling', 'design']
                .filter((field) => options.configuration[field])
                .map((field) => [field, options.configuration[field].code]),
            )
          : null,
        modifiers: options.modifiers.map((group) => ({
          groupId: group.id || group.code,
          optionIds: group.options.map((option) => option.id || option.code),
        })),
        selectedOptions: {
          configuration: options.configuration,
          modifiers: options.modifiers,
        },
        options: options.options,
        requiresSelection: options.requiresSelection,
      };
    });
    // The ordinary checkout merges identical variant selections before rounding.
    // Keep the anonymous handoff identical and give Flutter one stable cart key.
    const mergedItems = new Map();
    for (const item of resolvedItems) {
      const key = JSON.stringify([item.id, item.configuration, item.modifiers]);
      const existing = mergedItems.get(key);
      if (existing) {
        existing.quantity = addQuantity(existing.quantity, item.quantity);
        existing.lineTotal = Math.round(existing.price * existing.quantity);
      } else mergedItems.set(key, { ...item });
    }
    const items = [...mergedItems.values()];
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    if (!Number.isSafeInteger(subtotal) || subtotal <= 0 || subtotal > 10_000_000)
      throw invalidCart('Некорректная сумма корзины');
    const requiresSelection = items.some((item) => item.requiresSelection);
    return {
      input,
      draft: {
        version: 1,
        branch: {
          id: branch.id,
          name: text(branch.name),
          city: text(branch.city, 100),
          address: text(branch.address, 300),
          hours: safeHours(branch.hours),
          pickupEnabled: branch.pickupEnabled !== false,
          deliveryEnabled: branch.deliveryEnabled === true,
          preorderEnabled: branch.preorderEnabled !== false,
        },
        orderType: input.orderType,
        language: input.language,
        currency: 'KZT',
        items,
        itemSubtotal: requiresSelection ? null : subtotal,
        knownItemSubtotal: subtotal,
        pricingScope: 'items_only',
        requiresSelection,
        warnings,
      },
    };
  }

  function sign(payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', signingKey(env))
      .update(`bc1.${encoded}`)
      .digest('base64url');
    const token = `bc1.${encoded}.${signature}`;
    if (token.length > 8192) throw invalidCart('Слишком много вариантов в одной корзине');
    return token;
  }

  function readToken(token) {
    if (!chatgptCartTokenSchema.safeParse(token).success)
      throw invalidCart('Ссылка на корзину недействительна');
    const [, encoded, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', signingKey(env)).update(`bc1.${encoded}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected))
      throw invalidCart('Ссылка на корзину недействительна');
    let payload;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      throw invalidCart('Ссылка на корзину недействительна');
    }
    const timestamp = Math.floor(now() / 1000);
    if (
      payload?.aud !== TOKEN_AUDIENCE ||
      payload?.purpose !== TOKEN_PURPOSE ||
      payload?.version !== 1 ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      payload.iat > timestamp + 30 ||
      payload.exp - payload.iat !== TOKEN_TTL_SECONDS ||
      !/^[a-f0-9]{64}$/.test(payload.fingerprint || '') ||
      Object.keys(payload).some(
        (key) => !['aud', 'purpose', 'version', 'iat', 'exp', 'cart', 'fingerprint'].includes(key),
      ) ||
      !chatgptCartPrepareSchema.safeParse(payload.cart).success
    )
      throw invalidCart('Ссылка на корзину недействительна');
    if (payload.exp <= timestamp)
      throw publicError(
        410,
        'CHATGPT_CART_EXPIRED',
        'Ссылка на корзину истекла. Соберите её заново в ChatGPT',
      );
    return payload;
  }

  async function prepareCart(request) {
    const { input, draft } = await draftCart(request);
    const iat = Math.floor(now() / 1000);
    const exp = iat + TOKEN_TTL_SECONDS;
    const token = sign({
      aud: TOKEN_AUDIENCE,
      purpose: TOKEN_PURPOSE,
      version: 1,
      iat,
      exp,
      cart: input,
      fingerprint: priceFingerprint(draft.items),
    });
    return {
      ...draft,
      checkoutUrl: `${checkoutOrigin(env)}/?chatgptCart=${token}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  async function resolveCart(token) {
    const payload = readToken(token);
    const { draft } = await draftCart(payload.cart);
    if (payload.exp <= Math.floor(now() / 1000))
      throw publicError(
        410,
        'CHATGPT_CART_EXPIRED',
        'Ссылка на корзину истекла. Соберите её заново в ChatGPT',
      );
    if (payload.fingerprint !== priceFingerprint(draft.items))
      draft.warnings.push({
        code: 'PRICE_UPDATED',
        message: 'Цены или варианты товара обновились. Проверьте корзину перед оформлением',
      });
    return { ...draft, expiresAt: new Date(payload.exp * 1000).toISOString() };
  }

  return { prepareCart, resolveCart };
}

const chatgptCart = createChatgptCartService();
module.exports = {
  TOKEN_TTL_SECONDS,
  createChatgptCartService,
  chatgptCart,
  prepareCart: chatgptCart.prepareCart,
  resolveCart: chatgptCart.resolveCart,
};
