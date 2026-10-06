const crypto = require('node:crypto');
const path = require('node:path');
const sharp = require('sharp');
const { supabase } = require('../config/supabase');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 512000;
const MAX_STRIP_BYTES = 500 * 1024;
const errors = {
  rate_limited: [429, 'PICKUP_PHOTO_RATE_LIMITED', 'Слишком много фото. Попробуйте позже.'],
  customer_unavailable: [401, 'CUSTOMER_SESSION_INVALID', 'Войдите в приложение ещё раз.'],
  request_changed: [409, 'PICKUP_PHOTO_REQUEST_CHANGED', 'Фото этого оформления уже закреплено.'],
  photo_unavailable: [410, 'PICKUP_PHOTO_EXPIRED', 'Добавьте фото заново.'],
  printer_unavailable: [
    409,
    'PICKUP_PHOTO_PRINTER_UNAVAILABLE',
    'Печать фото в этой точке сейчас недоступна.',
  ],
  terminal_unavailable: [403, 'POS_DEVICE_UNAUTHORIZED', 'Касса не привязана к филиалу.'],
  terminal_conflict: [
    409,
    'PICKUP_PHOTO_TERMINAL_CONFLICT',
    'Фото уже закреплено за другой кассой.',
  ],
  job_unavailable: [404, 'PICKUP_PHOTO_JOB_UNAVAILABLE', 'Задание печати недоступно.'],
  order_unavailable: [409, 'PICKUP_PHOTO_ORDER_UNAVAILABLE', 'Заказ не готов к печати фото.'],
  invalid_action: [409, 'PICKUP_PHOTO_ACTION_INVALID', 'Действие печати недоступно.'],
};
function fail(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
function checked(data) {
  if (data?.error) {
    const [status, code, message] = errors[data.error] || errors.job_unavailable;
    throw fail(code, message, status);
  }
  return data;
}
async function rpc(name, payload, db = supabase) {
  const { data, error } = await db.rpc(name, payload);
  // Database constraint details can contain private image data. Never log/return them.
  if (error)
    throw fail('PICKUP_PHOTO_STORAGE_UNAVAILABLE', 'Сервис фото временно недоступен.', 503);
  return checked(data);
}

async function normalizePhoto(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
    throw fail('PICKUP_PHOTO_TOO_LARGE', 'Выберите фото размером до 5 МБ.', 413);
  }
  const format = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
  if (!format) throw fail('PICKUP_PHOTO_FORMAT', 'Выберите фото JPEG, PNG или WebP.');
  try {
    const image = sharp(buffer, { limitInputPixels: 16000000, failOn: 'warning', animated: false });
    const meta = await image.metadata();
    if (meta.format !== format || !meta.width || !meta.height || (meta.pages || 1) !== 1) {
      throw new Error('Invalid photo');
    }
    // rotate() honors orientation; the fresh JPEG drops EXIF/GPS and animation.
    const output = await image
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: 576, height: 1000, fit: 'inside', withoutEnlargement: true })
      .greyscale()
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (output.data.length > MAX_IMAGE_BYTES) throw new Error('Image too large');
    return {
      buffer: output.data,
      width: output.info.width,
      height: output.info.height,
      bytes: output.data.length,
      sha256: crypto.createHash('sha256').update(output.data).digest('hex'),
    };
  } catch (_) {
    throw fail('PICKUP_PHOTO_FORMAT', 'Не удалось прочитать фото. Выберите другое изображение.');
  }
}

async function uploadPhoto(customerId, file, db = supabase) {
  const image = await normalizePhoto(file?.buffer, file?.mimetype);
  return rpc(
    'create_pickup_photo_upload',
    {
      p_customer: customerId,
      p_image: image.buffer.toString('base64'),
      p_sha: image.sha256,
      p_width: image.width,
      p_height: image.height,
      p_bytes: image.bytes,
    },
    db,
  );
}
async function photoCapability(branchId, db = supabase) {
  const ready = await rpc(
    'pickup_photo_printer_ready',
    { p_branch: branchId, p_terminal: null },
    db,
  );
  return { available: ready === true };
}
async function customerPhoto(customerId, photoId, { db = supabase, now = new Date() } = {}) {
  const { data, error } = await db
    .from('pickup_photo_uploads')
    .select('image_base64,expires_at,deleted_at')
    .eq('id', photoId)
    .eq('customer_id', customerId)
    .maybeSingle();
  if (error)
    throw fail('PICKUP_PHOTO_STORAGE_UNAVAILABLE', 'Сервис фото временно недоступен.', 503);
  if (!data) throw fail('PICKUP_PHOTO_NOT_FOUND', 'Фото не найдено.', 404);
  if (data.deleted_at || !data.image_base64 || new Date(data.expires_at) <= now)
    checked({ error: 'photo_unavailable' });
  return Buffer.from(data.image_base64, 'base64');
}
async function deleteCustomerPhoto(customerId, photoId, db = supabase) {
  return rpc('discard_pickup_photo_upload', { p_customer: customerId, p_photo: photoId }, db);
}
function photoId(payload) {
  return payload?.pickupPhotoId?.toLowerCase() || null;
}
function assertExistingPhoto(existing, payload) {
  if ((existing?.pickup_photo_id?.toLowerCase() || null) !== photoId(payload))
    checked({ error: 'request_changed' });
}
async function reserveCheckoutPhoto(customerId, checkoutId, payload, checkout, db = supabase) {
  const id = photoId(payload);
  if (id && checkout.effectiveFulfillmentType !== 'pickup') {
    throw fail('PICKUP_PHOTO_PICKUP_ONLY', 'Фото можно добавить только к самовывозу.');
  }
  // Null is also recorded: retrying an unknown payment must never add/change a photo.
  await rpc(
    'reserve_pickup_photo_checkout',
    { p_customer: customerId, p_checkout: checkoutId, p_photo: id, p_branch: checkout.branchId },
    db,
  );
  return id;
}

