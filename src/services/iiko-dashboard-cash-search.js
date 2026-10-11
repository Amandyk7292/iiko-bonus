// Accept a complete currency amount, never a partial number inside a product name.
function cashSearchAmount(value) {
  const input = String(value ?? '').trim();
  const match = input.match(
    /^((?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+))(?:[.,](\d{1,2}))?(?:[ \u00a0\u202f]*(?:₸|тг|KZT))?$/i,
  );
  if (!match) return null;
  const whole = Number(match[1].replace(/[ \u00a0\u202f]/g, ''));
  const cents = whole * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

function cashTotalCents(value) {
  if (!Number.isFinite(value)) return null;
  const cents = Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value))) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

module.exports = { cashSearchAmount, cashTotalCents };
