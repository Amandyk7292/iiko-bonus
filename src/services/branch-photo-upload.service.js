const crypto = require('node:crypto');
const sharp = require('sharp');
const { supabase } = require('../config/supabase');
const { rows, fail, tokenHash, resolveSession } = require('./branch-photo-reports.service');
const { BUCKET, photoStorage } = require('./branch-photo-storage.service');
const messages = {
  photo_limit: 'В отчёте должно быть от 1 до 10 снимков.',
  session_expired: 'Сеанс завершён. Отсканируйте QR точки заново.',
  link_invalid: 'QR точки больше не действует.',
  already_submitted: 'Этот отчёт уже отправлен.',
  upload_conflict: 'Начните отправку заново.',
  upload_busy: 'Отчёт ещё отправляется. Подождите и обновите страницу.',
  upload_expired: 'Снимки устарели. Сделайте новый отчёт.',
  photos_incomplete: 'Не все снимки загрузились. Повторите отправку.',
  device_required: 'Подтвердите этот планшет у управляющего.',
  device_revoked: 'Доступ планшета отозван.',
  device_expired: 'Код подтверждения планшета истёк.',
  device_branch_mismatch: 'Планшет закреплён за другой точкой.',
};
function checked(result) {
  if (result.error)
    throw fail(
      messages[result.error] || 'Не удалось отправить фотоотчёт',
      result.error.startsWith('device_')
        ? 403
        : result.error === 'session_expired' || result.error === 'link_invalid'
          ? 401
          : 409,
      `PHOTO_REPORT_${result.error.toUpperCase()}`,
    );
  return result;
}
async function preparePhotos(files, uploadId) {
  if (
    !files?.length ||
    files.length > 10 ||
    files.reduce((sum, f) => sum + f.buffer.length, 0) > 12000000
  )
    throw fail('От 1 до 10 фото, общий размер — до 12 МБ.', 413);
  const photos = [];
  for (let position = 0; position < files.length; position++) {
    let output;
    try {
      const image = sharp(files[position].buffer, {
        limitInputPixels: 16000000,
        animated: false,
        failOn: 'warning',
      });
      const meta = await image.metadata();
      if (meta.format !== 'jpeg' || (meta.pages || 1) > 1 || !meta.width || !meta.height)
        throw new Error('Invalid camera image');
      output = await image
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw fail(
        'Не удалось прочитать снимок. Сделайте фото заново.',
        415,
        'PHOTO_REPORT_INVALID_IMAGE',
      );
    }
    photos.push({
      id: crypto.randomUUID(),
      position,
      path: `uploads/${uploadId}/${position}.jpg`,
      bytes: output.data.length,
      width: output.info.width,
      height: output.info.height,
      buffer: output.data,
      hash: crypto.createHash('sha256').update(output.data).digest('hex'),
    });
  }
  return photos;
}
async function submitPhotos(
  sessionToken,
  body,
  files,
  { db = supabase, storage = photoStorage(), deviceToken } = {},
) {
  await resolveSession(sessionToken, { db, deviceToken });
  const photos = await preparePhotos(files, body.uploadId);
  const claim = crypto.randomUUID();
  const result = checked(
    await rows(
      db.rpc('claim_branch_closing_upload', {
        p_session_hash: tokenHash(sessionToken),
        p_upload_id: body.uploadId,
        p_kind: body.kind,
        p_manifest_hash: crypto
          .createHash('sha256')
          .update(JSON.stringify(photos.map((p) => p.hash)))
          .digest('hex'),
        p_photos: photos.map(({ buffer: _buffer, hash: _hash, ...p }) => p),
        p_claim: claim,
        p_device_hash: tokenHash(deviceToken),
      }),
    ),
  );
  if (result.submitted) return result;
  try {
    for (const photo of photos) {
      const { error } = await storage.from(BUCKET).upload(photo.path, photo.buffer, {
        contentType: 'image/jpeg',
        cacheControl: '0',
        upsert: true,
      });
      if (error) throw error;
      await rows(
        db
          .from('branch_closing_photos')
          .update({ stored_at: new Date().toISOString() })
          .eq('upload_id', body.uploadId)
          .eq('position', photo.position)
          .is('deleted_at', null)
          .is('cleanup_claim', null),
      );
    }
    return checked(
      await rows(
        db.rpc('finish_branch_closing_upload', {
          p_upload_id: body.uploadId,
          p_claim: claim,
          p_device_hash: tokenHash(deviceToken),
        }),
      ),
    );
  } catch (error) {
    // Keep recorded objects for a retry; abandoned uploads also enter automatic cleanup.
    await rows(
      db
        .from('branch_closing_uploads')
        .update({ lease_until: new Date().toISOString() })
        .eq('id', body.uploadId)
        .eq('claim', claim)
        .is('submitted_at', null),
    ).catch(() => {});
    throw error;
  }
}
module.exports = { preparePhotos, submitPhotos, checked };
