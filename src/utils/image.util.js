const sharp = require('sharp');

const MAX_IMAGE_EDGE = 1600;
const MAX_IMAGE_PIXELS = 32 * 1024 * 1024;
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 82;
const MENU_PHOTO_QUALITY = 95;

const imageError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const IMAGE_FORMATS = Object.freeze({
  'image/jpeg': { format: 'jpeg', extension: 'jpg' },
  'image/png': { format: 'png', extension: 'png' },
  'image/webp': { format: 'webp', extension: 'webp' },
});

// A clean, already-sized lossy WebP can be retained after a full decode instead of
// receiving another lossy encode. Reject metadata/unknown chunks and trailing
// data from this fast path; those inputs must be sanitized by re-encoding.
const canRetainWebp = (buffer, metadata, edge) => {
  if (
    metadata.format !== 'webp' ||
    metadata.width > edge ||
    metadata.height > edge ||
    metadata.orientation ||
    Number(metadata.pages || 1) !== 1 ||
    buffer.length < 20 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP' ||
    buffer.readUInt32LE(4) + 8 !== buffer.length
  )
    return false;
  const allowed = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH']);
  let offset = 12;
  let photographicPayload = false;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    if (!allowed.has(type)) return false;
    if (type === 'VP8 ') photographicPayload = true;
    const length = buffer.readUInt32LE(offset + 4);
    offset += 8 + length + (length % 2);
  }
  return offset === buffer.length && photographicPayload;
};

/**
 * Fully decodes every accepted upload, rejects animations/decompression bombs,
 * Auto-orients and strips metadata. Catalog photos encode directly to WebP95;
 * other image uses retain their existing format and quality policy.
 */
const processUploadedImage = async (buffer, mime, photo) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw imageError('Изображение пустое', 400);
  }
  const expected = IMAGE_FORMATS[mime];
  if (!expected) throw imageError('Неподдерживаемый формат изображения', 400);

  let metadata;
  try {
    metadata = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    }).metadata();
  } catch (_error) {
    throw imageError('Не удалось прочитать изображение', 400);
  }

  const width = Number(metadata.width);
  const height = Number(metadata.height);
  if (
    metadata.format !== expected.format ||
    !width ||
    !height ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw imageError('Некорректный формат или слишком большое разрешение изображения', 413);
  }
  if (Number(metadata.pages || 1) !== 1) {
    throw imageError('Анимированные изображения не поддерживаются', 400);
  }

  if (photo && canRetainWebp(buffer, metadata, MAX_IMAGE_EDGE)) {
    try {
      // Metadata alone cannot validate a truncated or corrupt pixel payload.
      await sharp(buffer, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS }).raw().toBuffer();
      return {
        buffer,
        mime: 'image/webp',
        extension: 'webp',
        optimized: true,
        width,
        height,
        encoding: 'webp-source',
      };
    } catch (_error) {
      throw imageError('Не удалось безопасно обработать изображение', 400);
    }
  }

  let pipeline = sharp(buffer, {
    failOn: 'error',
    limitInputPixels: MAX_IMAGE_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });

  if (photo) {
    pipeline = pipeline.webp({ quality: MENU_PHOTO_QUALITY, alphaQuality: 100, effort: 4 });
  } else if (expected.format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  } else if (expected.format === 'png') {
    pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  } else {
    pipeline = pipeline.webp({ quality: WEBP_QUALITY, effort: 4 });
  }

  try {
    const result = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      buffer: result.data,
      mime: photo ? 'image/webp' : mime,
      extension: photo ? 'webp' : expected.extension,
      optimized: true,
      ...(photo && {
        width: result.info.width,
        height: result.info.height,
        encoding: 'webp-photo-v1',
      }),
    };
  } catch (_error) {
    throw imageError('Не удалось безопасно обработать изображение', 400);
  }
};

const optimizeUploadedImage = (buffer, mime) => processUploadedImage(buffer, mime, false);
const optimizeMenuPhoto = (buffer, mime) => processUploadedImage(buffer, mime, true);

module.exports = {
  JPEG_QUALITY,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  WEBP_QUALITY,
  MENU_PHOTO_QUALITY,
  canRetainWebp,
  optimizeUploadedImage,
  optimizeMenuPhoto,
};
