const fetch = require('node-fetch');
const crypto = require('crypto');

const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const configurationError = (message) => {
  const error = new Error(message);
  error.code = 'IIKO_ORDER_CONFIGURATION';
  return error;
};

const deterministicUuid = (value) => {
  const bytes = crypto.createHash('sha256').update(String(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const boundedText = (value, maximum) =>
  String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maximum);

const iikoPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith('7')) return `+${digits}`;
  if (digits.length === 10) return `+7${digits}`;
  return '';
};

const finiteCoordinate = (value, minimum, maximum) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
};

const localizedText = (value) => {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value !== 'object' || Array.isArray(value)) return '';
  return value.ru || value.kk || value.en || value.name || value.title || value.label || '';
};

const itemOptionComment = (item) => {
  const parts = [];
  const configuration = item?.configuration;
  if (configuration && typeof configuration === 'object' && !Array.isArray(configuration)) {
    for (const [key, value] of Object.entries(configuration)) {
      const text = localizedText(value);
      if (text) parts.push(`${key}: ${text}`);
    }
  }
  for (const group of Array.isArray(item?.modifiers) ? item.modifiers : []) {
    const title = localizedText(group?.title || group?.name);
    const selected = (Array.isArray(group?.options) ? group.options : [])
      .map((option) => localizedText(option?.title || option?.name || option))
      .filter(Boolean);
    if (selected.length) parts.push(`${title || 'Опции'}: ${selected.join(', ')}`);
  }
  return boundedText(parts.join('; '), 255);
};

const reconcileIikoItems = (order) => {
  const source = Array.isArray(order?.cart_items) ? order.cart_items : [];
  if (!source.length || source.some((item) => !item?.iikoProductId)) {
    throw configurationError('Заказ содержит ручной товар без iiko productId');
  }
  const rows = source.map((item, index) => {
    const amount = Math.max(1, Math.round(Number(item.quantity) || 1));
    const priceCents = Math.max(0, Math.round(Number(item.price || 0) * 100));
    return {
      item,
      index,
      amount,
      weight: Math.max(1, priceCents * amount),
    };
  });
  const targetCents = Math.round(Number(order.amount || 0) * 100);
  if (!Number.isSafeInteger(targetCents) || targetCents <= 0) {
    throw configurationError('У заказа некорректная оплаченная сумма');
  }
  const weightTotal = rows.reduce((sum, row) => sum + row.weight, 0);
  let allocated = 0;
  const allocations = rows.map((row) => {
    const exact = (targetCents * row.weight) / weightTotal;
    const cents = Math.floor(exact);
    allocated += cents;
    return { ...row, cents, remainder: exact - cents };
  });
  allocations
    .slice()
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .slice(0, targetCents - allocated)
    .forEach((row) => {
      allocations[row.index].cents += 1;
    });

  const result = [];
  for (const row of allocations) {
    const lowerPrice = Math.floor(row.cents / row.amount);
    const higherUnits = row.cents - lowerPrice * row.amount;
    const variants = [
      { amount: row.amount - higherUnits, priceCents: lowerPrice, suffix: 'base' },
      { amount: higherUnits, priceCents: lowerPrice + 1, suffix: 'remainder' },
    ].filter((variant) => variant.amount > 0);
    for (const variant of variants) {
      result.push({
        type: 'Product',
        productId: row.item.iikoProductId,
        ...(row.item.productSizeId ? { productSizeId: row.item.productSizeId } : {}),
        amount: variant.amount,
        price: variant.priceCents / 100,
        positionId: deterministicUuid(
          `bulka:item:${order.id || order.operation_id}:${row.index}:${variant.suffix}`,
        ),
        ...(itemOptionComment(row.item) ? { comment: itemOptionComment(row.item) } : {}),
      });
    }
  }
  return result;
};

const iikoOrderInfo = (result) => result?.orderInfo || result?.order || result || {};

const iikoLocalDateTime = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().replace('T', ' ').replace(/Z$/, '');
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?::\d{2})?/);
  return match ? `${match[1]}:00.000` : null;
};

const boundedSeconds = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  const seconds = Number.isFinite(parsed) ? parsed : fallback;
  return Math.round(Math.min(maximum, Math.max(minimum, seconds)));
};

const hasProducts = (menu) => Array.isArray(menu?.products) && menu.products.length > 0;

const hasFinitePrice = (value) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0;

const configuredValue = (configuration, key, environmentKey, fallback = '') =>
  Object.prototype.hasOwnProperty.call(configuration, key)
    ? configuration[key]
    : (process.env[environmentKey] ?? fallback);

