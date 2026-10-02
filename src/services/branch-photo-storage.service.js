const { createClient } = require('@supabase/supabase-js');
const { supabase } = require('../config/supabase');
const crypto = require('node:crypto');
const { rows, fail, assertScope } = require('./branch-photo-reports.service');
const BUCKET = 'branch-closing-photos';
let client;
function photoStorage() {
  client ||= createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (url, options = {}) =>
          fetch(url, {
            ...options,
            signal: options.signal
              ? AbortSignal.any([options.signal, AbortSignal.timeout(60000)])
              : AbortSignal.timeout(60000),
          }),
      },
    },
  );
  return client.storage;
}
async function photoForAdmin(
  admin,
  photoId,
  { db = supabase, storage = photoStorage(), now = new Date() } = {},
) {
  const photo = await rows(
    db
      .from('branch_closing_photos')
      .select('object_path,upload_id,expires_at,deleted_at')
      .eq('id', photoId)
      .maybeSingle(),
  );
  if (!photo) throw fail('Фото не найдено', 404);
  const report = await rows(
    db
      .from('branch_closing_reports')
      .select('branch_id')
      .eq('upload_id', photo.upload_id)
      .maybeSingle(),
  );
  if (!report) throw fail('Фото не найдено', 404);
  assertScope(admin, report.branch_id);
  if (photo.deleted_at || new Date(photo.expires_at) <= now)
    throw fail(
      'Фото удалено после 3 дней. История отправки сохранена.',
      410,
      'PHOTO_REPORT_PHOTO_EXPIRED',
    );
  const { data, error } = await storage.from(BUCKET).download(photo.object_path);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}
async function cleanupPhotos({ db = supabase, storage = photoStorage() } = {}) {
  const claim = crypto.randomUUID();
  const photos = await rows(
    db.rpc('claim_branch_closing_photo_cleanup', { p_claim: claim, p_limit: 100 }),
  );
  if (!photos.length) return { deleted: 0 };
  for (const photo of photos) {
    if (!/^uploads\/[a-f0-9-]{36}\/[0-9]\.jpg$/.test(photo.object_path))
      throw new Error('Unsafe closing-photo storage path');
  }
  const { error } = await storage.from(BUCKET).remove(photos.map((p) => p.object_path));
  if (error) throw error; // Retry leased objects; never mark failed removals as deleted.
  await rows(
    db
      .from('branch_closing_photos')
      .update({ deleted_at: new Date().toISOString(), cleanup_lease_until: null })
      .in(
        'id',
        photos.map((p) => p.id),
      )
      .eq('cleanup_claim', claim),
  );
  return { deleted: photos.length };
}
module.exports = { BUCKET, photoStorage, photoForAdmin, cleanupPhotos };
