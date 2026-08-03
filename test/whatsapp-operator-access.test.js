const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');

process.env.CUSTOMER_JWT_SECRET = 'w'.repeat(64);
process.env.WHATSAPP_OPERATOR_ACCESS_TOKEN_HASH = crypto
  .createHash('sha256')
  .update('a'.repeat(43), 'utf8')
  .digest('hex');

const app = require('../src/app');
const {
  ADMIN_ROLES,
  ROLE_AREAS,
  whatsappOperatorAccessHandler,
} = require('../src/middlewares/auth.middleware');
const { verifyToken } = require('../src/services/auth.service');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    cookieValue: '',
    cookieOptions: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    cookie(_name, value, options) {
      this.cookieValue = value;
      this.cookieOptions = options;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('WhatsApp operator magic token creates a scoped 12-hour HttpOnly session', async () => {
  const response = responseRecorder();
  await whatsappOperatorAccessHandler({ body: { token: 'a'.repeat(43) } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.user.role, 'whatsapp_operator');
  assert.equal(response.cookieOptions.httpOnly, true);
  assert.equal(response.cookieOptions.sameSite, 'strict');
  assert.equal(response.cookieOptions.path, '/admin');
  assert.equal(response.cookieOptions.maxAge, 12 * 60 * 60 * 1000);
  assert.equal(verifyToken(response.cookieValue, 'bulka-admin').role, 'whatsapp_operator');
  assert.equal(ADMIN_ROLES.has('whatsapp_operator'), true);
  assert.deepEqual([...ROLE_AREAS.whatsapp_operator], ['session', 'events', 'whatsapp']);
});

test('WhatsApp operator magic token fails closed without setting a cookie', async () => {
  const response = responseRecorder();
  await whatsappOperatorAccessHandler({ body: { token: 'b'.repeat(43) } }, response);

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, 'WHATSAPP_OPERATOR_ACCESS_INVALID');
  assert.equal(response.cookieValue, '');
});

test('operator session cannot reach bot configuration or other admin areas', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const origin = `http://127.0.0.1:${server.address().port}`;
  const exchange = await fetch(`${origin}/admin/api/whatsapp/operator-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ token: 'a'.repeat(43) }),
  });
  assert.equal(exchange.status, 200);
  const cookie = String(exchange.headers.get('set-cookie') || '').split(';')[0];
  assert.match(cookie, /^bulka_admin=/);

  const session = await fetch(`${origin}/admin/api/session`, { headers: { Cookie: cookie } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.role, 'whatsapp_operator');

  const deniedRequests = [
    { path: '/admin/api/settings', method: 'GET' },
    { path: '/admin/api/whatsapp/settings', method: 'GET' },
    { path: '/admin/api/whatsapp/pairing/reset', method: 'POST' },
    { path: '/admin/api/whatsapp/knowledge', method: 'GET' },
    {
      path: '/admin/api/whatsapp/conversations/test-id/memories',
      method: 'POST',
      body: { label: 'Скрытая заметка', content: 'Нельзя сохранить' },
    },
    {
      path: '/admin/api/whatsapp/conversations/test-id',
      method: 'PATCH',
      body: { assistantEnabled: true },
    },
  ];

  for (const request of deniedRequests) {
    const response = await fetch(`${origin}${request.path}`, {
      method: request.method,
      headers: {
        Cookie: cookie,
        Origin: origin,
        ...(request.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    });
    assert.equal(response.status, 403, `${request.method} ${request.path}`);
  }

  const invalidVoice = new FormData();
  invalidVoice.append('audio', new Blob(['not audio'], { type: 'audio/webm' }), 'voice.webm');
  invalidVoice.append('durationSeconds', '2');
  const invalidVoiceResponse = await fetch(
    `${origin}/admin/api/whatsapp/conversations/11111111-1111-4111-8111-111111111111/voice`,
    {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin },
      body: invalidVoice,
    },
  );
  assert.equal(invalidVoiceResponse.status, 400);
  assert.equal((await invalidVoiceResponse.json()).code, 'WHATSAPP_INVALID_AUDIO');
});
