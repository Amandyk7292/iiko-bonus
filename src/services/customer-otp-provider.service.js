const { setTimeout: delay } = require('node:timers/promises');
const { otpError } = require('../utils/customer-otp.util');

const UNAVAILABLE = 'Подтверждение номера временно недоступно. Попробуйте позже.';

function customerOtpProvider(env = process.env, purpose = 'customer_login') {
  const registrationProvider =
    purpose === 'customer_registration'
      ? String(env.CUSTOMER_REGISTRATION_OTP_PROVIDER || '').trim()
      : '';
  const provider =
    registrationProvider || String(env.CUSTOMER_OTP_PROVIDER || 'legacy_whatsapp').trim();
  const allowed = ['legacy_whatsapp', 'whatsapp_cloud', 'ycloud_whatsapp', 'mobizon_sms'];
  // AutoCall is approved for registration only; a global setting must not
  // accidentally change paid delivery for login or password recovery.
  if (registrationProvider) allowed.push('autocall_sms');
  if (!allowed.includes(provider)) {
    throw otpError(UNAVAILABLE, 503, 'OTP_PROVIDER_UNAVAILABLE');
  }
  return provider;
}

function otpProviderConfig(env = process.env, purpose = 'customer_login') {
  const provider = customerOtpProvider(env, purpose);
  if (provider === 'legacy_whatsapp') return { provider };
  if (provider === 'autocall_sms') return autocallProviderConfig(env);
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

function autocallProviderConfig(env = process.env) {
  const token = String(env.AUTOCALL_API_TOKEN || '').trim();
  if (!token || /\s/.test(token)) {
    throw otpError(UNAVAILABLE, 503, 'OTP_PROVIDER_UNAVAILABLE');
  }
  return { provider: 'autocall_sms', token };
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

async function sendAutomaticOtp({ phone, code, config }, dependencies = {}) {
  if (!/^\+7[67]\d{9}$/.test(phone) || !/^\d{6}$/.test(code)) {
    throw otpError('Укажите номер телефона Казахстана.', 400, 'OTP_INVALID_PHONE');
  }
  if (config.provider === 'autocall_sms') {
    return sendAutocallSms(
      { phone, text: `Bulka: код ${code}. Действует 5 минут. Никому не сообщайте.`, config },
      dependencies,
    );
  }
  const { fetchImpl = globalThis.fetch } = dependencies;
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

async function sendAutocallSms(
  { phone, text, name = 'Verification code', variables, config },
  {
    fetchImpl = globalThis.fetch,
    waitImpl = (ms, signal) => delay(ms, undefined, { signal }),
    now = new Date(),
  } = {},
) {
  const entries = variables ? Object.entries(variables) : [];
  if (
    entries.some(
      ([key, value]) =>
        !/^[A-Za-z0-9_]{1,30}$/.test(key) || typeof value !== 'string' || value.length > 255,
    )
  ) {
    throw otpError(UNAVAILABLE, 503, 'OTP_PROVIDER_UNAVAILABLE');
  }
  const expandedText =
    typeof text === 'string'
      ? text.replace(/\{\{([A-Za-z0-9_]{1,30})\}\}/g, (match, key) => variables?.[key] ?? match)
      : '';
  const ascii = /^[\x20-\x7e]+$/.test(expandedText);
  if (
    !/^\+7[67]\d{9}$/.test(phone) ||
    typeof text !== 'string' ||
    text.length < 1 ||
    expandedText.length < 1 ||
    expandedText.length > (ascii ? 160 : 70) ||
    /\{\{/.test(expandedText) ||
    !config?.token ||
    typeof name !== 'string' ||
    name.length < 1 ||
    name.length > 40
  ) {
    throw otpError(UNAVAILABLE, 503, 'OTP_PROVIDER_UNAVAILABLE');
  }
  const url = 'https://autocall.kz/api/v1/bulks';
  const signal = AbortSignal.timeout(15000);
  const headers = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Almaty',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(now)
        .map(({ type, value }) => [type, value]),
    );
    const options = {
      method: 'POST',
      redirect: 'error',
      signal,
      headers,
      body: JSON.stringify({
        name,
        text,
        list_id: [{ number: phone, ...(variables ? { variables } : {}) }],
        date_from: `${parts.year}-${parts.month}-${parts.day}`,
        time_from: `${parts.hour}:${parts.minute}:${parts.second}`,
      }),
    };
    let response = await fetchImpl(url, options);
    let body = await response.json();
    const campaignId = body?.id;
    let expectedHttpStatus = 201;
    for (let attempt = 0; ; attempt += 1) {
      options.signal.throwIfAborted();
      if (
        !response.ok ||
        response.status !== expectedHttpStatus ||
        !Number.isSafeInteger(body?.id) ||
        body.id < 1 ||
        body.id !== campaignId ||
        body.segments !== 1 ||
        body.recipients !== 1 ||
        body.error
      ) {
        throw new Error('Provider rejected message');
      }
      if (!['generating', 'awaiting', 'moderation'].includes(body.status) || attempt === 10) break;
      // Creating a campaign can be asynchronous. Read its state briefly;
      // never resubmit the paid POST, and keep the original 15-second limit.
      await waitImpl(500, options.signal);
      options.signal.throwIfAborted();
      response = await fetchImpl(`${url}/${campaignId}`, {
        method: 'GET',
        redirect: options.redirect,
        signal: options.signal,
        headers: options.headers,
      });
      body = await response.json();
      expectedHttpStatus = 200;
    }
    // A created, running one-recipient campaign is acceptance, not delivery.
    // A completed campaign needs explicit delivery proof for this exact SMS.
    const messages = body?.messages?.data;
    const message = Array.isArray(messages) && messages.length === 1 ? messages[0] : null;
    const completedAndDelivered =
      body?.status === 'completed' &&
      body.text === text &&
      Number.isSafeInteger(message?.id) &&
      message.id > 0 &&
      message.bulk_id === body.id &&
      message.number === phone &&
      entries.every(([key, value]) => message.variables?.[key] === value) &&
      message.status === 'delivered';
    if (body.status !== 'running' && !completedAndDelivered) {
      throw new Error('Provider rejected message');
    }
    return { messageId: String(body.id) };
  } catch {
    throw otpError('Не удалось отправить код. Попробуйте позже.', 503, 'OTP_SEND_FAILED');
  }
}

module.exports = {
  autocallProviderConfig,
  customerOtpProvider,
  otpProviderConfig,
  sendAutomaticOtp,
  sendAutocallSms,
};
