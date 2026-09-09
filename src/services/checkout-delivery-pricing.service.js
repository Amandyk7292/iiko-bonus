const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./auth.service');
const { deliveryAvailability } = require('./delivery-availability.service');
const { deliveryBudget } = require('./delivery-budget.service');

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
        promotionId: pricing.promotionId,
        freeDelivery: pricing.freeDelivery === true,
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
    assertAvailable = (checkout) => deliveryAvailability.assertAvailable(checkout),
    probe = (context) =>
      require('./checkout-delivery-probe.service').checkoutDeliveryProbe.ensure(context),
    budget = deliveryBudget,
  } = {},
) {
  const { checkout, pricing } = context;
  if (checkout.effectiveFulfillmentType !== 'delivery')
    return { pricing: withDeliveryFee(pricing, 0) };
  await assertAvailable(checkout);
  const free =
    pricing.freeDelivery === true || pricing.total - pricing.deliveryFee >= FREE_DELIVERY_THRESHOLD;

  // Delivery payments require the estimate the customer actually confirmed.
  // Older apps must update instead of charging an unconfirmed or zero fee.
  if (version !== 1 && !token) {
    throw Object.assign(new Error('Обновите приложение Bulka для расчёта доставки.'), {
      statusCode: 409,
      code: 'CHECKOUT_APP_UPDATE_REQUIRED',
    });
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
    if (
      quote.fingerprint !== quoteFingerprint(context) ||
      (free && quote.fee !== 0) ||
      !(quote.courierEstimate > 0)
    ) {
      throw quoteError();
    }
    const reservation = await budget.reserve(
      context.customerId,
      context.requestId,
      quote.courierEstimate,
    );
    try {
      await probe(context);
      await assertAvailable(checkout);
      return {
        pricing: {
          ...withDeliveryFee(pricing, quote.fee),
          deliveryBudgetReservationId: reservation.id,
        },
      };
    } catch (error) {
      await budget.releaseUnstarted(context.customerId, context.requestId).catch(() => {});
      throw error;
    }
  }

  const courierEstimate = await estimate(checkout, pricing);
  await budget.check(courierEstimate);
  const fee = free ? 0 : courierEstimate;
  const result = withDeliveryFee(pricing, fee);
  await probe(context);
  await assertAvailable(checkout);
  const deliveryQuoteToken = jwt.sign(
    {
      fingerprint: quoteFingerprint(context),
      fee,
      courierEstimate,
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
