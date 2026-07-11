const fetch = require('node-fetch');

class IikoAPI {
  constructor() {
    this.apiLogin = process.env.IIKO_API_LOGIN;
    this.appId = process.env.IIKO_APP_ID;
    this.clientSecret = process.env.IIKO_CLIENT_SECRET;
    this.organizationId = process.env.IIKO_ORGANIZATION_ID || null;
    this.baseUrl = 'https://api-ru.iiko.services';
    this.token = null;
    this.tokenExpiresAt = 0;
    // Кэш меню: 2 часа для данных, 5 минут для пустоты
    this.cachedMenu = null;
    this.cachedMenuExpiresAt = 0;
    this._menuFetchPromise = null; // Мьютекс: одновременно только 1 запрос меню
    // Кэш стоп-листа: 5 минут
    this._cachedStopIds = null;
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

    let url = `${this.baseUrl}/api/1/access_token`;
    let body = { apiLogin: this.apiLogin };

    // Если указаны appId и clientSecret для новой OAuth авторизации (с 01.06.2026)
    if (this.appId && this.clientSecret) {
      url = `${this.baseUrl}/api/v2/access_token`;
      body = {
        appId: this.appId,
        clientSecret: this.clientSecret,
        apiLogin: this.apiLogin,
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Ошибка получения токена iiko (${this.appId && this.clientSecret ? 'v2' : 'v1'}): ${errorText}`,
      );
    }

    const data = await response.json();
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
    const response = await fetch(`${this.baseUrl}/api/1/organizations`, {
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

    const response = await fetch(`${this.baseUrl}/api/1/loyalty/customers/create_or_update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка регистрации гостя в iiko: ${errorText}`);
    }

    return await response.json();
  }

  async getMenu() {
    // 1. Отдаём из кэша если он живой
    if (this.cachedMenu && Date.now() < this.cachedMenuExpiresAt) {
      return this.cachedMenu;
    }
    // 2. Мьютекс: если уже идёт запрос — ждём его, а не делаем параллельный
    if (this._menuFetchPromise) {
      return this._menuFetchPromise;
    }
    this._menuFetchPromise = this._fetchMenuFromIiko();
    try {
      const result = await this._menuFetchPromise;
      return result;
    } catch (error) {
      console.warn('[iiko] Ошибка загрузки меню из iikoCloud:', error.message);
      if (this.cachedMenu) {
        console.warn('[iiko] Возвращаем устаревший кэш меню из-за ошибки iiko');
        return this.cachedMenu;
      }
      // Возвращаем пустую структуру вместо падения, чтобы работали кастомные блюда
      return { groups: [], products: [] };
    } finally {
      this._menuFetchPromise = null;
    }
  }

  async _fetchMenuFromIiko() {
    this._apiCallCount++;
    console.log(`[iiko] Запрос меню #${this._apiCallCount} в ${new Date().toISOString()}`);

    const token = await this.getToken();
    let orgId = await this.getOrganizationId();

    let response = await fetch(`${this.baseUrl}/api/1/nomenclature`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ organizationId: orgId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка получения меню из iiko: ${errorText}`);
    }

    let menuData = await response.json();

    // Если по-прежнему пусто, проверяем внешние меню (External Menus v2 API)
    if (!menuData.products || menuData.products.length === 0) {
      console.log('Номенклатура v1 пуста. Проверяем External Menus (/api/2/menu)...');
      try {
        const extRes = await fetch(`${this.baseUrl}/api/2/menu`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ organizationIds: [orgId] }),
        });
        if (extRes.ok) {
          const extData = await extRes.json();
          if (extData.externalMenus && extData.externalMenus.length > 0) {
            const extMenuId = extData.externalMenus[0].id;
            console.log('Найдено Внешнее Меню:', extData.externalMenus[0].name, extMenuId);
            const itemsRes = await fetch(`${this.baseUrl}/api/2/menu/by_id`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                externalMenuId: extMenuId,
                organizationIds: [orgId],
                priceCategoryId: null,
              }),
            });
            if (itemsRes.ok) {
              const itemsData = await itemsRes.json();
              // В API v2 блюда вложены внутрь itemCategories[].items[]
              const categories = itemsData.itemCategories || [];
              const groups = categories.map((c, idx) => ({
                id: c.id || c.iikoGroupId,
                name: c.name,
                order: idx,
                imageLinks: c.buttonImageUrl ? [c.buttonImageUrl] : [],
              }));
              const products = [];
              for (const cat of categories) {
                if (!cat.items) continue;
                for (const i of cat.items) {
                  let price = 0;
                  let imageUrl = i.buttonImageUrl;
                  if (i.itemSizes && i.itemSizes.length > 0) {
                    if (i.itemSizes[0].prices && i.itemSizes[0].prices.length > 0) {
                      price = i.itemSizes[0].prices[0].price;
                    }
                    if (!imageUrl) imageUrl = i.itemSizes[0].buttonImageUrl;
                  }
                  products.push({
                    id: i.itemId || i.id,
                    name: i.name,
                    description: i.description || '',
                    parentGroup: cat.id || cat.iikoGroupId,
                    type: i.orderItemType === 'Product' ? 'Good' : 'Dish',
                    sizePrices: [{ price: { currentPrice: price } }],
                    imageLinks: imageUrl ? [imageUrl] : [],
                    weight: i.itemSizes?.[0]?.portionWeightGrams || 0,
                    sku: i.sku || '',
                  });
                }
              }
              console.log(
                `Загружено из Внешнего Меню v2: ${groups.length} категорий, ${products.length} товаров`,
              );
              menuData = {
                groups,
                products,
                orgName: extData.externalMenus[0].name + ' (External v2)',
              };
            }
          }
        }
      } catch (err) {
        console.error('Ошибка проверки внешнего меню v2:', err.message);
      }
    }

    // Очищаем названия товаров и категорий от служебных символов iiko (например "Плюшка+++", "Круассан +")
    const cleanIikoName = (name) => {
      if (!name || typeof name !== 'string') return '';
      return name
        .replace(/\+{2,}/g, '') // Убираем ++, +++
        .replace(/\+$/g, '')    // Убираем один + в конце строки
        .replace(/\s{2,}/g, ' ') // Убираем двойные пробелы
        .trim();
    };

    if (menuData && menuData.products) {
      menuData.products = menuData.products.map(p => ({
        ...p,
        name: cleanIikoName(p.name),
      }));
    }
    if (menuData && menuData.groups) {
      menuData.groups = menuData.groups.map(g => ({
        ...g,
        name: cleanIikoName(g.name),
      }));
    }

    // Кешируем ЛЮБОЙ ответ (даже пустой), чтобы не получить бан от API
    this.cachedMenu = menuData;
    if (menuData && menuData.products && menuData.products.length > 0) {
      this.cachedMenuExpiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2 часа для валидного меню
      console.log(`[iiko] Меню закэшировано: ${menuData.products.length} товаров на 2 часа`);
    } else {
      this.cachedMenuExpiresAt = Date.now() + 5 * 60 * 1000; // 5 минут для пустоты
      console.log('[iiko] Меню пустое, кэшировано на 5 минут');
    }

    return menuData;
  }

  async getStopListProductIds(organizationId) {
    // Кэш стоп-листа на 5 минут
    if (this._cachedStopIds && Date.now() < this._stopListExpiresAt) {
      return this._cachedStopIds;
    }
    // Мьютекс для стоп-листа
    if (this._stopListPromise) {
      return this._stopListPromise;
    }
    this._stopListPromise = this._fetchStopList(organizationId);
    try {
      return await this._stopListPromise;
    } finally {
      this._stopListPromise = null;
    }
  }

  async _fetchStopList(organizationId) {
    try {
      this._apiCallCount++;
      console.log(`[iiko] Запрос стоп-листа #${this._apiCallCount}`);
      const token = await this.getToken();
      const orgId = organizationId || (await this.getOrganizationId());
      const res = await fetch(`${this.baseUrl}/api/1/stop_lists`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ organizationIds: [orgId] }),
      });
      if (!res.ok) {
        this._cachedStopIds = new Set();
        this._stopListExpiresAt = Date.now() + 2 * 60 * 1000;
        return this._cachedStopIds;
      }
      const data = await res.json();
      const stopIds = new Set();
      if (data.terminalGroupStopLists) {
        for (const group of data.terminalGroupStopLists) {
          if (group.items) {
            for (const item of group.items) {
              if (item.balance <= 0 && item.productId) {
                stopIds.add(item.productId);
              }
            }
          }
        }
      }
      this._cachedStopIds = stopIds;
      this._stopListExpiresAt = Date.now() + 5 * 60 * 1000; // 5 минут кэш
      console.log(`[iiko] Стоп-лист: ${stopIds.size} позиций, кэш 5 мин`);
      return stopIds;
    } catch (err) {
      console.error('Ошибка получения стоп-листа из iiko:', err.message);
      return this._cachedStopIds || new Set();
    }
  }

  // Принудительный сброс кэша (для админа)
  invalidateMenuCache() {
    this.cachedMenu = null;
    this.cachedMenuExpiresAt = 0;
    this._cachedStopIds = null;
    this._stopListExpiresAt = 0;
    console.log('[iiko] Кэш меню и стоп-листа сброшен');
  }
}

module.exports = new IikoAPI();
