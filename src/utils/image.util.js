const sharp = require('sharp');

const MAX_IMAGE_EDGE = 1600;
const MAX_IMAGE_PIXELS = 32 * 1024 * 1024;
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 82;

const imageError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const IMAGE_FORMATS = Object.freeze({
  'image/jpeg': { format: 'jpeg', extension: 'jpg' },
  'image/png': { format: 'png', extension: 'png' },
  'image/webp': { format: 'webp', extension: 'webp' },
});

/**
 * Fully decodes every accepted upload, rejects animations/decompression bombs,
 * auto-orients JPEGs and always re-encodes without EXIF, ICC, XMP or GPS data.
 */
const optimizeUploadedImage = async (buffer, mime) => {
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

  if (expected.format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  } else if (expected.format === 'png') {
    pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  } else {
    pipeline = pipeline.webp({ quality: WEBP_QUALITY, effort: 4 });
  }

  try {
    return {
      buffer: await pipeline.toBuffer(),
      mime,
      extension: expected.extension,
      optimized: true,
    };
  } catch (_error) {
    throw imageError('Не удалось безопасно обработать изображение', 400);
  }
};

module.exports = {
  JPEG_QUALITY,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  WEBP_QUALITY,
  optimizeUploadedImage,
};