class IikoAPI {
  constructor(configuration = {}) {
    this.profileKey =
      String(configuration.profileKey || 'default')
        .trim()
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 40) || 'default';
    this.apiLogin = String(configuredValue(configuration, 'apiLogin', 'IIKO_API_LOGIN')).trim();
    this.appId = String(configuredValue(configuration, 'appId', 'IIKO_APP_ID')).trim();
    this.clientSecret = String(
      configuredValue(configuration, 'clientSecret', 'IIKO_CLIENT_SECRET'),
    ).trim();
    this.organizationId =
      String(configuredValue(configuration, 'organizationId', 'IIKO_ORGANIZATION_ID')).trim() ||
      null;
    this.externalMenuId = String(
      configuredValue(configuration, 'externalMenuId', 'IIKO_EXTERNAL_MENU_ID'),
    ).trim();
    this.externalMenuName = String(
      configuredValue(configuration, 'externalMenuName', 'IIKO_EXTERNAL_MENU_NAME'),
    ).trim();
    this.priceCategoryId = String(
      configuredValue(configuration, 'priceCategoryId', 'IIKO_PRICE_CATEGORY_ID'),
    ).trim();
    this.priceCategoryName = String(
      configuredValue(configuration, 'priceCategoryName', 'IIKO_PRICE_CATEGORY_NAME'),
    ).trim();
    this.terminalGroupId = String(
      configuredValue(configuration, 'terminalGroupId', 'IIKO_TERMINAL_GROUP_ID'),
    ).trim();
    this.terminalGroupsJson = String(
      configuredValue(configuration, 'terminalGroupsJson', 'IIKO_TERMINAL_GROUPS_JSON', '{}'),
    ).trim();
    this.paymentTypeId = String(
      configuredValue(configuration, 'paymentTypeId', 'IIKO_PAYMENT_TYPE_ID'),
    ).trim();
    this.deliveryAddressFormat = ['city', 'legacy'].includes(
      String(configuredValue(configuration, 'deliveryAddressFormat', 'IIKO_ADDRESS_FORMAT', 'city'))
        .trim()
        .toLocaleLowerCase('en-US'),
    )
      ? String(
          configuredValue(configuration, 'deliveryAddressFormat', 'IIKO_ADDRESS_FORMAT', 'city'),
        )
          .trim()
          .toLocaleLowerCase('en-US')
      : 'city';
    this.menuCacheTtlMs =
      boundedSeconds(
        configuredValue(
          configuration,
          'menuCacheTtlSeconds',
          'IIKO_MENU_CACHE_TTL_SECONDS',
          5 * 60,
        ),
        5 * 60,
        30,
        60 * 60,
      ) * 1000;
    this.emptyMenuCacheTtlMs =
      boundedSeconds(
        configuredValue(
          configuration,
          'emptyMenuCacheTtlSeconds',
          'IIKO_EMPTY_MENU_CACHE_TTL_SECONDS',
          60,
        ),
        60,
        15,
        10 * 60,
      ) * 1000;
    this.baseUrl = 'https://api-ru.iiko.services';
    this.token = null;
    this.tokenExpiresAt = 0;
    // Keep prices reasonably fresh. An admin refresh can bypass this cache immediately.
    this.cachedMenu = null;
    this.cachedExternalMenu = null;
    this.cachedMenuExpiresAt = 0;
    this._menuFetchPromise = null; // Мьютекс: одновременно только 1 запрос меню
    this._menuForceRefreshPromise = null;
    // Stop-list changes must reach checkout quickly without one iiko call per client.
    this._cachedStopIds = null;
    this._cachedStopSnapshot = null;
    this._stopListExpiresAt = 0;
    this._stopListPromise = null;
    // Счётчик запросов для мониторинга
    this._apiCallCount = 0;
  }

  async getToken() {
    // Если токен жив, возвращаем его (с запасом 5 минут)
    if (this.token && Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.token;
    }

    const requestToken = (path, body) =>
      fetchWithTimeout(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    let authVersion = 'v1';
    let response = await requestToken('/api/1/access_token', { apiLogin: this.apiLogin });
    let errorText = response.ok ? '' : await response.text();

    // New iiko Cloud API keys explicitly reject the legacy endpoint. The v2
    // endpoint accepts the same full key together with the application's
    // shared App ID and Client Secret.
    if (!response.ok && /use\s+\/api\/v2\/access_token/i.test(errorText)) {
      authVersion = 'v2';
      response = await requestToken('/api/v2/access_token', {
        apiKey: this.apiLogin,
        appId: this.appId,
        clientSecret: this.clientSecret,
      });
      errorText = response.ok ? '' : await response.text();
    }

    if (!response.ok) {
      throw new Error(`Ошибка получения токена iiko (${authVersion}): ${errorText}`);
    }

    const data = await response.json();
    if (!data?.token || typeof data.token !== 'string') {
      throw new Error(`Ошибка получения токена iiko (${authVersion}): токен отсутствует`);
    }
    this.token = data.token;
    // Токен iikoTransport обычно живет около часа (или больше)
    this.tokenExpiresAt = Date.now() + 60 * 60 * 1000;
    return this.token;
  }

  async getOrganizationId() {
    if (
      this.organizationId &&
      this.organizationId.includes('-') &&
      this.organizationId.length > 20
    ) {
      return this.organizationId;
    }
    const token = await this.getToken();
    const response = await fetchWithTimeout(`${this.baseUrl}/api/1/organizations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ returnAdditionalInfo: false, includeDisabled: false }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка получения организаций из iiko: ${errorText}`);
    }
    const data = await response.json();
    if (data.organizations && data.organizations.length > 0) {
      this.allOrganizations = data.organizations;
      if (!this.organizationId) {
        this.organizationId = data.organizations[0].id;
      }
      return this.organizationId;
    }
    throw new Error('Не найдено ни одной организации в iikoCloud для данного apiLogin');
  }

  async registerCustomer(phone, name) {
    const token = await this.getToken();
    const orgId = await this.getOrganizationId();

    // Очищаем телефон (оставляем только цифры, для iiko формат обычно без плюса или с плюсом в зависимости от настроек)
    // По стандарту лучше отправлять как есть, но без пробелов
    const cleanPhone = phone.replace(/[^0-9+]/g, '');

    const payload = {
      organizationId: orgId,
      customer: {
        phone: cleanPhone,
        name: name || 'Новый Гость',
      },
    };

    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/1/loyalty/customers/create_or_update`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка регистрации гостя в iiko: ${errorText}`);
    }

    return await response.json();
  }

  async _runMenuFetch({ requireExternal = false } = {}) {
    if (this._menuFetchPromise) {
      return this._menuFetchPromise;
    }

    const fetchPromise = this._fetchMenuFromIiko({ requireExternal });
    this._menuFetchPromise = fetchPromise;
    try {
      return await fetchPromise;
    } finally {
      if (this._menuFetchPromise === fetchPromise) {
        this._menuFetchPromise = null;
      }
    }
  }

  async _runForcedMenuFetch({ requireExternal = false } = {}) {
    if (this._menuForceRefreshPromise) {
      return this._menuForceRefreshPromise;
    }

    const forceRefreshPromise = (async () => {
      // A force refresh must happen after an already-running normal refresh,
      // rather than silently joining it and returning the result it started with.
      const pendingFetch = this._menuFetchPromise;
      if (pendingFetch) {
        try {
          await pendingFetch;
        } catch {
          // A fresh forced request below is still required after a failed one.
        }
        if (this._menuFetchPromise === pendingFetch) {
          this._menuFetchPromise = null;
        }
      }
      return this._runMenuFetch({ requireExternal });
    })();

    this._menuForceRefreshPromise = forceRefreshPromise;
    try {
      return await forceRefreshPromise;
    } finally {
      if (this._menuForceRefreshPromise === forceRefreshPromise) {
        this._menuForceRefreshPromise = null;
      }
    }
  }

  async getMenu({ strict = false, forceRefresh = false, requireExternal = false } = {}) {
    // 1. Отдаём из кэша если он живой
    if (!forceRefresh && this.cachedMenu && Date.now() < this.cachedMenuExpiresAt) {
      if (
        requireExternal &&
        (this.cachedMenu.menuSource !== 'external-v2' || this.cachedMenu.isStale === true)
      ) {
        throw Object.assign(new Error('Не удалось получить свежее External Menu из iiko.'), {
          statusCode: 503,
        });
      }
      return this.cachedMenu;
    }

    try {
      const result = forceRefresh
        ? await this._runForcedMenuFetch({ requireExternal })
        : await this._runMenuFetch({ requireExternal });
      if (requireExternal && (result?.menuSource !== 'external-v2' || result?.isStale === true)) {
        throw new Error('Не удалось получить свежее External Menu из iiko.');
      }
      return result;
    } catch (error) {
      console.warn('[iiko] Ошибка загрузки меню из iikoCloud:', error.message);
      if (this.cachedMenu && !strict && !requireExternal) {
        console.warn('[iiko] Возвращаем устаревший кэш меню из-за ошибки iiko');
        return this.cachedMenu;
      }
      if (strict || requireExternal) {
        throw Object.assign(new Error('Меню временно недоступно. Повторите попытку позже.'), {
          statusCode: 503,
        });
      }
      // Non-critical background consumers may continue with custom products.
      return { groups: [], products: [] };
    }
  }

  async _fetchNomenclatureMenu(token, organizationId) {
    const response = await fetchWithTimeout(`${this.baseUrl}/api/1/nomenclature`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ organizationId }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка получения меню из iiko: ${errorText}`);
    }
    return response.json();
  }

  _selectExternalMenu(externalMenus) {
    const menus = (Array.isArray(externalMenus) ? externalMenus : []).filter((menu) => menu?.id);
    if (!menus.length) return null;

    if (this.externalMenuId) {
      const byId = menus.find((menu) => String(menu.id) === this.externalMenuId);
      if (!byId) {
        console.warn(
          `[iiko] External Menu с ID ${this.externalMenuId} не найден. Проверьте конфигурацию.`,
        );
      }
      return byId || null;
    }

    if (this.externalMenuName) {
      const configuredName = this.externalMenuName.toLocaleLowerCase('ru-RU');
      const byName = menus.find(
        (menu) =>
          String(menu.name || '')
            .trim()
            .toLocaleLowerCase('ru-RU') === configuredName,
      );
      if (!byName) {
        console.warn(
          `[iiko] External Menu «${this.externalMenuName}» не найдено. Проверьте конфигурацию.`,
        );
      }
      return byName || null;
    }

    if (menus.length > 1) {
      console.warn(
        '[iiko] Доступно несколько External Menu. Используется первое; задайте IIKO_EXTERNAL_MENU_ID.',
      );
    }
    return menus[0];
  }

  _selectPriceCategory(priceCategories) {
    const categories = (Array.isArray(priceCategories) ? priceCategories : []).filter(
      (category) => category?.id,
    );

    if (this.priceCategoryId) {
      const byId = categories.find(
        (category) => String(category.id) === String(this.priceCategoryId),
      );
      if (!byId) {
        throw configurationError(
          `Ценовая категория iiko с ID ${this.priceCategoryId} недоступна для API-логина.`,
        );
      }
      return byId;
    }

    if (this.priceCategoryName) {
      const configuredName = this.priceCategoryName.toLocaleLowerCase('ru-RU');
      const byName = categories.find(
        (category) =>
          String(category.name || '')
            .trim()
            .toLocaleLowerCase('ru-RU') === configuredName,
      );
      if (!byName) {
        throw configurationError(
          `Ценовая категория iiko «${this.priceCategoryName}» недоступна для API-логина.`,
        );
      }
      return byName;
    }

    if (categories.length === 1) return categories[0];
    if (categories.length > 1) {
      console.warn(
        '[iiko] Доступно несколько ценовых категорий. ' +
          'Задайте IIKO_PRICE_CATEGORY_ID, чтобы не выбрать неверную цену.',
      );
    }
    return null;
  }

  _externalPrice(item, organizationId) {
    const visibleSizes = (Array.isArray(item?.itemSizes) ? item.itemSizes : []).filter(
      (size) => size && size.isHidden !== true,
    );
    const sizes = [
      ...visibleSizes.filter((size) => size.isDefault === true),
      ...visibleSizes.filter((size) => size.isDefault !== true),
    ];
    for (const size of sizes) {
      const prices = Array.isArray(size?.prices) ? size.prices : [];
      const matchingOrganization = prices.find((entry) => {
        if (!hasFinitePrice(entry?.price)) return false;
        const directOrganizationId = String(entry?.organizationId || '');
        const groupedOrganizationIds = Array.isArray(entry?.organizations)
          ? entry.organizations.map(String)
          : [];
        return (
          directOrganizationId === String(organizationId) ||
          groupedOrganizationIds.includes(String(organizationId))
        );
      });
      // Some older iiko installations return a single unscoped price. It is
      // safe only when the response does not name another organization.
      const unscopedPrice =
        prices.length === 1 &&
        !prices[0]?.organizationId &&
        (!Array.isArray(prices[0]?.organizations) || prices[0].organizations.length === 0) &&
        hasFinitePrice(prices[0]?.price)
          ? prices[0]
          : null;
      const selected = matchingOrganization || unscopedPrice;
      if (selected) {
        return {
          price: Number(selected.price),
          size,
        };
      }
    }
    return {
      price: hasFinitePrice(item?.price) ? Number(item.price) : 0,
      size: sizes[0] || null,
    };
  }

  _normalizeExternalMenu(selectedMenu, itemsData, organizationId, selectedPriceCategory) {
    if (!itemsData || typeof itemsData !== 'object' || Array.isArray(itemsData)) {
      throw new Error('External Menu вернул некорректный ответ.');
    }
    if (itemsData.formatVersion != null && Number(itemsData.formatVersion) !== 2) {
      throw new Error(`Неподдерживаемая версия External Menu: ${itemsData.formatVersion}`);
    }
    if (!Array.isArray(itemsData.itemCategories)) {
      throw new Error('External Menu V2 не содержит itemCategories.');
    }
    for (const category of itemsData.itemCategories) {
      if (!category || typeof category !== 'object' || !Array.isArray(category.items)) {
        throw new Error('External Menu V2 содержит некорректную категорию.');
      }
      for (const item of category.items) {
        if (!item || typeof item !== 'object' || !Array.isArray(item.itemSizes)) {
          throw new Error('External Menu V2 содержит некорректный товар.');
        }
      }
    }

    const categories = itemsData.itemCategories.filter(
      (category) =>
        category &&
        category.isHidden !== true &&
        String(category.id || category.iikoGroupId || '').trim(),
    );
    const groups = categories.map((category, index) => ({
      id: category.id || category.iikoGroupId,
      name: category.name,
      order: index,
      imageLinks: category.buttonImageUrl ? [category.buttonImageUrl] : [],
    }));
    const products = [];
    for (const category of categories) {
      for (const item of Array.isArray(category?.items) ? category.items : []) {
        if (!item || item.isHidden === true) continue;
        const itemId = String(item.itemId || item.id || '').trim();
        if (!itemId) continue;
        const pricedSize = this._externalPrice(item, organizationId);
        const imageUrl = item.buttonImageUrl || pricedSize.size?.buttonImageUrl;
        products.push({
          id: itemId,
          name: item.name,
          description: item.description || '',
          parentGroup: category.id || category.iikoGroupId,
          type: item.orderItemType === 'Product' ? 'Good' : 'Dish',
          sizePrices: [
            {
              sizeId: pricedSize.size?.id || pricedSize.size?.sizeId || null,
              price: { currentPrice: pricedSize.price },
            },
          ],
          imageLinks: imageUrl ? [imageUrl] : [],
          weight: pricedSize.size?.portionWeightGrams || 0,
          sku: item.sku || '',
        });
      }
    }
    console.log(
      `[iiko] External Menu «${selectedMenu.name || selectedMenu.id}»: ` +
        `${groups.length} категорий, ${products.length} товаров; источник цен: ` +
        `${
          selectedPriceCategory
            ? `категория «${selectedPriceCategory.name || selectedPriceCategory.id}»`
            : 'External Menu'
        }`,
    );
    return {
      groups,
      products,
      orgName: `${selectedMenu.name || selectedMenu.id} (External v2)`,
      externalMenuId: String(selectedMenu.id),
      priceCategoryId: selectedPriceCategory ? String(selectedPriceCategory.id) : null,
      priceCategoryName: selectedPriceCategory?.name || null,
      priceSource: selectedPriceCategory ? 'price-category' : 'external-menu',
      menuSource: 'external-v2',
      fetchedAt: new Date().toISOString(),
    };
  }

  async _fetchExternalMenu(token, organizationId) {
    const listResponse = await fetchWithTimeout(`${this.baseUrl}/api/2/menu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ organizationIds: [organizationId] }),
    });
    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      throw new Error(`Ошибка получения списка External Menu: ${errorText}`);
    }
    const listData = await listResponse.json();
    if (
      !listData ||
      typeof listData !== 'object' ||
      Array.isArray(listData) ||
      !Object.prototype.hasOwnProperty.call(listData, 'externalMenus') ||
      (listData.externalMenus !== null && !Array.isArray(listData.externalMenus)) ||
      (listData.priceCategories !== undefined &&
        listData.priceCategories !== null &&
        !Array.isArray(listData.priceCategories))
    ) {
      throw new Error('Список External Menu вернул некорректный ответ.');
    }
    const selectedMenu = this._selectExternalMenu(listData.externalMenus || []);
    if (!selectedMenu) return null;
    const selectedPriceCategory = this._selectPriceCategory(listData.priceCategories || []);

    const itemsResponse = await fetchWithTimeout(`${this.baseUrl}/api/2/menu/by_id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        externalMenuId: selectedMenu.id,
        organizationIds: [organizationId],
        priceCategoryId: selectedPriceCategory?.id || null,
        version: 2,
      }),
    });
    if (!itemsResponse.ok) {
      const errorText = await itemsResponse.text();
      throw new Error(`Ошибка получения External Menu: ${errorText}`);
    }
    return this._normalizeExternalMenu(
      selectedMenu,
      await itemsResponse.json(),
      organizationId,
      selectedPriceCategory,
    );
  }

  async _fetchMenuFromIiko({ requireExternal = false } = {}) {
    this._apiCallCount++;
    console.log(`[iiko] Запрос меню #${this._apiCallCount} в ${new Date().toISOString()}`);

    const token = await this.getToken();
    const organizationId = await this.getOrganizationId();
    let externalMenu = null;
    let externalError = null;
    try {
      externalMenu = await this._fetchExternalMenu(token, organizationId);
    } catch (error) {
      externalError = error;
      console.warn('[iiko] External Menu v2 недоступно:', error.message);
    }

    let nomenclatureMenu = null;
    let nomenclatureError = null;
    const externalSourceConfigured = Boolean(this.externalMenuId || this.externalMenuName);
    const canUseNomenclature =
      !externalMenu &&
      !requireExternal &&
      !this.cachedExternalMenu &&
      !externalError &&
      !externalSourceConfigured;
    if (canUseNomenclature) {
      try {
        const response = await this._fetchNomenclatureMenu(token, organizationId);
        nomenclatureMenu = {
          ...response,
          menuSource: 'nomenclature-v1',
          fetchedAt: new Date().toISOString(),
        };
      } catch (error) {
        nomenclatureError = error;
        console.warn('[iiko] Nomenclature v1 недоступна:', error.message);
      }
    }

    let menuData;
    if (externalMenu) {
      menuData = externalMenu;
    } else if (requireExternal) {
      throw (
        externalError ||
        Object.assign(new Error('Опубликованное External Menu не найдено.'), {
          statusCode: 503,
        })
      );
    } else if (this.cachedExternalMenu) {
      console.warn(
        '[iiko] Сохраняем последнее корректное External Menu; nomenclature v1 не подменяет опубликованное меню.',
      );
      menuData = {
        ...this.cachedExternalMenu,
        isStale: true,
        staleReason: externalError ? 'external-menu-unavailable' : 'external-menu-not-found',
      };
    } else if (nomenclatureMenu) {
      menuData = nomenclatureMenu;
    } else {
      throw externalError || nomenclatureError || new Error('Меню iiko недоступно');
    }

    menuData = {
      ...menuData,
      profileKey: this.profileKey,
      organizationId,
    };

    // Очищаем названия товаров и категорий от служебных символов iiko (например "Плюшка+++", "Круассан +")
    const cleanIikoName = (name) => {
      if (!name || typeof name !== 'string') return '';
      return name
        .replace(/\+{2,}/g, '') // Убираем ++, +++
        .replace(/\+$/g, '') // Убираем один + в конце строки
        .replace(/\s{2,}/g, ' ') // Убираем двойные пробелы
        .trim();
    };

    const publicId = (value) => {
      const normalized = String(value || '').trim();
      if (!normalized || this.profileKey === 'default') return normalized;
      const prefix = `${this.profileKey}:`;
      return normalized.startsWith(prefix) ? normalized : `${prefix}${normalized}`;
    };
    if (menuData && menuData.products) {
      menuData.products = menuData.products.map((product) => {
        const iikoProductId = String(product.iikoProductId || product.id || '').trim();
        const iikoParentGroupId = String(
          product.iikoParentGroupId || product.parentGroup || '',
        ).replace(new RegExp(`^${this.profileKey}:`), '');
        return {
          ...product,
          id: publicId(iikoProductId),
          iikoProductId,
          parentGroup: publicId(iikoParentGroupId),
          iikoParentGroupId,
          name: cleanIikoName(product.name),
        };
      });
    }
    if (menuData && menuData.groups) {
      menuData.groups = menuData.groups.map((group) => {
        const iikoCategoryId = String(group.iikoCategoryId || group.id || '').replace(
          new RegExp(`^${this.profileKey}:`),
          '',
        );
        return {
          ...group,
          id: publicId(iikoCategoryId),
          iikoCategoryId,
          name: cleanIikoName(group.name),
        };
      });
    }

    if (menuData.menuSource === 'external-v2' && menuData.isStale !== true) {
      this.cachedExternalMenu = menuData;
    }

    // Кешируем ЛЮБОЙ ответ (даже пустой), чтобы не получить бан от API
    this.cachedMenu = menuData;
    if (menuData.isStale === true) {
      this.cachedMenuExpiresAt = Date.now() + this.emptyMenuCacheTtlMs;
      console.log(
        `[iiko] Устаревшее External Menu кэшировано на ${Math.round(
          this.emptyMenuCacheTtlMs / 1000,
        )} сек. до следующей попытки.`,
      );
    } else if (hasProducts(menuData)) {
      this.cachedMenuExpiresAt = Date.now() + this.menuCacheTtlMs;
      console.log(
        `[iiko] Меню закэшировано: ${menuData.products.length} товаров на ` +
          `${Math.round(this.menuCacheTtlMs / 1000)} сек.`,
      );
    } else {
      this.cachedMenuExpiresAt = Date.now() + this.emptyMenuCacheTtlMs;
      console.log(
        `[iiko] Меню пустое, кэшировано на ${Math.round(this.emptyMenuCacheTtlMs / 1000)} сек.`,
      );
    }

    return menuData;
  }

  async getStopListSnapshot(organizationId, { strict = false } = {}) {
    // Кэш стоп-листа на 5 минут
    if (this._cachedStopSnapshot && Date.now() < this._stopListExpiresAt) {
      return this._cachedStopSnapshot;
    }
    // Мьютекс для стоп-листа
    if (this._stopListPromise) {
      return this._stopListPromise;
    }
    this._stopListPromise = this._fetchStopList(organizationId);
    try {
      return await this._stopListPromise;
    } catch (error) {
      console.error('Ошибка получения стоп-листа из iiko:', error.message);
      if (strict) throw error;
      return (
        this._cachedStopSnapshot || {
          stopIds: this._cachedStopIds || new Set(),
          groups: [],
          fetchedAt: null,
        }
      );
    } finally {
      this._stopListPromise = null;
    }
  }

  async _fetchStopList(organizationId) {
    this._apiCallCount++;
    console.log(`[iiko] Запрос стоп-листа #${this._apiCallCount}`);
    const token = await this.getToken();
    const orgId = organizationId || (await this.getOrganizationId());
    const res = await fetchWithTimeout(`${this.baseUrl}/api/1/stop_lists`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ organizationIds: [orgId] }),
    });
    if (!res.ok) {
      throw new Error(`iiko stop list returned ${res.status}`);
    }
    const data = await res.json();
    const stopIds = new Set();
    const groups = (
      Array.isArray(data.terminalGroupStopLists) ? data.terminalGroupStopLists : []
    ).map((group) => {
      const items = (Array.isArray(group?.items) ? group.items : [])
        .map((item) => ({
          productId: String(item?.productId || '').trim(),
          balance: Number(item?.balance),
        }))
        .filter((item) => item.productId && Number.isFinite(item.balance));
      for (const item of items) {
        if (item.balance <= 0) stopIds.add(item.productId);
      }
      return {
        organizationId: String(group?.organizationId || '').trim() || null,
        terminalGroupId: String(group?.terminalGroupId || '').trim() || null,
        items,
      };
    });
    const snapshot = { stopIds, groups, fetchedAt: new Date().toISOString() };
    this._cachedStopIds = stopIds;
    this._cachedStopSnapshot = snapshot;
    this._stopListExpiresAt = Date.now() + 30 * 1000;
    console.log(`[iiko] Стоп-лист: ${stopIds.size} позиций, кэш 30 сек`);
    return snapshot;
  }

  async getStopListProductIds(organizationId, { strict = false } = {}) {
    const snapshot = await this.getStopListSnapshot(organizationId, { strict });
    return snapshot.stopIds;
  }

  async createDeliveryOrder(order) {
    if (process.env.IIKO_ORDER_EXPORT_ENABLED !== 'true') {
      throw configurationError('Автоматическая отправка заказов в iiko отключена');
    }
    const paymentTypeId = this.paymentTypeId;
    let terminalGroupId = this.terminalGroupId;
    let terminalGroups;
    try {
      terminalGroups = JSON.parse(this.terminalGroupsJson || '{}');
    } catch {
      throw configurationError('IIKO_TERMINAL_GROUPS_JSON содержит некорректный JSON');
    }
    if (!terminalGroups || typeof terminalGroups !== 'object' || Array.isArray(terminalGroups)) {
      throw configurationError('IIKO_TERMINAL_GROUPS_JSON должен содержать JSON-объект');
    }
    const configuredBranchTerminal =
      terminalGroups[String(order.branch_id || '')] || terminalGroups[order.branch_name];
    if (Object.keys(terminalGroups).length > 0 && !configuredBranchTerminal) {
      throw configurationError(`Для филиала «${order.branch_name}» не задан terminalGroupId`);
    }
    terminalGroupId = configuredBranchTerminal || terminalGroupId;
    if (!terminalGroupId || !paymentTypeId) {
      throw configurationError(
        'Для отправки заказа нужны IIKO_TERMINAL_GROUP_ID и IIKO_PAYMENT_TYPE_ID',
      );
    }

    const token = await this.getToken();
    const organizationId = await this.getOrganizationId();
    const completeBefore = iikoLocalDateTime(
      order.scheduled_at || order.pickup_time || order.promised_ready_at,
    );
    const phone = iikoPhone(order.additional_phone || order.phone || order.customers?.phone);
    if (!phone) throw configurationError('У клиента некорректный номер телефона для iiko');
    const deliveryLatitude = finiteCoordinate(order.delivery_latitude, -90, 90);
    const deliveryLongitude = finiteCoordinate(order.delivery_longitude, -180, 180);
    if (deliveryLatitude == null || deliveryLongitude == null) {
      throw configurationError('У заказа некорректные координаты доставки для iiko');
    }
    const address =
      order.delivery_address && typeof order.delivery_address === 'object'
        ? order.delivery_address
        : {};
    const city = boundedText(address.city || order.bulka_locations?.city, 60);
    const rawAddress = boundedText(
      address.address || address.fullname || address.fullAddress || address.label,
      250,
    );
    if (!rawAddress) throw configurationError('У заказа не заполнен адрес доставки');
    const line1 = rawAddress.toLocaleLowerCase('ru-RU').includes(city.toLocaleLowerCase('ru-RU'))
      ? rawAddress
      : [city, rawAddress].filter(Boolean).join(', ').slice(0, 250);
    const addressPayload =
      this.deliveryAddressFormat === 'legacy'
        ? {
            type: 'legacy',
            street: { name: rawAddress.slice(0, 60), ...(city ? { city } : {}) },
            house: boundedText(address.house, 80),
            ...(address.apartment ? { flat: boundedText(address.apartment, 10) } : {}),
            ...(address.entrance ? { entrance: boundedText(address.entrance, 10) } : {}),
            ...(address.floor ? { floor: boundedText(address.floor, 10) } : {}),
            ...(address.doorphone ? { doorphone: boundedText(address.doorphone, 10) } : {}),
          }
        : {
            type: 'city',
            line1,
            ...(address.apartment ? { flat: boundedText(address.apartment, 10) } : {}),
            ...(address.entrance ? { entrance: boundedText(address.entrance, 10) } : {}),
            ...(address.floor ? { floor: boundedText(address.floor, 10) } : {}),
            ...(address.doorphone ? { doorphone: boundedText(address.doorphone, 10) } : {}),
          };
    const customerName = boundedText(order.customers?.name || 'Клиент Bulka', 60);
    const priceNote =
      Number(order.subtotal || 0) !== Number(order.amount || 0)
        ? `Оплачено онлайн: ${Number(order.amount || 0).toFixed(2)} ₸; товары: ${Number(
            order.subtotal || 0,
          ).toFixed(2)} ₸; скидка: ${Number(order.discount_amount || 0).toFixed(
            2,
          )} ₸; доставка: ${Number(order.delivery_fee || 0).toFixed(2)} ₸.`
        : '';
    const orderComment = [
      'ДОСТАВКА: ТОЛЬКО АВТОКУРЬЕР. Термосумка обязательна.',
      order.branch_name ? `Забрать в Bulka «${order.branch_name}».` : '',
      priceNote,
      order.comment,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 1000);
    const payload = {
      organizationId,
      terminalGroupId,
      createOrderSettings: { transportToFrontTimeout: 15, checkStopList: true },
      order: {
        id: deterministicUuid(`bulka:${order.id || order.operation_id}`),
        externalNumber: `Bulka-${order.order_number || order.operation_id}`.slice(0, 50),
        phone,
        orderServiceType: 'DeliveryByCourier',
        deliveryPoint: {
          coordinates: {
            latitude: deliveryLatitude,
            longitude: deliveryLongitude,
          },
          address: addressPayload,
          comment: boundedText(address.comment || order.comment, 500),
        },
        completeBefore,
        comment: orderComment,
        customer: { type: 'one-time', name: customerName },
        sourceKey: 'bulka-bonus-web',
        items: reconcileIikoItems(order),
        payments: [
          {
            paymentTypeKind: 'External',
            sum: Number(order.amount),
            paymentTypeId,
            isProcessedExternally: true,
            isFiscalizedExternally: false,
            isPrepay: true,
          },
        ],
        externalData: [
          { key: 'bulkaOrderId', value: String(order.id), isPublic: true },
          { key: 'courierTransport', value: 'car', isPublic: true },
        ],
      },
    };

    const priceCategoryId = String(
      this.cachedExternalMenu?.priceCategoryId ||
        this.cachedMenu?.priceCategoryId ||
        this.priceCategoryId ||
        '',
    ).trim();
    if (priceCategoryId) payload.order.priceCategoryId = priceCategoryId;
    if (this.externalMenuId) payload.order.menuId = this.externalMenuId;
    if (!completeBefore) delete payload.order.completeBefore;

    const response = await fetchWithTimeout(`${this.baseUrl}/api/1/deliveries/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Timeout: '20',
      },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { message: responseText };
    }
    const orderInfo = iikoOrderInfo(result);
    const errorInfo = result?.errorInfo || orderInfo?.errorInfo;
    const creationStatus = String(orderInfo?.creationStatus || '');
    if (!response.ok || errorInfo || /error|failed/i.test(creationStatus)) {
      throw new Error(
        `iiko не принял заказ: ${
          errorInfo?.message ||
          errorInfo?.description ||
          result?.message ||
          creationStatus ||
          response.status
        }`,
      );
    }
    return result;
  }

  async getDeliveryOrdersByIds(orderIds = []) {
    const ids = [...new Set(orderIds.map(String).filter(Boolean))].slice(0, 100);
    if (!ids.length) return [];
    const token = await this.getToken();
    const organizationId = await this.getOrganizationId();
    const response = await fetchWithTimeout(`${this.baseUrl}/api/1/deliveries/by_id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ organizationId, orderIds: ids }),
    });
    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { message: responseText };
    }
    if (!response.ok) {
      throw new Error(`iiko не вернул статусы доставок: ${result?.message || response.status}`);
    }
    return Array.isArray(result?.orders) ? result.orders : [];
  }

  // Принудительный сброс кэша (для админа)
  invalidateMenuCache() {
    this.cachedMenu = null;
    this.cachedMenuExpiresAt = 0;
    this._cachedStopIds = null;
    this._cachedStopSnapshot = null;
    this._stopListExpiresAt = 0;
    console.log('[iiko] Кэш меню и стоп-листа сброшен');
  }
}

const defaultIikoApi = new IikoAPI();

module.exports = defaultIikoApi;
module.exports.IikoAPI = IikoAPI;
module.exports.deterministicUuid = deterministicUuid;
module.exports.iikoOrderInfo = iikoOrderInfo;
module.exports.reconcileIikoItems = reconcileIikoItems;
