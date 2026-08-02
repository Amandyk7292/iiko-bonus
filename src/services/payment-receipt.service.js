const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { enqueueWhatsAppText, whatsappOutboxDedupeKey } = require('./whatsapp-outbox.service');

const RECEIPT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_RECEIPT_LINK_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_RECEIPT_LINK_TTL_SECONDS = 366 * 24 * 60 * 60;

const cleanText = (value, maximum) =>
  String(value == null ? '' : value)
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);

const digits = (value, maximum = 32) =>
  String(value == null ? '' : value)
    .replace(/\D/g, '')
    .slice(0, maximum);

const escapeHtml = (value) =>
  String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const money = (value) =>
  new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: Number(value) % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const normalizeReceiptLanguage = (value) => {
  const language = String(value || 'ru')
    .trim()
    .toLowerCase()
    .slice(0, 2);
  return ['ru', 'kk', 'en'].includes(language) ? language : 'ru';
};

const receiptLocale = (language) =>
  ({ ru: 'ru-RU', kk: 'kk-KZ', en: 'en-US' })[normalizeReceiptLanguage(language)];

const localizedMoney = (value, language) =>
  new Intl.NumberFormat(receiptLocale(language), {
    minimumFractionDigits: Number(value) % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const receiptSecret = (env = process.env) => {
  const secret = String(
    env.RECEIPT_SIGNING_SECRET || env.CUSTOMER_JWT_SECRET || env.BULKA_SECRET || '',
  );
  if (secret.length < 32) {
    throw new Error('RECEIPT_SIGNING_SECRET must contain at least 32 characters');
  }
  return secret;
};

const receiptLinkTtlSeconds = (env = process.env) => {
  const parsed = Number(env.RECEIPT_LINK_TTL_SECONDS);
  if (!Number.isSafeInteger(parsed) || parsed < 3600) return DEFAULT_RECEIPT_LINK_TTL_SECONDS;
  return Math.min(parsed, MAX_RECEIPT_LINK_TTL_SECONDS);
};

const normalizeReceiptExpiry = (value) => {
  const expiresAt = Number(value);
  return Number.isSafeInteger(expiresAt) && expiresAt > 0 ? expiresAt : null;
};

function signReceiptId(receiptId, expiresAt, env = process.env) {
  const id = cleanText(receiptId, 64);
  if (!RECEIPT_ID_PATTERN.test(id)) throw new Error('Invalid payment receipt id');
  const normalizedExpiry = normalizeReceiptExpiry(expiresAt);
  if (!normalizedExpiry) throw new Error('Invalid payment receipt expiry');
  return crypto
    .createHmac('sha256', receiptSecret(env))
    .update(`bulka-payment-receipt:v2:${id}:${normalizedExpiry}`)
    .digest('base64url');
}

function legacyReceiptSignature(receiptId, env = process.env) {
  const id = cleanText(receiptId, 64);
  if (!RECEIPT_ID_PATTERN.test(id)) throw new Error('Invalid payment receipt id');
  return crypto
    .createHmac('sha256', receiptSecret(env))
    .update(`bulka-payment-receipt:v1:${id}`)
    .digest('base64url');
}

function verifyReceiptSignature(
  receiptId,
  signature,
  expiresAt,
  env = process.env,
  nowMs = Date.now(),
) {
  const provided = cleanText(signature, 128);
  if (!RECEIPT_ID_PATTERN.test(String(receiptId || '')) || !provided) return false;
  const normalizedExpiry = normalizeReceiptExpiry(expiresAt);
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  if (normalizedExpiry && normalizedExpiry < nowSeconds) return false;
  if (!normalizedExpiry && env.RECEIPT_ALLOW_LEGACY_LINKS !== 'true') return false;
  let expected;
  try {
    expected = normalizedExpiry
      ? signReceiptId(receiptId, normalizedExpiry, env)
      : legacyReceiptSignature(receiptId, env);
  } catch {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

function paymentReceiptUrl(receiptId, env = process.env, language = 'ru', nowMs = Date.now()) {
  const baseUrl = String(env.PUBLIC_BASE_URL || 'https://bulka.com.kz').replace(/\/+$/, '');
  const expiresAt = Math.floor(Number(nowMs) / 1000) + receiptLinkTtlSeconds(env);
  const signature = signReceiptId(receiptId, expiresAt, env);
  const normalizedLanguage = normalizeReceiptLanguage(language);
  const languageQuery = normalizedLanguage === 'ru' ? '' : `&lang=${normalizedLanguage}`;
  return `${baseUrl}/payment-receipts/${encodeURIComponent(receiptId)}?expires=${expiresAt}&token=${encodeURIComponent(signature)}${languageQuery}`;
}

function normalizeReceiptItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 100).map((item, index) => {
    const quantity = Math.min(99, Math.max(1, Math.round(Number(item?.quantity) || 1)));
    const unitPrice = Math.max(0, Number(item?.price ?? item?.unitPrice) || 0);
    return {
      id: cleanText(item?.id || item?.productId || `item-${index + 1}`, 100),
      name: cleanText(item?.name || item?.title || `Позиция ${index + 1}`, 160),
      quantity,
      unitPrice,
      lineTotal: Number((unitPrice * quantity).toFixed(2)),
    };
  });
}

function buildReceiptRecord(order, overrides = {}) {
  if (!order?.id || !order?.order_number) throw new Error('Paid order is required');
  const provider =
    cleanText(overrides.provider, 40) ||
    (String(order.payment_method || '').startsWith('forte') ? 'ForteBank' : 'Kaspi Pay');
  const isForte = provider.toLocaleLowerCase('ru-RU').includes('forte');
  const firstSix = digits(overrides.cardFirstSix ?? order.provider_card_first_six, 6);
  const lastFour = digits(overrides.cardLastFour ?? order.provider_card_last_four, 4);
  return {
    order_id: order.id,
    customer_id: order.customer_id || null,
    order_number: Number(order.order_number),
    document_number: cleanText(overrides.documentNumber, 80) || `BLK-${Number(order.order_number)}`,
    provider,
    payment_system:
      cleanText(overrides.paymentSystem ?? order.provider_payment_system, 40) || provider,
    operation_type: cleanText(overrides.operationType, 32) || 'purchase',
    transaction_reference:
      cleanText(
        overrides.transactionReference ?? order.provider_transaction_id ?? order.operation_id,
        160,
      ) || null,
    transaction_at:
      overrides.transactionAt ||
      order.provider_settled_at ||
      order.updated_at ||
      order.created_at ||
      new Date().toISOString(),
    currency: cleanText(overrides.currency, 3).toUpperCase() || 'KZT',
    amount: Math.max(0, Number(overrides.amount ?? order.amount) || 0),
    items: normalizeReceiptItems(overrides.items ?? order.cart_items),
    merchant_name: cleanText(overrides.merchantName, 160) || 'ИП РУБЛЕВА',
    merchant_code:
      cleanText(overrides.merchantCode, 100) ||
      (isForte ? cleanText(process.env.FORTE_MERCHANT_ID, 100) || null : null),
    merchant_city: cleanText(overrides.merchantCity, 100) || 'Астана',
    resource_name: cleanText(overrides.resourceName, 160) || 'Bulka',
    resource_url:
      cleanText(overrides.resourceUrl, 500) ||
      String(process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz').replace(/\/+$/, ''),
    card_first_six: firstSix.length === 6 ? firstSix : null,
    card_last_four: lastFour.length === 4 ? lastFour : null,
    authorization_code:
      cleanText(overrides.authorizationCode ?? order.provider_authorization_code, 100) || null,
    language: normalizeReceiptLanguage(overrides.language),
  };
}

async function receiptContext(order, { db = supabase } = {}) {
  const [locationResult, customerResult] = await Promise.all([
    order.branch_id
      ? db.from('bulka_locations').select('city').eq('id', order.branch_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    order.customer_id
      ? db
          .from('customers')
          .select('phone,email,preferred_language')
          .eq('id', order.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (locationResult.error) throw locationResult.error;
  if (customerResult.error) throw customerResult.error;
  return {
    merchantCity: cleanText(locationResult.data?.city, 100) || 'Астана',
    customer: customerResult.data || null,
  };
}

async function findReceiptForOrder(orderId, { db = supabase } = {}) {
  const { data, error } = await db
    .from('payment_receipts')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getPaymentReceipt(receiptId, { db = supabase } = {}) {
  if (!RECEIPT_ID_PATTERN.test(String(receiptId || ''))) return null;
  const { data, error } = await db
    .from('payment_receipts')
    .select('*')
    .eq('id', receiptId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

const receiptMessage = (receipt, url, language = 'ru') => {
  const amount = `${money(receipt.amount)} ${receipt.currency === 'KZT' ? '₸' : receipt.currency}`;
  if (language === 'kk') {
    return `Bulka №${receipt.order_number} тапсырысының төлемі расталды. Сома: ${amount}. Сауда чегін сақтау: ${url}`;
  }
  if (language === 'en') {
    return `Payment for Bulka order No. ${receipt.order_number} is confirmed. Amount: ${amount}. Save your merchant receipt: ${url}`;
  }
  return `Оплата заказа Bulka №${receipt.order_number} подтверждена. Сумма: ${amount}. Сохранить торговый чек: ${url}`;
};

async function queueReceiptForPhone(
  receipt,
  order,
  customer,
  { db = supabase, enqueue = enqueueWhatsAppText, env = process.env } = {},
) {
  if (receipt.outbox_id || receipt.phone_delivered_at) return receipt;
  const phone = digits(customer?.phone || order.phone, 15);
  if (phone.length < 10 || phone.length > 15) return receipt;
  const language = normalizeReceiptLanguage(customer?.preferred_language || receipt.language);
  const url = paymentReceiptUrl(receipt.id, env, language);
  const queued = await enqueue(
    {
      chatJid: `${phone}@s.whatsapp.net`,
      text: receiptMessage(receipt, url, language),
      dedupeKey: whatsappOutboxDedupeKey('payment-receipt', order.id, receipt.id),
      sourceType: 'payment_receipt',
      metadata: { receiptId: receipt.id, orderId: order.id },
    },
    { db },
  );
  const queuedAt = new Date().toISOString();
  const { data, error } = await db
    .from('payment_receipts')
    .update({
      outbox_id: queued.id,
      phone_queued_at: queuedAt,
      updated_at: queuedAt,
    })
    .eq('id', receipt.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function ensurePaymentReceipt(
  order,
  overrides = {},
  { db = supabase, enqueue = enqueueWhatsAppText, env = process.env } = {},
) {
  let receipt = await findReceiptForOrder(order.id, { db });
  const context = await receiptContext(order, { db });
  if (!receipt) {
    const record = buildReceiptRecord(order, {
      ...overrides,
      merchantCity: overrides.merchantCity || context.merchantCity,
      language: overrides.language || context.customer?.preferred_language,
    });
    const { data, error } = await db.from('payment_receipts').insert(record).select('*').single();
    if (error?.code === '23505') receipt = await findReceiptForOrder(order.id, { db });
    else if (error) throw error;
    else receipt = data;
  }
  if (!receipt) throw new Error('Payment receipt was not created');

  const receiptCreatedAt = receipt.created_at || new Date().toISOString();
  const { error: orderUpdateError } = await db
    .from('kaspi_orders')
    .update({ receipt_created_at: receiptCreatedAt })
    .eq('id', order.id)
    .is('receipt_created_at', null);
  if (orderUpdateError) throw orderUpdateError;

  return queueReceiptForPhone(receipt, order, context.customer, {
    db,
    enqueue,
    env,
  });
}

const RECEIPT_COPY = {
  ru: {
    title: 'Торговый чек',
    generated: 'Сформирован после подтверждения оплаты',
    detailsAria: 'Данные операции',
    operation: 'Операция',
    purchase: 'Покупка',
    refund: 'Возврат',
    orderNumber: 'Номер заказа',
    dateTime: 'Дата и время',
    amountCurrency: 'Сумма и валюта',
    provider: 'Платёжный сервис',
    paymentSystem: 'Платёжная система',
    cardMask: 'Маска карты',
    authorizationCode: 'Код авторизации',
    transactionId: 'Идентификатор операции',
    notApplicable: 'Не применяется для этого способа оплаты',
    merchantCodePending: 'Будет указан после активации эквайринга',
    authorizationUnavailable: 'Не предоставлен текущим платёжным сервисом',
    notSpecified: 'Не указана',
    notSpecifiedMasculine: 'Не указан',
    orderItems: 'Состав заказа',
    item: 'Позиция',
    quantity: 'Кол-во',
    price: 'Цена',
    amount: 'Сумма',
    noItems: 'Состав заказа не передан платёжным сервисом',
    total: 'Итого',
    seller: 'Продавец',
    merchantName: 'Наименование',
    merchantCity: 'Город обслуживания',
    merchantCode: 'Код торговца',
    website: 'Интернет-ресурс',
    contacts: 'Контакты',
    notice:
      'Bulka не получает и не хранит полный номер банковской карты, срок действия или CVC/CVV. Этот торговый чек подтверждает состав и сумму заказа и не заменяет фискальный чек.',
    actionsAria: 'Действия с чеком',
    print: 'Сохранить или распечатать',
    terms: 'Условия оплаты и возврата',
    termsUrl: '/payment-and-refund',
    languageAria: 'Язык чека',
  },
  kk: {
    title: 'Сауда чегі',
    generated: 'Төлем расталғаннан кейін жасалды',
    detailsAria: 'Операция деректері',
    operation: 'Операция',
    purchase: 'Сатып алу',
    refund: 'Қайтару',
    orderNumber: 'Тапсырыс нөмірі',
    dateTime: 'Күні мен уақыты',
    amountCurrency: 'Сома және валюта',
    provider: 'Төлем сервисі',
    paymentSystem: 'Төлем жүйесі',
    cardMask: 'Карта маскасы',
    authorizationCode: 'Авторизация коды',
    transactionId: 'Операция идентификаторы',
    notApplicable: 'Бұл төлем әдісіне қолданылмайды',
    merchantCodePending: 'Эквайринг іске қосылғаннан кейін көрсетіледі',
    authorizationUnavailable: 'Қазіргі төлем сервисі бермеген',
    notSpecified: 'Көрсетілмеген',
    notSpecifiedMasculine: 'Көрсетілмеген',
    orderItems: 'Тапсырыс құрамы',
    item: 'Өнім',
    quantity: 'Саны',
    price: 'Бағасы',
    amount: 'Сомасы',
    noItems: 'Төлем сервисі тапсырыс құрамын бермеді',
    total: 'Барлығы',
    seller: 'Сатушы',
    merchantName: 'Атауы',
    merchantCity: 'Қызмет көрсету қаласы',
    merchantCode: 'Саудагер коды',
    website: 'Интернет-ресурс',
    contacts: 'Байланыстар',
    notice:
      'Bulka банк картасының толық нөмірін, жарамдылық мерзімін немесе CVC/CVV кодын алмайды және сақтамайды. Бұл сауда чегі тапсырыстың құрамы мен сомасын растайды және фискалдық чекті алмастырмайды.',
    actionsAria: 'Чек әрекеттері',
    print: 'Сақтау немесе басып шығару',
    terms: 'Төлем және қайтару шарттары',
    termsUrl: '/kk/payment-and-refund',
    languageAria: 'Чек тілі',
  },
  en: {
    title: 'Merchant receipt',
    generated: 'Created after payment confirmation',
    detailsAria: 'Transaction details',
    operation: 'Operation',
    purchase: 'Purchase',
    refund: 'Refund',
    orderNumber: 'Order number',
    dateTime: 'Date and time',
    amountCurrency: 'Amount and currency',
    provider: 'Payment provider',
    paymentSystem: 'Payment system',
    cardMask: 'Card mask',
    authorizationCode: 'Authorization code',
    transactionId: 'Transaction ID',
    notApplicable: 'Not applicable to this payment method',
    merchantCodePending: 'Will be shown after acquiring is activated',
    authorizationUnavailable: 'Not provided by the current payment service',
    notSpecified: 'Not specified',
    notSpecifiedMasculine: 'Not specified',
    orderItems: 'Order items',
    item: 'Item',
    quantity: 'Qty',
    price: 'Price',
    amount: 'Amount',
    noItems: 'The payment service did not provide the order items',
    total: 'Total',
    seller: 'Merchant',
    merchantName: 'Name',
    merchantCity: 'Service city',
    merchantCode: 'Merchant code',
    website: 'Website',
    contacts: 'Contacts',
    notice:
      'Bulka does not receive or store the full bank card number, expiry date, or CVC/CVV. This merchant receipt confirms the order contents and amount and does not replace a fiscal receipt.',
    actionsAria: 'Receipt actions',
    print: 'Save or print',
    terms: 'Payment and refund terms',
    termsUrl: '/en/payment-and-refund',
    languageAria: 'Receipt language',
  },
};

function renderPaymentReceipt(receipt, requestedLanguage, access = {}) {
  const language = normalizeReceiptLanguage(requestedLanguage || receipt.language);
  const copy = RECEIPT_COPY[language];
  const items = normalizeReceiptItems(receipt.items);
  const rows = items
    .map(
      (item) => `<tr>
            <td>${escapeHtml(item.name)}</td>
            <td class="number">${item.quantity}</td>
            <td class="number">${escapeHtml(localizedMoney(item.unitPrice, language))} ₸</td>
            <td class="number">${escapeHtml(localizedMoney(item.lineTotal, language))} ₸</td>
          </tr>`,
    )
    .join('');
  const transactionDate = new Intl.DateTimeFormat(receiptLocale(language), {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Almaty',
  }).format(new Date(receipt.transaction_at));
  const cardMask =
    receipt.card_first_six && receipt.card_last_four
      ? `${receipt.card_first_six}••••••${receipt.card_last_four}`
      : copy.notApplicable;
  const operation = receipt.operation_type === 'refund' ? copy.refund : copy.purchase;
  const merchantCode = receipt.merchant_code || copy.merchantCodePending;
  const authorizationCode = receipt.authorization_code || copy.authorizationUnavailable;
  const token = cleanText(access?.token, 128);
  const expiresAt = normalizeReceiptExpiry(access?.expiresAt);
  const tokenQuery =
    token && expiresAt ? `expires=${expiresAt}&amp;token=${encodeURIComponent(token)}&amp;` : '';
  const languageLinks = ['ru', 'kk', 'en']
    .map(
      (code) =>
        `<a href="?${tokenQuery}lang=${code}" lang="${code}"${
          code === language ? ' aria-current="page"' : ''
        }>${code.toUpperCase()}</a>`,
    )
    .join('');
  return `<!doctype html>
<html lang="${language}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow,noarchive" />
    <meta name="referrer" content="no-referrer" />
    <meta name="theme-color" content="#fffaf2" />
    <title>${copy.title} ${escapeHtml(receipt.document_number)} — Bulka</title>
    <link rel="stylesheet" href="/assets/legal/payment-receipt.css?v=20260725" />
    <script src="/assets/legal/payment-receipt.js?v=20260725" defer></script>
  </head>
  <body>
    <main>
      <nav class="languages" aria-label="${copy.languageAria}">
        ${languageLinks}
      </nav>
      <header>
        <img src="/assets/wallet/bulka-wallet-wide-logo.png?v=20260715" alt="Bulka" />
        <div>
          <p class="eyebrow">${copy.title}</p>
          <h1>${escapeHtml(receipt.document_number)}</h1>
          <p>${copy.generated}</p>
        </div>
      </header>

      <section class="details" aria-label="${copy.detailsAria}">
        <dl>
          <div><dt>${copy.operation}</dt><dd>${operation}</dd></div>
          <div><dt>${copy.orderNumber}</dt><dd>№${escapeHtml(receipt.order_number)}</dd></div>
          <div><dt>${copy.dateTime}</dt><dd>${escapeHtml(transactionDate)}</dd></div>
          <div><dt>${copy.amountCurrency}</dt><dd>${escapeHtml(localizedMoney(receipt.amount, language))} ${escapeHtml(receipt.currency)}</dd></div>
          <div><dt>${copy.provider}</dt><dd>${escapeHtml(receipt.provider)}</dd></div>
          <div><dt>${copy.paymentSystem}</dt><dd>${escapeHtml(receipt.payment_system || copy.notSpecified)}</dd></div>
          <div><dt>${copy.cardMask}</dt><dd>${escapeHtml(cardMask)}</dd></div>
          <div><dt>${copy.authorizationCode}</dt><dd>${escapeHtml(authorizationCode)}</dd></div>
          <div><dt>${copy.transactionId}</dt><dd>${escapeHtml(receipt.transaction_reference || copy.notSpecifiedMasculine)}</dd></div>
        </dl>
      </section>

      <section>
        <h2>${copy.orderItems}</h2>
        <div class="table-scroll">
          <table>
            <thead><tr><th>${copy.item}</th><th>${copy.quantity}</th><th>${copy.price}</th><th>${copy.amount}</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="4">${copy.noItems}</td></tr>`}</tbody>
            <tfoot><tr><th colspan="3">${copy.total}</th><th class="number">${escapeHtml(localizedMoney(receipt.amount, language))} ₸</th></tr></tfoot>
          </table>
        </div>
      </section>

      <section>
        <h2>${copy.seller}</h2>
        <dl>
          <div><dt>${copy.merchantName}</dt><dd>${escapeHtml(receipt.merchant_name)}</dd></div>
          <div><dt>${copy.merchantCity}</dt><dd>${escapeHtml(receipt.merchant_city)}</dd></div>
          <div><dt>${copy.merchantCode}</dt><dd>${escapeHtml(merchantCode)}</dd></div>
          <div><dt>${copy.website}</dt><dd>${escapeHtml(receipt.resource_name)} — ${escapeHtml(receipt.resource_url)}</dd></div>
          <div><dt>${copy.contacts}</dt><dd>+7 701 277 22 33, bulka.kazakhstan@mail.ru</dd></div>
        </dl>
      </section>

      <p class="notice">
        ${copy.notice}
      </p>
      <nav class="actions" aria-label="${copy.actionsAria}">
        <button id="print-receipt" type="button">${copy.print}</button>
        <a href="${copy.termsUrl}">${copy.terms}</a>
      </nav>
    </main>
  </body>
</html>`;
}

module.exports = {
  DEFAULT_RECEIPT_LINK_TTL_SECONDS,
  buildReceiptRecord,
  ensurePaymentReceipt,
  escapeHtml,
  getPaymentReceipt,
  normalizeReceiptLanguage,
  normalizeReceiptItems,
  paymentReceiptUrl,
  receiptLinkTtlSeconds,
  renderPaymentReceipt,
  signReceiptId,
  verifyReceiptSignature,
};
