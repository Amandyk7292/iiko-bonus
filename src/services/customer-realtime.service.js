const realtime = require('./realtime.service');
const { readBearerToken, verifyToken } = require('./auth.service');
const { validateCustomerAuthorization } = require('./customer-authorization.service');

function createCustomerStream({ validateSession = validateCustomerAuthorization } = {}) {
  return function openCustomerStream(req, res) {
    const token = readBearerToken(req);
    const payload = verifyToken(token, 'bulka-mobile');
    const customerId = req.customerAuth.id;
    return realtime.openStream(req, res, {
      customerId,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      authorize: async () => {
        const current = await validateSession(token);
        return current && current.id === customerId
          ? { customerId, expiresAt: current.expiresAt }
          : null;
      },
    });
  };
}

module.exports = { createCustomerStream, openCustomerStream: createCustomerStream() };
