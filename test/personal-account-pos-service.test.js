const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const {
  PersonalAccountPosService,
  codeHash,
} = require('../src/services/personal-account-pos.service');
const { startSchema, actionSchema } = require('../src/contracts/personal-account-pos.contract');
const { renderAutomationCopy } = require('../src/services/commerce-marketing.service');
const branch = randomUUID(),
  order = randomUUID(),
  customer = randomUUID();
const payload = {
  branchId: branch,
  orderId: order,
  amount: 850,
  fingerprint: 'a'.repeat(64),
  requestId: randomUUID(),
  customerCode: 'BULKA-OTP-test-signed-code',
};
test('POS requires a signed QR shape and confirmation code; cannot submit a plain customer id', () => {
  assert.equal(startSchema.safeParse({ ...payload, customerCode: customer }).success, false);
  assert.equal(startSchema.safeParse(payload).success, true);
  const action = {
    branchId: branch,
    orderId: order,
    amount: 850,
    fingerprint: payload.fingerprint,
    id: randomUUID(),
    action: 'confirm',
  };
  assert.equal(actionSchema.safeParse(action).success, false);
  assert.equal(actionSchema.safeParse({ ...action, code: '123456' }).success, true);
  assert.equal(actionSchema.safeParse({ ...action, action: 'pay' }).success, false);
  assert.notEqual(
    codeHash(action.id, '123456', 'x'.repeat(32)),
    codeHash(randomUUID(), '123456', 'x'.repeat(32)),
  );
});
for (const language of ['ru', 'kk', 'en'])
  test(`POS ${language} stores code only in customer inbox, not cashier response`, async () => {
    let args, notice;
    const secret = 'x'.repeat(32);
    const db = {
      from(table) {
        const q = {
          select() {
            return q;
          },
          eq() {
            return q;
          },
          single: async () => ({ data: table === 'bulka_locations' ? { name: '19A' } : notice }),
        };
        return q;
      },
      rpc: async (name, values) => {
        args = values;
        notice = {
          id: values.p_notification_id,
          customer_id: customer,
          title: values.p_title,
          body: values.p_body,
          type: 'order_personal_account_code',
        };
        return {
          data: { id: values.p_id, status: 'pending', notificationId: values.p_notification_id },
        };
      },
    };
    const service = new PersonalAccountPosService({
      db,
      lookup: async () => [{ id: customer, preferred_language: language }],
      env: { BULKA_SECRET: secret },
      push: async () => {
        throw Error('offline');
      },
      publish: () => {},
    });
    const result = await service.start(branch, payload);
    const code = args.p_body.match(/\d{6}/)[0];
    assert.equal(args.p_code_hash, codeHash(result.id, code, secret));
    assert.equal(JSON.stringify(result).includes(code), false);
    assert.equal(args.p_payload.destination, 'notifications');
    assert.match(args.p_body, /850/);
    assert.match(args.p_body, /19A/);
    assert.equal(result.status, 'pending');
  });
test('birthday localized gift copy uses awarded snapshot, not the latest configured amount', () => {
  for (const language of ['ru', 'kk', 'en']) {
    const rule = {
      trigger_type: 'birthday',
      body_translations: { ru: 'Happy birthday' },
      config: { birthdayBonusAmount: 5000 },
    };
    assert.match(renderAutomationCopy(rule, { bonusAmount: 1000 }, language).body, /1000/);
    assert.doesNotMatch(renderAutomationCopy(rule, {}, language).body, /5000|1000/);
  }
});

test('expired confirmation push is suppressed before token or preference lookup', async () => {
  const { notificationAllowed } = require('../src/services/notification-preferences.service');
  assert.equal(
    await notificationAllowed(
      customer,
      { type: 'order_personal_account_code', expiresAt: '2026-01-01T00:00:00Z' },
      new Date('2026-09-24T00:00:00Z'),
    ),
    false,
  );
});
