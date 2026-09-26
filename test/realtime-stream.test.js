const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const compression = require('compression');
const realtime = require('../src/services/realtime.service');

test('SSE bypasses compression and immediately delivers cashier stock invalidation', async () => {
  const app = express();
  app.use(compression());
  app.get('/events', (req, res) => realtime.openStream(req, res, { public: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  let request;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Stock event was buffered')), 1500);
      request = http.get(
        `http://127.0.0.1:${server.address().port}/events`,
        { headers: { 'Accept-Encoding': 'gzip' } },
        (response) => {
          try {
            assert.notEqual(response.headers['content-encoding'], 'gzip');
          } catch (error) {
            clearTimeout(timer);
            reject(error);
            return;
          }
          let body = '';
          let sent = false;
          response.on('data', (chunk) => {
            body += chunk.toString();
            if (!sent && body.includes('connected')) {
              sent = true;
              realtime.publish(
                'menu.updated',
                { inventory: true, branchId: 'test-branch' },
                { adminOnly: true, branchId: 'test-branch' },
              );
            }
            if (body.includes('client.data.changed') && body.includes('test-branch')) {
              clearTimeout(timer);
              resolve();
            }
          });
        },
      );
      request.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  } finally {
    request?.destroy();
    realtime.resetForTests();
    await new Promise((resolve) => server.close(resolve));
  }
});
