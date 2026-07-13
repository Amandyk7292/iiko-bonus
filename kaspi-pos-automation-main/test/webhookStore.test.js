import assert from 'node:assert/strict';
import { it } from 'node:test';

process.env.PUBLIC_BASE_URL = 'https://example.test';
process.env.KASPI_WEBHOOK_SECRET = 'w'.repeat(32);

const { getWebhooksByEvent } = await import('../src/webhookStore.js');

it('configures the first-party payment webhook from deployment environment', () => {
  const hooks = getWebhooksByEvent('payment.success');
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].url, 'https://example.test/webhooks/kaspi');
  assert.equal(hooks[0].secret.length, 32);
});
