const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '225588';

const adminAuthMiddleware = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!ADMIN_PASSWORD || token !== `Bearer ${ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Admin password is invalid or expired. Please log in again.' });
  }
  next();
};

module.exports = { adminAuthMiddleware };
