const assert = require('node:assert/strict');
const test = require('node:test');

const fetchPath = require.resolve('node-fetch');
const servicePath = require.resolve('../src/services/iiko.service');

const response = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    return payload;
  },
  async text() {
    return typeof payload === 'string' ? payload : JSON.stringify(payload);
  },
});

async function withFetchMock(fetchMock, callback) {
  const previousFetch = require.cache[fetchPath];
  const previousService = require.cache[servicePath];
  require.cache[fetchPath] = {
    id: fetchPath,
    filename: fetchPath,
    loaded: true,
    exports: fetchMock,
  };
  delete require.cache[servicePath];
  try {
    const { IikoAPI } = require(servicePath);
    return await callback(IikoAPI);
  } finally {
    delete require.cache[servicePath];
    if (previousService) require.cache[servicePath] = previousService;
    if (previousFetch) require.cache[fetchPath] = previousFetch;
    else delete require.cache[fetchPath];
  }
}

test('legacy iiko API login keeps using the v1 access-token endpoint', async () => {
  const requests = [];
  await withFetchMock(
    async (url, options) => {
      requests.push({ path: new URL(url).pathname, body: JSON.parse(options.body) });
      return response({ token: 'legacy-token' });
    },
    async (IikoAPI) => {
      const client = new IikoAPI({
        apiLogin: 'legacy-login-1234567890',
        appId: '',
        clientSecret: '',
      });
      assert.equal(await client.getToken(), 'legacy-token');
    },
  );

  assert.deepEqual(requests, [
    {
      path: '/api/1/access_token',
      body: { apiLogin: 'legacy-login-1234567890' },
    },
  ]);
});

test('new iiko API key automatically retries through the v2 endpoint', async () => {
  const requests = [];
  await withFetchMock(
    async (url, options) => {
      const request = { path: new URL(url).pathname, body: JSON.parse(options.body) };
      requests.push(request);
      if (request.path === '/api/1/access_token') {
        return response(
          {
            errorDescription:
              'This API key does not support /api/1/access_token. Please use /api/v2/access_token instead.',
          },
          400,
        );
      }
      return response({ token: 'v2-token' });
    },
    async (IikoAPI) => {
      const client = new IikoAPI({
        apiLogin: 'new-api-key-1234567890123456',
        appId: '11111111-1111-4111-8111-111111111111',
        clientSecret: 'shared-client-secret',
      });
      assert.equal(await client.getToken(), 'v2-token');
    },
  );

  assert.deepEqual(requests, [
    {
      path: '/api/1/access_token',
      body: { apiLogin: 'new-api-key-1234567890123456' },
    },
    {
      path: '/api/v2/access_token',
      body: {
        apiKey: 'new-api-key-1234567890123456',
        appId: '11111111-1111-4111-8111-111111111111',
        clientSecret: 'shared-client-secret',
      },
    },
  ]);
});
