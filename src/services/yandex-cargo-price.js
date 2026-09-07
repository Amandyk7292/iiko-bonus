const priceError = (message, code) =>
  Object.assign(new Error(message), { statusCode: 409, code, retryable: false });

function cargoPriceLimit(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= 100000 ? amount : null;
}

function assertCargoPrice(info, maximum) {
  const limit = cargoPriceLimit(maximum);
  if (!limit) {
    throw priceError(
      'Не задан лимит стоимости Яндекс.Доставки',
      'YANDEX_CARGO_PRICE_LIMIT_REQUIRED',
    );
  }
  const offer = info.pricing?.offer;
  const rawPrice = offer?.price_with_vat ?? offer?.price;
  const amount = Number(rawPrice);
  const currency = info.pricing?.currency || info.pricing?.currency_rules?.code;
  if (!rawPrice || !Number.isFinite(amount) || amount <= 0 || currency !== 'KZT') {
    throw priceError(
      'Яндекс не подтвердил стоимость доставки в тенге. Курьер не вызван.',
      'YANDEX_CARGO_PRICE_UNVERIFIED',
    );
  }
  if (offer.valid_until && !(Date.parse(offer.valid_until) > Date.now())) {
    throw priceError(
      'Расчёт Яндекс.Доставки истёк. Курьер не вызван.',
      'YANDEX_CARGO_PRICE_EXPIRED',
    );
  }
  if (amount > limit) {
    throw priceError(
      `Доставка стоит ${amount} ₸, выше лимита ${limit} ₸. Требуется решение сотрудника.`,
      'YANDEX_CARGO_PRICE_LIMIT_EXCEEDED',
    );
  }
  return amount;
}

module.exports = { cargoPriceLimit, assertCargoPrice };
