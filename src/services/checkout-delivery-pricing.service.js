const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./auth.service');

const FREE_DELIVERY_THRESHOLD = 10_000;
const QUOTE_LIFETIME_SECONDS = 15 * 60;
const QUOTE_AUDIENCE = 'bulka-checkout-delivery-v1';

const quoteError = () =>
  Object.assign(new Error('Обновите стоимость заказа и подтвердите оплату ещё раз.'), {
    statusCode: 409,
    code: 'CHECKOUT_QUOTE_CHANGED',
  });

function signingKey() {
  const secret = getJwtSecret();
  if (secret.length < 32) {
    throw Object.assign(new Error('Расчёт доставки временно недоступен'), { statusCode: 503 });
  }
  // A checkout quote must never be usable as a customer authentication token.
  return crypto.createHmac('sha256', secret).update(QUOTE_AUDIENCE).digest();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function quoteFingerprint({ checkout, pricing, customerId }) {
  return crypto
    .createHash('sha256')
    .update(
      stableJson({
        customerId,
        branchId: checkout.branchId,
        origin: checkout.deliveryOrigin,
        address: checkout.deliveryAddress,
        orderType: checkout.orderType,
        fulfillmentType: checkout.effectiveFulfillmentType,
        scheduledAt: checkout.scheduledAt,
        items: pricing.canonicalItems,
        subtotal: pricing.subtotal,
        discount: pricing.discount,
        promoCode: pricing.promoCode,
      }),
    )
    .digest('hex');
}

function withDeliveryFee(pricing, fee) {
  const merchandiseTotal = pricing.total - pricing.deliveryFee;
  const total = merchandiseTotal + fee;
  if (
    !Number.isSafeInteger(fee) ||
    fee < 0 ||
    fee > 100_000 ||
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    total > 10_000_000
  ) {
    throw Object.assign(new Error('Некорректная стоимость доставки'), { statusCode: 422 });
  }
  return { ...pricing, deliveryFee: fee, total };
}

/** Freeze the customer's estimate, independently of later courier invoices. */
async function priceCheckoutDelivery(
  context,
  {
    phase,
    version,
    token,
    estimate = (checkout, pricing) =>
      require('./yandex-delivery.service').estimateCheckoutDelivery(checkout, pricing),
    now = Math.floor(Date.now() / 1000),
  } = {},
) {
  const { checkout, pricing } = context;
  if (checkout.effectiveFulfillmentType !== 'delivery')
    return { pricing: withDeliveryFee(pricing, 0) };
  const free = pricing.total - pricing.deliveryFee >= FREE_DELIVERY_THRESHOLD;

  // Installed older clients use the configured zone estimate. They cannot
  // submit a fee of their own; their paid order is equally immutable.
  if (version !== 1 && !token) {
    return { pricing: withDeliveryFee(pricing, free ? 0 : checkout.deliveryFee) };
  }

  if (phase === 'payment') {
    let quote;
    try {
      quote = jwt.verify(token || '', signingKey(), {
        algorithms: ['HS256'],
        audience: QUOTE_AUDIENCE,
        clockTimestamp: now,
      });
    } catch {
      throw quoteError();
    }
    if (quote.fingerprint !== quoteFingerprint(context) || (free && quote.fee !== 0)) {
      throw quoteError();
    }
    return { pricing: withDeliveryFee(pricing, quote.fee) };
  }

  const fee = free ? 0 : await estimate(checkout, pricing);
  const result = withDeliveryFee(pricing, fee);
  const deliveryQuoteToken = jwt.sign(
    {
      fingerprint: quoteFingerprint(context),
      fee,
      iat: now,
    },
    signingKey(),
    {
      algorithm: 'HS256',
      audience: QUOTE_AUDIENCE,
      expiresIn: QUOTE_LIFETIME_SECONDS,
    },
  );
  return {
    pricing: result,
    deliveryQuoteToken,
    deliveryQuoteExpiresAt: new Date((now + QUOTE_LIFETIME_SECONDS) * 1000).toISOString(),
  };
}

module.exports = { FREE_DELIVERY_THRESHOLD, priceCheckoutDelivery };
