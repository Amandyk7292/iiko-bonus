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
  }

  async getToken() {
    // Если токен жив, возвращаем его (с запасом 5 минут)
    if (this.token && Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.token;
    }

    let url = `${this.baseUrl}/api/1/access_token`;
    let body = { apiLogin: this.apiLogin };

    // Если указаны appId и clientSecret для v2 OAuth
    if (this.appId && this.clientSecret) {
      url = `${this.baseUrl}/api/v2/access_token`;
      body = {
        appId: this.appId,
        clientSecret: this.clientSecret,
        apiKey: this.apiLogin
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка получения токена iiko (${this.appId && this.clientSecret ? 'v2' : 'v1'}): ${errorText}`);
    }

    const data = await response.json();
    this.token = data.token;
    // Токен iikoTransport обычно живет около часа (или больше)
    this.tokenExpiresAt = Date.now() + 60 * 60 * 1000;
    return this.token;
  }

  async getOrganizationId() {
    if (this.organizationId && this.organizationId.includes('-') && this.organizationId.length > 20) {
      return this.organizationId;
    }
    const token = await this.getToken();
    const response = await fetch(`${this.baseUrl}/api/1/organizations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ returnAdditionalInfo: false, includeDisabled: false })
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
        name: name || 'Новый Гость'
      }
    };

    const response = await fetch(`${this.baseUrl}/api/1/loyalty/customers/create_or_update`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка регистрации гостя в iiko: ${errorText}`);
    }

    return await response.json();
  }

  async getMenu() {
    const token = await this.getToken();
    let orgId = await this.getOrganizationId();
    
    let response = await fetch(`${this.baseUrl}/api/1/nomenclature`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ organizationId: orgId })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка получения меню из iiko: ${errorText}`);
    }

    let menuData = await response.json();

    // Если в первой точке пусто (нет товаров или категорий), ищем точку, где меню есть!
    if ((!menuData.products || menuData.products.length === 0) && this.allOrganizations && this.allOrganizations.length > 1) {
      console.log(`В точке ${orgId} нет товаров. Ищем по остальным ${this.allOrganizations.length} точкам...`);
      for (const org of this.allOrganizations) {
        if (org.id === orgId) continue;
        const res = await fetch(`${this.baseUrl}/api/1/nomenclature`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ organizationId: org.id })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.products && data.products.length > 0) {
            console.log(`Найдено меню с ${data.products.length} товарами в точке: ${org.name} (${org.id})`);
            this.organizationId = org.id;
            menuData = data;
            menuData.orgName = org.name;
            break;
          }
        }
      }
    }

    return menuData;
  }
}

module.exports = new IikoAPI();
