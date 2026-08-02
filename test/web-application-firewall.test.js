const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const {
  inspectRequest,
  webApplicationFirewall,
} = require('../src/middlewares/web-application-firewall.middleware');

const startServer = async (t) => {
  const app = express();
  app.use(webApplicationFirewall);
  app.use((req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
};

test('WAF lets normal Cyrillic catalog queries through and marks the response', async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(
    `${baseUrl}/catalog?search=${encodeURIComponent('датский с маком')}`,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-bulka-waf'), 'active');
  assert.deepEqual(await response.json(), { ok: true });
});

test('WAF blocks the OWASP CRS local-file-inclusion verification request', async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/?foo=/etc/passwd&bar=/bin/sh`);

  assert.equal(response.status, 403);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.error, 'Request blocked');
  assert.equal(body.code, 'WAF_BLOCKED');
});

test('WAF blocks encoded traversal, SQL injection, XSS and secret-file probes', () => {
  const request = (url) => ({ method: 'GET', originalUrl: url, headers: {} });

  assert.equal(inspectRequest(request('/%252e%252e%252fetc/passwd')), 'path-traversal-or-lfi');
  assert.equal(inspectRequest(request('/search?q=%27+or+1%3D1')), 'sql-injection');
  assert.equal(inspectRequest(request('/search?q=%3Cscript%3Ealert(1)')), 'cross-site-scripting');
  assert.equal(inspectRequest(request('/.env')), 'sensitive-resource-probe');
});

test('WAF rejects unsafe HTTP methods before the application router', async (t) => {
  const baseUrl = await startServer(t);
  const target = new URL(baseUrl);
  const result = await new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: '/',
        method: 'TRACE',
      },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response));
      },
    );
    request.once('error', reject);
    request.end();
  });

  assert.equal(result.statusCode, 403);
  assert.equal(result.headers['x-bulka-waf'], 'active');
});
