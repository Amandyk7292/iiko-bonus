const fetch = require('node-fetch'); // Используем node-fetch для надежности, если версия Node старая

class IikoAPI {
  constructor() {
    this.apiLogin = process.env.IIKO_API_LOGIN;
    this.appId = process.env.IIKO_APP_ID;
    this.clientSecret = process.env.IIKO_CLIENT_SECRET;
    this.organizationId = process.env.IIKO_ORGANIZATION_ID || null;
    this.baseUrl = 'https://api-ru.iiko.services';
    this.token = null;
    this.tokenExpiresAt = 0;
    this.cachedMenu = null;
    this.cachedMenuExpiresAt = 0;
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
    if (this.cachedMenu && Date.now() < this.cachedMenuExpiresAt) {
      return this.cachedMenu;
    }

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

    // Кешируем ЛЮБОЙ ответ (даже пустой), чтобы не получить бан от API при спаме запросами
    this.cachedMenu = menuData;
    if (menuData && menuData.products && menuData.products.length > 0) {
      this.cachedMenuExpiresAt = Date.now() + 30 * 60 * 1000; // Кешируем на 30 минут если есть данные
    } else {
      this.cachedMenuExpiresAt = Date.now() + 3 * 60 * 1000; // Кешируем пустоту на 3 минуты (защита от rate limit банa)
    }

    return menuData;
  }

  async getStopListProductIds(organizationId) {
    try {
      const token = await this.getToken();
      const orgId = organizationId || await this.getOrganizationId();
      const res = await fetch(`${this.baseUrl}/api/1/stop_lists`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ organizationIds: [orgId] }),
      });
      if (!res.ok) return new Set();
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
      return stopIds;
    } catch (err) {
      console.error('Ошибка получения стоп-листа из iiko:', err.message);
      return new Set();
    }
  }
}

module.exports = new IikoAPI();
