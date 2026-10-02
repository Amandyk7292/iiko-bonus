const { otpError } = require('../utils/customer-otp.util');

const UNAVAILABLE = 'Подтверждение номера временно недоступно. Попробуйте позже.';

function customerOtpProvider(env = process.env) {
  const provider = String(env.CUSTOMER_OTP_PROVIDER || 'legacy_whatsapp').trim();
  if (!['legacy_whatsapp', 'whatsapp_cloud', 'ycloud_whatsapp', 'mobizon_sms'].includes(provider)) {
    throw otpError(UNAVAILABLE, 503, 'OTP_PROVIDER_UNAVAILABLE');
  }
  return provider;
}

function otpProviderConfig(env = process.env) {
  const provider = customerOtpProvider(env);
  if (provider === 'legacy_whatsapp') return { provider };
  if (provider === 'ycloud_whatsapp') {
    const apiKey = String(env.YCLOUD_API_KEY || '').trim();
    const sender = String(env.YCLOUD_WHATSAPP_SENDER || '').trim();
    const template = String(env.WHATSAPP_AUTH_TEMPLATE_NAME || '').trim();
    const language = String(env.WHATSAPP_AUTH_TEMPLATE_LANGUAGE || 'ru').trim();
    if (
      !apiKey ||
      !/^\+7[67]\d{9}$/.test(sender) ||
      !/^[a-z0-9_]{1,512}$/.test(template) ||
      !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)
    ) {
      throw otpError(UNAVAILABLE, 503, 'OTP_PROVIDER_UNAVAILABLE');
    }
    return { provider, apiKey, sender, template, language };
  }
  if (provider === 'whatsapp_cloud') {
    const version = String(env.WHATSAPP_CLOUD_API_VERSION || '').trim();
    const phoneId = String(env.WHATSAPP_CLOUD_PHONE_NUMBER_ID || '').trim();
    const token = String(env.WHATSAPP_CLOUD_ACCESS_TOKEN || '').trim();
    const template = String(env.WHATSAPP_AUTH_TEMPLATE_NAME || '').trim();
    const language = String(env.WHATSAPP_AUTH_TEMPLATE_LANGUAGE || 'ru').trim();
    if (
      !/^v\d{1,3}\.0$/.test(version) ||
      !/^\d{5,40}$/.test(phoneId) ||
      !token ||
      !/^[a-z0-9_]{1,512}$/.test(template) ||
      !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)
    ) {
      throw otpError(UNAVAILABLE, 503, 'OTP_PROVIDER_UNAVAILABLE');
    }
    return { provider, version, phoneId, token, template, language };
  }
  const apiKey = String(env.MOBIZON_API_KEY || '').trim();
  const sender = String(env.MOBIZON_SMS_SENDER || '').trim();
  if (!apiKey || !/^[A-Za-z0-9]{1,11}$/.test(sender)) {
    throw otpError(UNAVAILABLE, 503, 'OTP_PROVIDER_UNAVAILABLE');
  }
  return { provider, apiKey, sender };
}

function authenticationTemplate(config, code) {
  return {
    name: config.template,
    language: {
      code: config.language,
      ...(config.provider === 'ycloud_whatsapp' ? { policy: 'deterministic' } : {}),
    },
    components: [
      { type: 'body', parameters: [{ type: 'text', text: code }] },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: code }],
      },
    ],
  };
}

async function sendAutomaticOtp({ phone, code, config }, { fetchImpl = globalThis.fetch } = {}) {
  if (!/^\+7[67]\d{9}$/.test(phone) || !/^\d{6}$/.test(code)) {
    throw otpError('Укажите номер телефона Казахстана.', 400, 'OTP_INVALID_PHONE');
  }
  const options = {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  };
  let url;
  if (config.provider === 'whatsapp_cloud') {
    url = `https://graph.facebook.com/${config.version}/${config.phoneId}/messages`;
    options.headers = {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    };
    options.body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone.slice(1),
      type: 'template',
      template: authenticationTemplate(config, code),
    });
  } else if (config.provider === 'ycloud_whatsapp') {
    // This endpoint submits to WhatsApp synchronously, rather than just queueing.
    url = 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly';
    options.headers = { 'X-API-Key': config.apiKey, 'Content-Type': 'application/json' };
    options.body = JSON.stringify({
      from: config.sender,
      to: phone,
      type: 'template',
      template: authenticationTemplate(config, code),
    });
  } else if (config.provider === 'mobizon_sms') {
    url = 'https://api.mobizon.kz/service/Message/SendSmsMessage';
    options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    options.body = new URLSearchParams({
      apiKey: config.apiKey,
      recipient: phone.slice(1),
      from: config.sender,
      text: `Bulka: код ${code}. Срок — 5 минут. Никому не сообщайте код.`,
    }).toString();
  } else {
    throw otpError(UNAVAILABLE, 503, 'OTP_PROVIDER_UNAVAILABLE');
  }

  // Never attach provider responses, request bodies or credentials to errors/logs.
  try {
    const response = await fetchImpl(url, options);
    const body = await response.json();
    const messageId =
      config.provider === 'whatsapp_cloud'
        ? body?.messages?.[0]?.id
        : config.provider === 'ycloud_whatsapp'
          ? !body?.error &&
            !['failed', 'deleted'].includes(body?.status) &&
            typeof body?.id === 'string'
            ? body.id.trim()
            : null
          : body?.code === 0
            ? body?.data?.messageId
            : null;
    if (!response.ok || !messageId) throw new Error('Provider rejected message');
    return { messageId: String(messageId).slice(0, 256) };
  } catch {
    throw otpError('Не удалось отправить код. Попробуйте позже.', 503, 'OTP_SEND_FAILED');
  }
}

module.exports = { customerOtpProvider, otpProviderConfig, sendAutomaticOtp };
