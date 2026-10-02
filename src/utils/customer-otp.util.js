const crypto = require('crypto');
const { getJwtSecret } = require('../services/auth.service');

function otpError(message, statusCode = 503, code = 'OTP_UNAVAILABLE', extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra });
}

function customerOtpDigest(phone, code, secret = getJwtSecret()) {
  if (secret.length < 32) {
    throw otpError('Подтверждение номера временно недоступно. Попробуйте позже.');
  }
  return crypto
    .createHmac('sha256', secret)
    .update(`bulka-customer-otp-v1\0${phone}\0${code}`)
    .digest('hex');
}

module.exports = { customerOtpDigest, otpError };