function ditherGrey(pixels, width, height) {
  const current = new Float32Array(width + 2),
    next = new Float32Array(width + 2);
  const output = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = Math.max(0, Math.min(255, pixels[y * width + x] + current[x + 1]));
      const bit = value < 128 ? 0 : 255;
      output[y * width + x] = bit;
      const error = value - bit;
      current[x + 2] += (error * 7) / 16;
      next[x] += (error * 3) / 16;
      next[x + 1] += (error * 5) / 16;
      next[x + 2] += error / 16;
    }
    current.set(next);
    next.fill(0);
  }
  return output;
}

async function renderStrip(image, number, widthDots = 384) {
  if (![384, 576].includes(widthDots) || !/^\d{1,15}$/.test(String(number))) {
    throw fail('PICKUP_PHOTO_PRINT_FORMAT', 'Некорректное задание печати.', 409);
  }
  const raw = await sharp(image, { limitInputPixels: 576000, failOn: 'warning' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: widthDots, height: 960, fit: 'inside' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mono = await sharp(ditherGrey(raw.data, raw.info.width, raw.info.height), {
    raw: { width: raw.info.width, height: raw.info.height, channels: 1 },
  })
    .png()
    .toBuffer();
  const logo = await sharp(path.join(__dirname, '../assets/pass.model/brand-logo.png'))
    .resize({ width: Math.round(widthDots * 0.5), height: 105, fit: 'inside' })
    .flatten({ background: '#ffffff' })
    .greyscale()
    .threshold(180)
    .png()
    .toBuffer({ resolveWithObject: true });
  const numberFont = Math.min(
    32,
    Math.floor((widthDots - 40) / ((String(number).length + 1) * 0.65)),
  );
  const heading = Buffer.from(
    `<svg width="${widthDots}" height="72" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="50%" y="22" text-anchor="middle" font-family="sans-serif" font-size="18" fill="black">Тапсырыс / Заказ</text><text x="50%" y="58" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="${numberFont}" fill="black">#${number}</text></svg>`,
  );
  const headerHeight = logo.info.height + 92;
  const composed = await sharp({
    create: {
      width: widthDots,
      height: headerHeight + raw.info.height + 16,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite([
      { input: logo.data, top: 8, left: Math.floor((widthDots - logo.info.width) / 2) },
      { input: heading, top: logo.info.height + 15, left: 0 },
      { input: mono, top: headerHeight, left: Math.floor((widthDots - raw.info.width) / 2) },
    ])
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Sharp composites after its image operations. Threshold in a second pipeline
  // so logo/text antialiasing cannot survive in the final thermal raster.
  const buffer = await sharp(composed.data, {
    raw: {
      width: composed.info.width,
      height: composed.info.height,
      channels: composed.info.channels,
    },
  })
    .flatten({ background: '#ffffff' })
    .greyscale()
    .threshold(128)
    .png({ palette: false, compressionLevel: 9 })
    .toBuffer();
  if (buffer.length > MAX_STRIP_BYTES)
    throw fail('PICKUP_PHOTO_PRINT_FORMAT', 'Фото слишком велико для печати.', 409);
  return buffer;
}
async function listPrintJobs(branchId, { terminalId, photoGiftVersion }, db = supabase) {
  if (photoGiftVersion !== 1) return { jobs: [] };
  return rpc('list_pickup_photo_print_jobs', { p_branch: branchId, p_terminal: terminalId }, db);
}
async function printAction(branchId, payload, db = supabase) {
  return rpc(
    'pickup_photo_print_action',
    {
      p_branch: branchId,
      p_terminal: payload.terminalId,
      p_order: payload.orderId,
      p_action: payload.action,
      p_error: payload.error || null,
    },
    db,
  );
}
async function printImage(branchId, orderId, terminalId, widthDots, db = supabase) {
  const data = await rpc(
    'pickup_photo_print_image',
    { p_branch: branchId, p_terminal: terminalId, p_order: orderId },
    db,
  );
  return renderStrip(Buffer.from(data.image, 'base64'), data.number, widthDots);
}
async function cleanupPhotos(db = supabase) {
  return rpc('cleanup_pickup_photos', {}, db);
}

module.exports = {
  MAX_UPLOAD_BYTES,
  MAX_IMAGE_BYTES,
  normalizePhoto,
  uploadPhoto,
  photoCapability,
  customerPhoto,
  deleteCustomerPhoto,
  reserveCheckoutPhoto,
  assertExistingPhoto,
  ditherGrey,
  renderStrip,
  listPrintJobs,
  printAction,
  printImage,
  cleanupPhotos,
};
