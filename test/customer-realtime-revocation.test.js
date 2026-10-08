const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const realtime = require('../src/services/realtime.service');
const { createCustomerStream } = require('../src/services/customer-realtime.service');
const { validateCustomerAuthorization } = require('../src/services/customer-authorization.service');
const { signCustomerToken } = require('../src/services/auth.service');

const drain = async () => {
  for (let i = 0; i < 4; i++) await new Promise(setImmediate);
};
const customer = { id: 'customer-stream', phone: '+77001234567', deleted_at: null };
for (const reason of ['password reset', 'account deletion', 'database outage']) {
  test(`customer stream stops private frames after ${reason}`, async (t) => {
    t.after(() => realtime.resetForTests());
    let revoked = false;
    const db = {
      from(table) {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            if (revoked && reason === 'database outage') return { error: new Error('unavailable') };
            return {
              data:
                table === 'customers'
                  ? {
                      ...customer,
                      deleted_at:
                        revoked && reason === 'account deletion' ? new Date().toISOString() : null,
                    }
                  : { auth_version: revoked && reason === 'password reset' ? 3 : 2 },
            };
          },
        };
      },
    };
    const token = signCustomerToken(customer, { authVersion: 2 });
    const req = Object.assign(new EventEmitter(), {
      headers: { authorization: `Bearer ${token}` },
      customerAuth: customer,
      query: {},
    });
    const frames = [];
    const res = {
      status() {},
      set() {},
      write(value) {
        frames.push(value);
      },
      end() {
        this.writableEnded = true;
      },
    };
    createCustomerStream({ validateSession: (jwt) => validateCustomerAuthorization(jwt, { db }) })(
      req,
      res,
    );
    await drain();
    realtime.publish('transaction.created', { marker: 'before' }, { customerId: customer.id });
    await drain();
    assert.match(frames.join(''), /before/);
    revoked = true;
    realtime.publish(
      'transaction.created',
      { marker: 'private-after-revocation' },
      { customerId: customer.id },
    );
    await drain();
    assert.equal(res.writableEnded, true);
    assert.doesNotMatch(frames.join(''), /private-after-revocation/);
  });
}
