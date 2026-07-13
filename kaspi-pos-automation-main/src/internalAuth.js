import crypto from 'crypto';

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const isLoopback = (req) => {
  const address = String(req.ip || req.socket?.remoteAddress || '');
  return address === '127.0.0.1' || address === '::1' || address.endsWith('::ffff:127.0.0.1');
};

export const requireInternalApi = (req, res, next) => {
  const secret = String(process.env.KASPI_INTERNAL_SECRET || '');
  const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

  if (secret.length < 32) {
    if (!isProduction && isLoopback(req)) return next();
    return res.status(503).json({ error: 'Kaspi internal API is not configured' });
  }

  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!safeEqual(token, secret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
};
