const { readFileSync } = require('node:fs');
const devices = require('../../src/services/branch-photo-devices.service');
const admin = require('../../src/services/branch-photo-device-admin.service');
async function applyDeviceMigration(pg, { persistent = true } = {}) {
  await pg.exec(
    readFileSync('supabase/migrations/20261004150000_branch_photo_report_devices.sql', 'utf8'),
  );
  if (persistent)
    await pg.exec(
      readFileSync(
        'supabase/migrations/20261007150000_persistent_branch_photo_report_sessions.sql',
        'utf8',
      ),
    );
}
async function approveDevice(qrToken, { db, name = 'Планшет точки' }) {
  const request = await devices.request(qrToken, '', { db });
  await admin.approve(
    { role: 'owner' },
    request.body.device.id,
    { code: request.body.pairingCode, name },
    { db },
  );
  return request.token;
}
module.exports = { applyDeviceMigration, approveDevice };
