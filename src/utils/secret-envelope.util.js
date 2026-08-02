const crypto = require('node:crypto');

const secretMaterial = (env = process.env) => {
  const value = String(
    env.GIFT_CARD_ENCRYPTION_KEY || env.CUSTOMER_JWT_SECRET || env.BULKA_SECRET || '',
  );
  if (value.length < 32) {
    throw Object.assign(new Error('Шифрование защищённых данных не настроено'), {
      statusCode: 503,
      code: 'SECRET_ENVELOPE_NOT_CONFIGURED',
    });
  }
  return value;
};

const encryptionKey = (purpose, env = process.env) =>
  crypto
    .createHash('sha256')
    .update(`bulka:${String(purpose)}:v1\0${secretMaterial(env)}`)
    .digest();

const credentialHash = (value, purpose, env = process.env) =>
  crypto
    .createHmac('sha256', encryptionKey(`hash:${purpose}`, env))
    .update(String(value), 'utf8')
    .digest('hex');

const encryptSecret = (value, { purpose, aad = '', env = process.env }) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(purpose, env), iv);
  cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
};

const decryptSecret = (envelope, { purpose, aad = '', env = process.env }) => {
  const [version, ivValue, tagValue, encryptedValue, ...rest] = String(envelope || '').split('.');
  if (version !== 'v1' || !ivValue || !tagValue || encryptedValue === undefined || rest.length) {
    throw Object.assign(new Error('Защищённые данные повреждены'), {
      statusCode: 409,
      code: 'SECRET_ENVELOPE_INVALID',
    });
  }
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(purpose, env),
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAAD(Buffer.from(String(aad), 'utf8'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw Object.assign(new Error('Защищённые данные не удалось расшифровать'), {
      statusCode: 409,
      code: 'SECRET_ENVELOPE_DECRYPT_FAILED',
      cause: error,
    });
  }
};

module.exports = {
  credentialHash,
  decryptSecret,
  encryptSecret,
};
