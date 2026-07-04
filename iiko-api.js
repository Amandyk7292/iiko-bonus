const fetch = require('node-fetch'); // Используем node-fetch для надежности, если версия Node старая

class IikoAPI {
  constructor() {
    this.apiLogin = process.env.IIKO_API_LOGIN;
    this.organizationId = process.env.IIKO_APP_ID;
    this.baseUrl = 'https://api-ru.iiko.services';
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async getToken() {
    // Если токен жив, возвращаем его (с запасом 5 минут)
    if (this.token && Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.token;
    }

    const response = await fetch(`${this.baseUrl}/api/1/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiLogin: this.apiLogin })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка получения токена iiko: ${errorText}`);
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
      this.organizationId = data.organizations[0].id;
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
    const orgId = await this.getOrganizationId();
    
    const payload = {
      organizationId: orgId
    };

    const response = await fetch(`${this.baseUrl}/api/1/nomenclature`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка получения меню из iiko: ${errorText}`);
    }

    return await response.json();
  }
}

module.exports = new IikoAPI();
