const crypto = require('crypto');

function getSecretWalletCardNumber(customer) {
  if (!customer?.id || !customer?.phone) {
    throw new Error('A valid customer is required to generate a wallet card number');
  }
  const secret = process.env.BULKA_SECRET;
  if (!secret) throw new Error('BULKA_SECRET is required');
  const hash = crypto
    .createHmac('sha256', secret)
    .update(`${customer.id}:${customer.phone}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  return `CARD-${customer.id}-${hash}`;
}

module.exports = { getSecretWalletCardNumber };
