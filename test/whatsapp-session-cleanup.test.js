const assert = require('node:assert/strict');
const test = require('node:test');

const {
  cleanupExpiredWhatsAppSessions,
  expiredLegacySessionIds,
} = require('../src/services/whatsapp-session-cleanup.service');

const now = new Date('2026-08-04T19:00:00.000Z');

test('WhatsApp TTL recognizes only expired login and OTP rows', () => {
  const rows = [
    { id: 'token_expired', data: JSON.stringify({ expires: now.getTime() - 1 }) },
    { id: 'otp_expired', data: { expiresAt: now.getTime() - 10_000 } },
    { id: 'token_active', data: { expires: now.getTime() + 60_000 } },
    { id: 'pre-key-secret', data: { expires: now.getTime() - 60_000 } },
    { id: 'session-device', data: { expires: now.getTime() - 60_000 } },
    { id: 'creds', data: { expires: now.getTime() - 60_000 } },
    { id: 'task_chat_1', data: { expires: now.getTime() - 60_000 } },
  ];

  assert.deepEqual(expiredLegacySessionIds(rows, now), ['token_expired', 'otp_expired']);
});

test('WhatsApp TTL cleanup preserves Baileys credentials and active tasks', async () => {
  const deletedBatches = [];
  const repository = {
    async deleteExpiredColumn(expiresAt) {
      assert.equal(expiresAt, now.toISOString());
      return ['token_column_expired'];
    },
    async listLegacyCandidates() {
      return [
        { id: 'token_legacy_expired', data: { expires: now.getTime() - 1 } },
        { id: 'otp_active', data: { expires: now.getTime() + 60_000 } },
        { id: 'creds', data: { expires: now.getTime() - 1 } },
        { id: 'task_team_1', data: { expires: now.getTime() - 1 } },
      ];
    },
    async deleteByIds(ids) {
      deletedBatches.push([...ids]);
      return [...ids];
    },
  };

  const summary = await cleanupExpiredWhatsAppSessions({ repository, now });

  assert.deepEqual(deletedBatches, [['token_legacy_expired']]);
  assert.deepEqual(summary, {
    inspectedLegacy: 4,
    deleted: 2,
    deletedByColumn: 1,
    deletedLegacy: 1,
  });
});

test('WhatsApp TTL cleanup fails closed on a partial database deletion', async () => {
  const repository = {
    async deleteExpiredColumn() {
      return [];
    },
    async listLegacyCandidates() {
      return [{ id: 'otp_expired', data: { expires: now.getTime() - 1 } }];
    },
    async deleteByIds() {
      return [];
    },
  };

  await assert.rejects(
    cleanupExpiredWhatsAppSessions({ repository, now }),
    (error) => error.code === 'WHATSAPP_SESSION_CLEANUP_MISMATCH',
  );
});
