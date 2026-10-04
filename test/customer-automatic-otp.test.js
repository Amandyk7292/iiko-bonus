const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { consumeCustomerOtp, startCustomerOtp } = require('../src/services/customer-otp.service');
const {
  otpProviderConfig,
  sendAutomaticOtp,
} = require('../src/services/customer-otp-provider.service');
const { customerOtpDigest } = require('../src/utils/customer-otp.util');
const {
  customerOtpRequestBodySchema,
  customerOtpVerifyBodySchema,
  customerRegistrationStartBodySchema,
  customerPasswordResetStartBodySchema,
} = require('../src/contracts/legacy-api.contract');

const env = {
  CUSTOMER_OTP_PROVIDER: 'whatsapp_cloud',
  WHATSAPP_CLOUD_API_VERSION: 'v20.0',
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_CLOUD_ACCESS_TOKEN: 'test-only-placeholder',
  WHATSAPP_AUTH_TEMPLATE_NAME: 'bulka_verification',
};
const ycloudEnv = {
  CUSTOMER_OTP_PROVIDER: 'ycloud_whatsapp',
  YCLOUD_API_KEY: 'ycloud-test-only-placeholder',
  YCLOUD_WHATSAPP_SENDER: '+77008317499',
  WHATSAPP_AUTH_TEMPLATE_NAME: 'bulka_verification',
};
const autocallEnv = {
  ...ycloudEnv,
  CUSTOMER_REGISTRATION_OTP_PROVIDER: 'autocall_sms',
  AUTOCALL_API_TOKEN: 'autocall-test-only-placeholder',
};
const phone = '+77001234567';
const request = {
  phone,
  requestToken: 'Registration23456',
  purpose: 'customer_registration',
  passwordHash: 'purpose-bound-test-password-hash',
  automaticOtpSupported: true,
};
const pg = new PGlite();
const rpcArgs = {
  reserve_customer_otp: ['p_phone', 'p_digest', 'p_payload', 'p_daily_limit'],
  complete_customer_otp_delivery: ['p_phone', 'p_flow_id', 'p_digest', 'p_success', 'p_message_id'],
  consume_customer_otp: ['p_phone', 'p_code', 'p_digest'],
};
const db = {
  async rpc(name, args) {
    const names = rpcArgs[name];
    assert.ok(names, `Unexpected RPC: ${name}`);
    const params = names.map((key) =>
      key === 'p_payload' ? JSON.stringify(args[key]) : args[key],
    );
    const result = await pg.query(
      `select public.${name}(${names.map((_, i) => `$${i + 1}`).join(',')}) as result`,
      params,
    );
    return { data: result.rows[0].result, error: null };
  },
};

