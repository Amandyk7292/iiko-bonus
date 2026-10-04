const { supabase } = require('../config/supabase');
const { logger } = require('../config/logger');
const { rows } = require('./branch-photo-report-access.service');

// Authorization is durable: an approved tablet stays connected until revoked,
// even if it has not opened the reporting page recently.
async function approvedDeviceCounts(branchIds, { db = supabase } = {}) {
  const counts = new Map(branchIds.map((id) => [id, 0]));
  if (!counts.size) return counts;
  try {
    for (let offset = 0; ; offset += 1000) {
      const page = await rows(
        db
          .from('branch_closing_devices')
          .select('branch_id')
          .eq('status', 'active')
          .in('branch_id', [...counts.keys()])
          .order('id')
          .range(offset, offset + 999),
      );
      for (const device of page) {
        if (counts.has(device.branch_id))
          counts.set(device.branch_id, counts.get(device.branch_id) + 1);
      }
      if (page.length < 1000) return counts;
    }
  } catch (error) {
    logger.warn(
      { event: 'photo_report_device_summary_unavailable', code: error.code || 'unknown' },
      'Не удалось проверить подключение планшетов фотоотчётов.',
    );
    // Never turn an unavailable or partially loaded summary into zero counts.
    return null;
  }
}

module.exports = { approvedDeviceCounts };
