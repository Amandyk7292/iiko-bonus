const API_SECRET = process.env.API_SECRET || 'bulka_secret_123';

const webhookMiddleware = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!API_SECRET || token !== `Bearer ${API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

module.exports = { webhookMiddleware };