test.before(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table public.whatsapp_sessions (
      id text primary key, data jsonb not null, expires_at timestamptz,
      updated_at timestamptz default now()
    );`);
  await pg.exec(
    readFileSync('supabase/migrations/20261002150000_automatic_customer_otp.sql', 'utf8'),
  );
});
test.beforeEach(async () => {
  await pg.exec('delete from customer_otp_send_limits; delete from whatsapp_sessions;');
});
test.after(() => pg.close());

test('old clients retain four-digit confirmation outside AutoCall registration', async () => {
  let session;
  const legacyDb = {
    from(table) {
      assert.equal(table, 'whatsapp_sessions');
      return {
        delete: () => ({ lt: async () => ({ error: null }) }),
        upsert: async (value) => {
          session = value;
          return { error: null };
        },
      };
    },
  };
  for (const [purpose, deliveryEnv] of [
    ['customer_registration', env],
    ['customer_login', autocallEnv],
    [
      'customer_login',
      { ...autocallEnv, CUSTOMER_OTP_PROVIDER: 'unknown', AUTOCALL_API_TOKEN: '' },
    ],
  ]) {
    const result = await startCustomerOtp(
      { ...request, purpose, automaticOtpSupported: undefined },
      {
        db: legacyDb,
        env: deliveryEnv,
        sendOtp: async () =>
          assert.fail('An old client must not receive an unusable six-digit code'),
      },
    );
    assert.equal(result.deliveryMode, 'manual');
    assert.equal(result.channel, 'whatsapp');
    assert.equal(result.codeLength, 4);
    assert.match(result.whatsappUrl, /^https:\/\/wa\.me\//);
    assert.equal(session.id, `token_${request.requestToken}`);
    assert.equal(session.data.purpose, purpose);
    assert.equal(session.data.passwordHash, request.passwordHash);
  }
  assert.equal((await pg.query('select * from customer_otp_send_limits')).rows.length, 0);
});

test('AutoCall registration requires an updated client before creating any challenge or reserving SMS quota', async () => {
  const noWritesDb = {
    from: () => assert.fail('Unsupported registration must not create a WhatsApp challenge'),
    rpc: () => assert.fail('Unsupported registration must not reserve SMS quota'),
  };
  for (const automaticOtpSupported of [undefined, false]) {
    for (const token of [autocallEnv.AUTOCALL_API_TOKEN, '', 'bad token']) {
      await assert.rejects(
        startCustomerOtp(
          { ...request, automaticOtpSupported },
          {
            db: noWritesDb,
            env: { ...autocallEnv, AUTOCALL_API_TOKEN: token },
            sendOtp: () => assert.fail('Unsupported registration must not send an SMS'),
          },
        ),
        {
          statusCode: 400,
          code: 'OTP_CLIENT_UPDATE_REQUIRED',
          message:
            'Обновите приложение Bulka или перезагрузите страницу, чтобы подтвердить номер по SMS.',
        },
      );
    }
  }
  assert.equal((await pg.query('select * from customer_otp_send_limits')).rows.length, 0);
  assert.equal((await pg.query('select * from whatsapp_sessions')).rows.length, 0);
});

test('all OTP start contracts accept old clients and only the supported delivery version', () => {
  const body = { phone, token: request.requestToken };
  for (const [schema, values] of [
    [customerOtpRequestBodySchema, body],
    [customerPasswordResetStartBodySchema, body],
    [customerRegistrationStartBodySchema, { ...body, password: 'Register2026' }],
  ]) {
    assert.equal(schema.parse(values).otpDeliveryVersion, undefined);
    assert.equal(schema.parse({ ...values, otpDeliveryVersion: 2 }).otpDeliveryVersion, 2);
    for (const version of [0, 1, 3, '2', true]) {
      assert.equal(schema.safeParse({ ...values, otpDeliveryVersion: version }).success, false);
    }
  }
});

test('WhatsApp Cloud sends the approved authentication template without exposing credentials', async () => {
  const config = otpProviderConfig(env);
  const result = await sendAutomaticOtp(
    { phone, code: '123456', config },
    {
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://graph.facebook.com/v20.0/123456789012345/messages');
        assert.equal(new URL(url).search, '');
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
        const body = JSON.parse(options.body);
        assert.equal(body.to, '77001234567');
        assert.equal(body.type, 'template');
        assert.equal(body.template.name, 'bulka_verification');
        assert.equal(body.template.language.code, 'ru');
        assert.equal(body.template.components[0].parameters[0].text, '123456');
        assert.equal(body.template.components[1].sub_type, 'url');
        assert.equal(body.template.components[1].parameters[0].text, '123456');
        return { ok: true, json: async () => ({ messages: [{ id: 'wamid.accepted' }] }) };
      },
    },
  );
  assert.deepEqual(result, { messageId: 'wamid.accepted' });
});

test('Mobizon uses a registered sender and keeps the API key out of URLs', async () => {
  const config = otpProviderConfig({
    CUSTOMER_OTP_PROVIDER: 'mobizon_sms',
    MOBIZON_API_KEY: 'sms-test-placeholder',
    MOBIZON_SMS_SENDER: 'BULKA',
  });
  const result = await sendAutomaticOtp(
    { phone, code: '123456', config },
    {
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://api.mobizon.kz/service/Message/SendSmsMessage');
        assert.equal(new URL(url).search, '');
        const form = new URLSearchParams(options.body);
        assert.equal(form.get('apiKey'), config.apiKey);
        assert.equal(form.get('recipient'), '77001234567');
        assert.equal(form.get('from'), 'BULKA');
        assert.match(form.get('text'), /123456/);
        assert.ok(form.get('text').length <= 70, 'OTP fits one Cyrillic SMS segment');
        return { ok: true, json: async () => ({ code: 0, data: { messageId: 'sms-1' } }) };
      },
    },
  );
  assert.equal(result.messageId, 'sms-1');
});

test('AutoCall sends one short registration SMS using a Bearer token outside the URL and payload', async () => {
  const config = otpProviderConfig(autocallEnv, 'customer_registration');
  const result = await sendAutomaticOtp(
    { phone, code: '123456', config },
    {
      now: new Date('2026-10-03T17:45:40Z'),
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://autocall.kz/api/v1/bulks');
        assert.equal(new URL(url).search, '');
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
        assert.equal(options.headers.Accept, 'application/json');
        assert.equal(options.headers['Content-Type'], 'application/json');
        const body = JSON.parse(options.body);
        assert.deepEqual(body, {
          name: 'Verification code',
          text: 'Bulka: код 123456. Действует 5 минут. Никому не сообщайте.',
          list_id: [{ number: phone }],
          date_from: '2026-10-03',
          time_from: '22:45:40',
        });
        assert.ok(body.text.length <= 70, 'OTP fits one Cyrillic SMS segment');
        assert.equal(options.body.includes(config.token), false);
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 12345, status: 'running', segments: 1, recipients: 1 }),
        };
      },
    },
  );
  assert.deepEqual(result, { messageId: '12345' });
});

test('AutoCall schedules immediate SMS using one Kazakhstan date/time snapshot across midnight', async () => {
  const config = otpProviderConfig(autocallEnv, 'customer_registration');
  for (const [timestamp, date, time] of [
    ['2026-10-03T18:59:59Z', '2026-10-03', '23:59:59'],
    ['2026-10-03T19:00:00Z', '2026-10-04', '00:00:00'],
  ]) {
    await sendAutomaticOtp(
      { phone, code: '123456', config },
      {
        now: new Date(timestamp),
        fetchImpl: async (_url, options) => {
          const body = JSON.parse(options.body);
          assert.equal(body.date_from, date);
          assert.equal(body.time_from, time);
          return {
            ok: true,
            status: 201,
            json: async () => ({ id: 12345, status: 'running', segments: 1, recipients: 1 }),
          };
        },
      },
    );
  }
});

test('AutoCall polls transient creation states with GET until running or exact confirmed delivery', async () => {
  const config = otpProviderConfig(autocallEnv, 'customer_registration');
  const generated = { id: 12345, status: 'generating', segments: 1, recipients: 1 };
  const completed = {
    ...generated,
    status: 'completed',
    text: 'Bulka: код 123456. Действует 5 минут. Никому не сообщайте.',
    messages: {
      data: [{ id: 98765, bulk_id: 12345, number: phone, status: 'delivered' }],
    },
  };
  for (const [initialStatus, updates] of [
    ['generating', [generated, { ...generated, status: 'running' }]],
    ['generating', [completed]],
    ['awaiting', [{ ...generated, status: 'running' }]],
    ['moderation', [generated, { ...generated, status: 'running' }]],
    ['generating', [...Array(9).fill(generated), { ...generated, status: 'running' }]],
    [
      'generating',
      [
        { ...generated, status: 'moderation' },
        { ...generated, status: 'running' },
      ],
    ],
  ]) {
    const calls = [];
    const waits = [];
    let originalSignal;
    const result = await sendAutomaticOtp(
      { phone, code: '123456', config },
      {
        fetchImpl: async (url, options) => {
          calls.push(options.method);
          if (calls.length === 1) {
            assert.equal(options.method, 'POST');
            assert.equal(url, 'https://autocall.kz/api/v1/bulks');
            originalSignal = options.signal;
            return {
              ok: true,
              status: 201,
              json: async () => ({ ...generated, status: initialStatus }),
            };
          }
          assert.equal(url, 'https://autocall.kz/api/v1/bulks/12345');
          assert.equal(options.method, 'GET');
          assert.equal(options.body, undefined);
          assert.equal(options.redirect, 'error');
          assert.equal(options.signal, originalSignal);
          assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
          return { ok: true, status: 200, json: async () => updates[calls.length - 2] };
        },
        waitImpl: async (ms, signal) => {
          assert.equal(ms, 500);
          assert.equal(signal, originalSignal);
          waits.push(ms);
        },
      },
    );
    assert.deepEqual(result, { messageId: '12345' });
    assert.deepEqual(calls, ['POST', ...updates.map(() => 'GET')]);
    assert.equal(waits.length, updates.length);
  }
});

test('AutoCall stops after ten pending reads and never repeats the paid POST', async () => {
  const config = otpProviderConfig(autocallEnv, 'customer_registration');
  for (const status of ['generating', 'awaiting', 'moderation']) {
    let posts = 0;
    let reads = 0;
    let waits = 0;
    await assert.rejects(
      sendAutomaticOtp(
        { phone, code: '123456', config },
        {
          fetchImpl: async (_url, options) => {
            if (options.method === 'POST') posts += 1;
            else reads += 1;
            return {
              ok: true,
              status: options.method === 'POST' ? 201 : 200,
              json: async () => ({
                id: 12345,
                status,
                segments: 1,
                recipients: 1,
                ...(status === 'awaiting'
                  ? { date_from: '2026-10-04', time_from: '00:00:00' }
                  : {}),
              }),
            };
          },
          waitImpl: async () => {
            waits += 1;
          },
        },
      ),
      { code: 'OTP_SEND_FAILED' },
    );
    assert.equal(posts, 1);
    assert.equal(reads, 10);
    assert.equal(waits, 10);
  }
});

test('AutoCall status reads reject changed IDs, denied states, errors and malformed responses immediately', async () => {
  const config = otpProviderConfig(autocallEnv, 'customer_registration');
  const generated = { id: 12345, status: 'generating', segments: 1, recipients: 1 };
  const sensitive = `123456 ${phone} ${config.token}`;
  const updates = [
    { ok: true, status: 201, body: { ...generated, status: 'running' } },
    { ok: false, status: 403, body: { error: sensitive } },
    { ok: true, status: 200, body: null },
    ...[
      { id: 99999, status: 'running' },
      { status: 'denied' },
      { status: 'unexpected' },
      { segments: 2 },
      { recipients: 2 },
    ].map((override) => ({ ok: true, status: 200, body: { ...generated, ...override } })),
  ];
  for (const update of updates) {
    const methods = [];
    await assert.rejects(
      sendAutomaticOtp(
        { phone, code: '123456', config },
        {
          fetchImpl: async (_url, options) => {
            methods.push(options.method);
            return methods.length === 1
              ? { ok: true, status: 201, json: async () => generated }
              : { ok: update.ok, status: update.status, json: async () => update.body };
          },
          waitImpl: async () => {},
        },
      ),
      (error) => {
        assert.equal(error.code, 'OTP_SEND_FAILED');
        for (const value of ['123456', phone, config.token]) {
          assert.equal(
            `${error.message} ${error.stack} ${JSON.stringify(error)}`.includes(value),
            false,
          );
        }
        return true;
      },
    );
    assert.deepEqual(methods, ['POST', 'GET']);
  }
});

test('AutoCall rejects unaccepted statuses, malformed responses and failures without leaking details', async () => {
  const config = otpProviderConfig(autocallEnv, 'customer_registration');
  const accepted = { id: 12345, status: 'running', segments: 1, recipients: 1 };
  const sensitive = `123456 ${config.token} ${phone}`;
  const responses = [
    { ok: false, status: 401, body: { error: sensitive } },
    { ok: true, status: 200, body: accepted },
    ...[
      { id: 0 },
      { id: '12345' },
      { id: { sensitive } },
      { status: 'denied' },
      { status: 'completed' },
      { status: 'failed' },
      { status: 'unexpected' },
      { segments: 2 },
      { recipients: 2 },
      { error: sensitive },
    ].map((override) => ({ ok: true, status: 201, body: { ...accepted, ...override } })),
    { ok: true, status: 201, body: null },
  ];
  const fetches = [
    ...responses.map(({ ok, status, body }) => async () => ({
      ok,
      status,
      json: async () => body,
    })),
    async () => {
      throw new Error(sensitive);
    },
    async () => ({
      ok: true,
      status: 201,
      json: async () => {
        throw new Error(sensitive);
      },
    }),
  ];
  for (const fetchImpl of fetches) {
    await assert.rejects(
      sendAutomaticOtp({ phone, code: '123456', config }, { fetchImpl }),
      (error) => {
        assert.equal(error.code, 'OTP_SEND_FAILED');
        assert.equal(error.statusCode, 503);
        for (const value of ['123456', config.token, phone]) {
          assert.equal(
            `${error.message} ${error.stack} ${JSON.stringify(error)}`.includes(value),
            false,
          );
        }
        return true;
      },
    );
  }
});

test('AutoCall accepts a completed campaign only with proof of delivery of the exact SMS to its recipient', async () => {
  const config = otpProviderConfig(autocallEnv, 'customer_registration');
  const delivered = { id: 98765, bulk_id: 12345, number: phone, status: 'delivered' };
  const completed = {
    id: 12345,
    status: 'completed',
    segments: 1,
    recipients: 1,
    text: 'Bulka: код 123456. Действует 5 минут. Никому не сообщайте.',
    messages: { data: [delivered] },
  };
  const send = (body) =>
    sendAutomaticOtp(
      { phone, code: '123456', config },
      { fetchImpl: async () => ({ ok: true, status: 201, json: async () => body }) },
    );
  assert.deepEqual(await send(completed), { messageId: '12345' });
  for (const body of [
    { ...completed, text: 'Bulka: код 654321. Действует 5 минут. Никому не сообщайте.' },
    { ...completed, messages: undefined },
    { ...completed, messages: { data: [] } },
    { ...completed, messages: { data: [delivered, delivered] } },
    ...[
      { status: 'failed' },
      { status: 'pending' },
      { status: 'sent' },
      { number: '+77001234568' },
      { bulk_id: 99999 },
      { id: 0 },
    ].map((override) => ({
      ...completed,
      messages: { data: [{ ...delivered, ...override }] },
    })),
  ]) {
    await assert.rejects(send(body), { code: 'OTP_SEND_FAILED' });
  }
});

test('registration override uses AutoCall SMS while login retains the configured WhatsApp provider', async () => {
  for (const [purpose, recipient, expectedProvider, expectedChannel] of [
    ['customer_registration', phone, 'autocall_sms', 'sms'],
    ['customer_login', '+77001234568', 'ycloud_whatsapp', 'whatsapp'],
  ]) {
    let code;
    const result = await startCustomerOtp(
      { ...request, purpose, phone: recipient },
      {
        db,
        env: autocallEnv,
        sendOtp: async (message) => {
          assert.equal(message.config.provider, expectedProvider);
          code = message.code;
          return { messageId: 'purpose-accepted' };
        },
      },
    );
    assert.equal(result.channel, expectedChannel);
    assert.equal(result.deliveryMode, 'automatic');
    assert.equal(result.codeLength, 6);
    assert.equal(result.expiresInSeconds, 300);
    assert.equal(result.retryAfterSeconds, 60);
    assert.equal(result.whatsappUrl, null);
    assert.equal(result.whatsappPhone, null);
    const verified = await consumeCustomerOtp(recipient, code, { db, env: autocallEnv });
    assert.equal(verified.status, 'success');
    assert.equal(verified.payload.purpose, purpose);
  }
});

test('password recovery cannot create or send a legacy or automatic OTP', async () => {
  for (const automaticOtpSupported of [false, true]) {
    await assert.rejects(
      startCustomerOtp(
        { ...request, purpose: 'customer_password_reset', automaticOtpSupported },
        {
          db,
          env: autocallEnv,
          sendOtp: async () => assert.fail('Password recovery uses an SMS link only'),
        },
      ),
      { code: 'PASSWORD_RESET_SMS_LINK_REQUIRED' },
    );
  }
  assert.equal((await pg.query('select count(*)::int as n from whatsapp_sessions')).rows[0].n, 0);
});

test('AutoCall configuration is registration-only and invalid registration secrets do not affect login or reserve quota', async () => {
  for (const purpose of ['customer_login', 'customer_password_reset', 'customer_registration']) {
    assert.throws(
      () =>
        otpProviderConfig(
          { CUSTOMER_OTP_PROVIDER: 'autocall_sms', AUTOCALL_API_TOKEN: 'test' },
          purpose,
        ),
      { code: 'OTP_PROVIDER_UNAVAILABLE' },
    );
  }
  for (const token of ['', '   ', 'bad token', 'bad\ntoken']) {
    const invalidEnv = { ...autocallEnv, AUTOCALL_API_TOKEN: token };
    assert.equal(otpProviderConfig(invalidEnv, 'customer_login').provider, 'ycloud_whatsapp');
    assert.equal(
      otpProviderConfig(invalidEnv, 'customer_password_reset').provider,
      'ycloud_whatsapp',
    );
    await assert.rejects(
      startCustomerOtp(request, {
        db,
        env: invalidEnv,
        sendOtp: async () => assert.fail('Invalid config must fail before sending'),
      }),
      { code: 'OTP_PROVIDER_UNAVAILABLE' },
    );
  }
  for (const purpose of ['customer_login', 'customer_password_reset']) {
    assert.deepEqual(
      otpProviderConfig({ ...autocallEnv, CUSTOMER_OTP_PROVIDER: 'legacy_whatsapp' }, purpose),
      { provider: 'legacy_whatsapp' },
    );
  }
  assert.equal((await pg.query('select * from customer_otp_send_limits')).rows.length, 0);
  assert.equal(
    otpProviderConfig(
      { ...ycloudEnv, CUSTOMER_REGISTRATION_OTP_PROVIDER: '   ' },
      'customer_registration',
    ).provider,
    'ycloud_whatsapp',
  );
});

test('an AutoCall campaign awaiting moderation does not activate the registration code', async () => {
  let code;
  const methods = [];
  await assert.rejects(
    startCustomerOtp(request, {
      db,
      env: autocallEnv,
      sendOtp: async (message) => {
        code = message.code;
        return sendAutomaticOtp(message, {
          fetchImpl: async (_url, options) => {
            methods.push(options.method);
            return {
              ok: true,
              status: options.method === 'POST' ? 201 : 200,
              json: async () => ({
                id: 12345,
                status: options.method === 'POST' ? 'generating' : 'moderation',
                segments: 1,
                recipients: 1,
              }),
            };
          },
          waitImpl: async () => {},
        });
      },
    }),
    { code: 'OTP_SEND_FAILED' },
  );
  assert.deepEqual(methods, ['POST', ...Array(10).fill('GET')]);
  assert.equal((await pg.query('select * from whatsapp_sessions')).rows.length, 0);
  assert.equal((await consumeCustomerOtp(phone, code, { db, env: autocallEnv })).status, 'expired');
  await assert.rejects(startCustomerOtp(request, { db, env: autocallEnv }), {
    code: 'OTP_RATE_LIMITED',
  });
});

test('YCloud submits the OTP synchronously with E.164 phones and matching code button', async () => {
  const config = otpProviderConfig(ycloudEnv);
  const result = await sendAutomaticOtp(
    { phone, code: '123456', config },
    {
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly');
        assert.equal(new URL(url).search, '');
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers['X-API-Key'], config.apiKey);
        const body = JSON.parse(options.body);
        assert.equal(body.from, '+77008317499');
        assert.equal(body.to, phone);
        assert.equal(body.type, 'template');
        assert.equal(body.template.name, 'bulka_verification');
        assert.deepEqual(body.template.language, { code: 'ru', policy: 'deterministic' });
        assert.equal(body.template.components[0].parameters[0].text, '123456');
        assert.equal(body.template.components[1].parameters[0].text, '123456');
        assert.equal(body.template.components[1].sub_type, 'url');
        assert.equal(
          body.useDirectSend,
          undefined,
          'Use the approved template, not template bypass',
        );
        return { ok: true, json: async () => ({ id: 'ycloud-accepted', status: 'sent' }) };
      },
    },
  );
  assert.deepEqual(result, { messageId: 'ycloud-accepted' });
});

test('YCloud rejects failed sends and incomplete configuration without leaking details', async () => {
  for (const body of [
    { id: 'rejected', status: 'failed', errorMessage: '123456 sensitive' },
    { id: 'rejected', status: 'deleted' },
    { id: 'rejected', error: { message: '123456 sensitive' } },
    { id: { malformed: '123456 sensitive' }, status: 'sent' },
    { id: '   ', status: 'sent' },
    { status: 'sent' },
  ]) {
    await assert.rejects(
      sendAutomaticOtp(
        { phone, code: '123456', config: otpProviderConfig(ycloudEnv) },
        { fetchImpl: async () => ({ ok: true, json: async () => body }) },
      ),
      (error) => error.code === 'OTP_SEND_FAILED' && !JSON.stringify(error).includes('sensitive'),
    );
  }
  for (const overrides of [
    { YCLOUD_API_KEY: '' },
    { YCLOUD_WHATSAPP_SENDER: '77008317499' },
    { YCLOUD_WHATSAPP_SENDER: '+79991234567' },
    { WHATSAPP_AUTH_TEMPLATE_NAME: '' },
    { WHATSAPP_AUTH_TEMPLATE_LANGUAGE: 'not-a-language' },
  ]) {
    assert.throws(() => otpProviderConfig({ ...ycloudEnv, ...overrides }), {
      code: 'OTP_PROVIDER_UNAVAILABLE',
    });
  }
});

test('YCloud confirmation is reported as WhatsApp and a failed delivery never activates the code', async () => {
  let code;
  const result = await startCustomerOtp(request, {
    db,
    env: ycloudEnv,
    sendOtp: async (message) => {
      code = message.code;
      return { messageId: 'ycloud-accepted' };
    },
  });
  assert.equal(result.channel, 'whatsapp');
  assert.equal(result.deliveryMode, 'automatic');
  assert.equal(result.whatsappUrl, null);
  assert.equal((await consumeCustomerOtp(phone, code, { db, env: ycloudEnv })).status, 'success');
  await assert.rejects(startCustomerOtp(request, { db, env: ycloudEnv }), {
    code: 'OTP_RATE_LIMITED',
  });
  await pg.exec(
    "update customer_otp_send_limits set last_sent_at = now() - interval '61 seconds';",
  );
  await assert.rejects(
    startCustomerOtp(request, {
      db,
      env: ycloudEnv,
      sendOtp: async (message) => {
        code = message.code;
        throw new Error('provider unavailable');
      },
    }),
    { code: 'OTP_SEND_FAILED' },
  );
  assert.equal((await consumeCustomerOtp(phone, code, { db, env: ycloudEnv })).status, 'expired');
});

test('provider rejection, timeout and missing configuration fail closed', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, json: async () => ({ error: { message: '123456 sensitive' } }) }),
    async () => ({ ok: true, json: async () => ({ code: 8 }) }),
    async () => {
      throw new Error('timeout containing sensitive details');
    },
  ]) {
    await assert.rejects(
      sendAutomaticOtp({ phone, code: '123456', config: otpProviderConfig(env) }, { fetchImpl }),
      (error) => error.code === 'OTP_SEND_FAILED' && !JSON.stringify(error).includes('sensitive'),
    );
  }
  assert.throws(() => otpProviderConfig({ CUSTOMER_OTP_PROVIDER: 'whatsapp_cloud' }), {
    code: 'OTP_PROVIDER_UNAVAILABLE',
  });
  assert.throws(() => otpProviderConfig({ CUSTOMER_OTP_PROVIDER: 'unknown' }), {
    code: 'OTP_PROVIDER_UNAVAILABLE',
  });
  let called = false;
  await assert.rejects(
    startCustomerOtp(request, {
      db,
      env: { CUSTOMER_OTP_PROVIDER: 'whatsapp_cloud' },
      sendOtp: async () => {
        called = true;
      },
    }),
    { code: 'OTP_PROVIDER_UNAVAILABLE' },
  );
  assert.equal(called, false);
  assert.equal((await pg.query('select * from customer_otp_send_limits')).rows.length, 0);
});

test('automatic OTP persists only a digest, preserves registration purpose and consumes once', async () => {
  let code;
  const result = await startCustomerOtp(request, {
    db,
    env,
    sendOtp: async (message) => {
      code = message.code;
      assert.match(code, /^\d{6}$/);
      assert.equal((await consumeCustomerOtp(phone, code, { db, env })).status, 'invalid');
      return { messageId: 'accepted-1' };
    },
  });
  assert.equal(result.deliveryMode, 'automatic');
  assert.equal(result.channel, 'whatsapp');
  assert.equal(result.codeLength, 6);
  assert.equal(result.whatsappUrl, null);
  assert.equal(result.retryAfterSeconds, 60);
  assert.equal(result.expiresInSeconds, 300);
  assert.equal(JSON.stringify(result).includes(code), false);
  const row = (await pg.query('select * from whatsapp_sessions')).rows[0];
  assert.equal(row.id, `otp_${phone}`);
  assert.equal(row.data.code, undefined);
  assert.equal(row.data.codeDigest, customerOtpDigest(phone, code));
  assert.equal(row.data.attempts, 0);
  const remaining = new Date(row.expires_at).getTime() - Date.now();
  assert.ok(remaining > 295000 && remaining <= 300000);
  const verified = await consumeCustomerOtp(phone, code, { db, env });
  assert.equal(verified.status, 'success');
  assert.equal(verified.payload.purpose, request.purpose);
  assert.equal(verified.payload.passwordHash, request.passwordHash);
  assert.equal(verified.payload.codeDigest, undefined);
  assert.equal(verified.payload.providerMessageId, undefined);
  assert.equal((await consumeCustomerOtp(phone, code, { db, env })).status, 'expired');
  assert.equal((await pg.query('select * from customer_otp_send_limits')).rows.length, 2);
});

test('concurrent sends and code verification produce one send and one success', async () => {
  let sends = 0;
  let code;
  const sendOtp = async (message) => {
    sends += 1;
    code = message.code;
    return { messageId: 'accepted-concurrent' };
  };
  const starts = await Promise.allSettled([
    startCustomerOtp(request, { db, env, sendOtp }),
    startCustomerOtp({ ...request, requestToken: 'DifferentToken23456' }, { db, env, sendOtp }),
  ]);
  assert.equal(sends, 1);
  assert.equal(starts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(starts.find((r) => r.status === 'rejected').reason.code, 'OTP_RATE_LIMITED');
  const results = await Promise.all([
    consumeCustomerOtp(phone, code, { db, env }),
    consumeCustomerOtp(phone, code, { db, env }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['expired', 'success']);
});

test('expired codes and five wrong attempts cannot confirm a number', async () => {
  let code;
  const sendOtp = async (message) => {
    code = message.code;
    return { messageId: 'accepted' };
  };
  await startCustomerOtp(request, { db, env, sendOtp });
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 1; i <= 5; i += 1) {
    const result = await consumeCustomerOtp(phone, wrong, { db, env });
    assert.equal(result.status, i === 5 ? 'attempts_exceeded' : 'invalid');
  }
  assert.equal((await consumeCustomerOtp(phone, code, { db, env })).status, 'expired');
  await pg.exec(
    "update customer_otp_send_limits set last_sent_at = now() - interval '61 seconds';",
  );
  await startCustomerOtp(request, { db, env, sendOtp });
  await pg.exec("update whatsapp_sessions set expires_at = now() - interval '1 second';");
  assert.equal((await consumeCustomerOtp(phone, code, { db, env })).status, 'expired');
});

test('failed sends remove pending codes but retain anti-abuse limits', async () => {
  let code;
  await assert.rejects(
    startCustomerOtp(request, {
      db,
      env,
      sendOtp: async (message) => {
        code = message.code;
        throw new Error('delivery failed');
      },
    }),
    { code: 'OTP_SEND_FAILED' },
  );
  assert.equal((await pg.query('select * from whatsapp_sessions')).rows.length, 0);
  assert.equal((await consumeCustomerOtp(phone, code, { db, env })).status, 'expired');
  await assert.rejects(startCustomerOtp(request, { db, env }), { code: 'OTP_RATE_LIMITED' });
});

test('hour, day and global limits persist beyond consuming codes', async () => {
  const sendOtp = async () => ({ messageId: 'accepted' });
  await startCustomerOtp(request, { db, env, sendOtp });
  await pg.exec(
    "update customer_otp_send_limits set last_sent_at = now() - interval '61 seconds';",
  );
  await pg.exec("update customer_otp_send_limits set hour_count = 5 where scope like 'phone:%';");
  await assert.rejects(startCustomerOtp(request, { db, env, sendOtp }), {
    code: 'OTP_RATE_LIMITED',
  });
  await pg.exec(
    "update customer_otp_send_limits set hour_count = 0, day_count = 10 where scope like 'phone:%';",
  );
  await assert.rejects(startCustomerOtp(request, { db, env, sendOtp }), {
    code: 'OTP_RATE_LIMITED',
  });
  await assert.rejects(
    startCustomerOtp(
      { ...request, phone: '+77019998877' },
      {
        db,
        env: { ...env, CUSTOMER_OTP_DAILY_SEND_LIMIT: 1 },
        sendOtp,
      },
    ),
    { code: 'OTP_RATE_LIMITED' },
  );
  await pg.exec(
    "update customer_otp_send_limits set day_started_at = now() - interval '1 day', hour_started_at = now() - interval '1 hour';",
  );
  assert.equal((await startCustomerOtp(request, { db, env, sendOtp })).deliveryMode, 'automatic');
});

test('late completion from an older send cannot delete or activate the replacement code', async () => {
  const old = {
    p_phone: phone,
    p_flow_id: request.requestToken,
    p_digest: customerOtpDigest(phone, '111111'),
  };
  const reserve = (token, code) =>
    db.rpc('reserve_customer_otp', {
      p_phone: phone,
      p_digest: customerOtpDigest(phone, code),
      p_payload: { ...request, flowId: token },
      p_daily_limit: 1000,
    });
  await reserve(request.requestToken, '111111');
  await pg.exec(
    "update customer_otp_send_limits set last_sent_at = now() - interval '61 seconds';",
  );
  await reserve('ReplacementToken234', '222222');
  assert.equal(
    (
      await db.rpc('complete_customer_otp_delivery', {
        ...old,
        p_success: true,
        p_message_id: 'old',
      })
    ).data,
    false,
  );
  assert.equal(
    (
      await db.rpc('complete_customer_otp_delivery', {
        ...old,
        p_success: false,
        p_message_id: null,
      })
    ).data,
    false,
  );
  assert.equal(
    (await pg.query('select data from whatsapp_sessions')).rows[0].data.flowId,
    'ReplacementToken234',
  );
});

test('legacy four-digit object and string OTP records still work', async () => {
  for (const asString of [false, true]) {
    const payload = {
      code: '1234',
      attempts: 0,
      purpose: 'customer_password_reset',
      flowId: 'LegacyToken23456',
    };
    await pg.query(
      "insert into whatsapp_sessions(id,data,expires_at) values($1,$2,now()+interval '5 minutes')",
      [`otp_${phone}`, JSON.stringify(asString ? JSON.stringify(payload) : payload)],
    );
    const result = await consumeCustomerOtp(phone, '1234', { db });
    assert.equal(result.status, 'success');
    assert.equal(result.payload.purpose, 'customer_password_reset');
    assert.equal(result.payload.code, undefined);
  }
});

test('old RPC fallback is allowed only before migration and only in legacy mode', async () => {
  const calls = [];
  const client = {
    async rpc(name) {
      calls.push(name);
      return name === 'consume_customer_otp'
        ? { data: null, error: { code: 'PGRST202' } }
        : { data: { status: 'success', payload: {} }, error: null };
    },
  };
  assert.equal(
    (await consumeCustomerOtp(phone, '1234', { db: client, env: {} })).status,
    'success',
  );
  assert.deepEqual(calls, ['consume_customer_otp', 'consume_whatsapp_otp']);
  calls.length = 0;
  await assert.rejects(consumeCustomerOtp(phone, '123456', { db: client, env }));
  assert.deepEqual(calls, ['consume_customer_otp']);
});

test('missing expiry is rejected and non-Kazakhstan recipients cannot spend sending quota', async () => {
  await pg.query('insert into whatsapp_sessions(id,data,expires_at) values($1,$2,null)', [
    `otp_${phone}`,
    JSON.stringify({ code: '1234', attempts: 0 }),
  ]);
  assert.equal((await consumeCustomerOtp(phone, '1234', { db })).status, 'expired');
  let sent = false;
  await assert.rejects(
    startCustomerOtp(
      { ...request, phone: '+79991234567' },
      {
        db,
        env,
        sendOtp: async () => {
          sent = true;
          return { messageId: 'not-expected' };
        },
      },
    ),
    { code: 'OTP_INVALID_PHONE' },
  );
  assert.equal(sent, false);
  assert.equal((await pg.query('select * from customer_otp_send_limits')).rows.length, 0);
});

test('OTP storage functions are inaccessible to public clients', async () => {
  for (const role of ['anon', 'authenticated']) {
    const privileges = await pg.query(
      `select
      has_table_privilege($1, 'customer_otp_send_limits', 'SELECT') as readable,
      has_function_privilege($1, 'reserve_customer_otp(text,text,jsonb,integer)', 'EXECUTE') as issuable,
      has_function_privilege($1, 'consume_customer_otp(text,text,text)', 'EXECUTE') as verifiable`,
      [role],
    );
    assert.deepEqual(privileges.rows[0], { readable: false, issuable: false, verifiable: false });
  }
  assert.equal(customerOtpVerifyBodySchema.safeParse({ phone, code: '123456' }).success, true);
  assert.equal(customerOtpVerifyBodySchema.safeParse({ phone, code: '1234' }).success, true);
  assert.equal(customerOtpVerifyBodySchema.safeParse({ phone, code: '12345' }).success, false);
});
