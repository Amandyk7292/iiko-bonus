const { createHash } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { join } = require('node:path');
let activeDecoders = 0;

const receiptError = (code, message, statusCode = 422) =>
  Object.assign(new Error(message), { code, statusCode });
const providers = new Map([
  ['consumer.wofd.kz', 'wofd'],
  ['cabinet.wofd.kz', 'wofd'],
  ['consumer.oofd.kz', 'oofd'],
  ['ofd1.kz', 'ttk'],
  ['my.webkassa.kz', 'webkassa'],
  ['kkm.webkassa.kz', 'webkassa'],
]);
const invalid = () =>
  receiptError('FORTUNE_RECEIPT_QR_INVALID', 'На фото нужен QR фискального чека');

function moneyCents(value) {
  const match = /^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.exec(String(value ?? ''));
  if (!match) return null;
  const result = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return result <= 1000000000 ? result : null;
}

function localReceiptTime(value) {
  const match = /^(20\d{2})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(String(value));
  if (!match) throw invalid();
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    throw invalid();
  // All Bulka branches currently use Kazakhstan UTC+5. Keep QR wall time for
  // exact comparison with iiko's unzoned CloseTime; never use accounting date.
  return {
    local: local.toISOString().slice(0, 19),
    utc: new Date(local.getTime() - 5 * 3600000).toISOString(),
  };
}

function parseReceiptQr(text) {
  if (
    typeof text !== 'string' ||
    text.length > 2048 ||
    [...text].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
  )
    throw invalid();
  let url;
  try {
    url = new URL(text);
  } catch {
    throw invalid();
  }
  const provider = providers.get(url.hostname);
  if (
    !provider ||
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    (url.hostname === 'cabinet.wofd.kz' && !/^\/consumer\/?$/.test(url.pathname))
  )
    throw invalid();
  const keys = [...url.searchParams.keys()];
  if (
    keys.length !== 4 ||
    new Set(keys).size !== 4 ||
    keys.some((key) => !['i', 'f', 's', 't'].includes(key))
  )
    throw invalid();
  const fiscalSign = url.searchParams.get('i');
  const registrationNumber = url.searchParams.get('f');
  if (
    !/^[1-9]\d{0,19}$/.test(fiscalSign) ||
    !/^\d{12}$/.test(registrationNumber) ||
    /^0+$/.test(registrationNumber)
  )
    throw invalid();
  const totalCents = moneyCents(url.searchParams.get('s'));
  if (totalCents === null || totalCents <= 0) throw invalid();
  const closed = localReceiptTime(url.searchParams.get('t'));
  return {
    provider,
    fiscalSign,
    registrationNumber,
    totalCents,
    total: totalCents / 100,
    closedAt: closed.utc,
    localClosedAt: closed.local,
    receiptIdentity: createHash('sha256')
      .update(`${registrationNumber}:${fiscalSign}:${closed.local}:${totalCents}`)
      .digest('hex'),
  };
}

const validateImageSize = (buffer) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 8 * 1024 * 1024)
    throw receiptError('FORTUNE_RECEIPT_IMAGE_INVALID', 'Выберите фото чека до 8 МБ', 400);
};

async function decodeReceipt(buffer) {
  validateImageSize(buffer);
  if (activeDecoders >= 2)
    throw receiptError(
      'FORTUNE_RECEIPT_BUSY',
      'Проверяем другие чеки. Попробуйте через несколько секунд',
      503,
    );
  activeDecoders++;
  return new Promise((resolve, reject) => {
    let worker;
    let timer;
    let finished = false;
    const complete = async (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (worker) await worker.terminate().catch(() => {});
      activeDecoders--;
      if (error) reject(error);
      else resolve(result);
    };
    try {
      const bytes = Uint8Array.from(buffer);
      worker = new Worker(join(__dirname, 'fortune-receipt-worker.js'), {
        workerData: bytes.buffer,
        transferList: [bytes.buffer],
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
      });
      timer = setTimeout(
        () =>
          complete(
            receiptError(
              'FORTUNE_RECEIPT_BUSY',
              'Проверка заняла слишком долго. Попробуйте ещё раз',
              503,
            ),
          ),
        30000,
      );
      worker.once('message', (message) =>
        complete(
          message.error
            ? receiptError(message.error.code, message.error.message, message.error.statusCode)
            : null,
          message.receipt,
        ),
      );
      worker.once('error', () =>
        complete(receiptError('FORTUNE_RECEIPT_BUSY', 'Проверка фото временно недоступна', 503)),
      );
      worker.once('exit', () =>
        complete(receiptError('FORTUNE_RECEIPT_BUSY', 'Проверка фото временно недоступна', 503)),
      );
    } catch {
      complete(receiptError('FORTUNE_RECEIPT_BUSY', 'Проверка фото временно недоступна', 503));
    }
  });
}

async function decodeReceiptImage(buffer, { sharpImpl, qrImpl, barcodeImpl } = {}) {
  validateImageSize(buffer);
  const sharp = sharpImpl || require('sharp');
  const jsQR = qrImpl || require('jsqr');
  const readCodes = barcodeImpl || require('./fortune-receipt-decoder').readReceiptCodes;
  try {
    const metadata = await sharp(buffer, {
      limitInputPixels: 16000000,
      failOn: 'error',
    }).metadata();
    if (
      !['jpeg', 'png', 'webp'].includes(metadata.format) ||
      (metadata.pages || 1) !== 1 ||
      !Number.isInteger(metadata.width) ||
      !Number.isInteger(metadata.height) ||
      metadata.width * metadata.height > 16000000
    )
      throw receiptError(
        'FORTUNE_RECEIPT_IMAGE_INVALID',
        'Нужно фото чека в JPEG, PNG или WebP',
        400,
      );
    const { data: oriented, info: dimensions } = await sharp(buffer, {
      limitInputPixels: 16000000,
      failOn: 'error',
    })
      .rotate()
      .toBuffer({ resolveWithObject: true });
    const results = new Map();
    // A paper receipt may contain a loyalty QR above its fiscal QR. Decode and
    // erase each located code before searching again; never trust the first QR.
    const scans = [{ size: 1800 }, { size: 1200 }];
    if (dimensions.height > dimensions.width * 1.5)
      scans.push({ size: 1800, region: 'top' }, { size: 1800, region: 'bottom' });
    if (dimensions.width > dimensions.height * 1.5)
      scans.push({ size: 1800, region: 'left' }, { size: 1800, region: 'right' });
    for (const scan of scans) {
      let frame = sharp(oriented);
      if (scan.region === 'top' || scan.region === 'bottom') {
        const top = scan.region === 'bottom' ? Math.floor(dimensions.height * 0.4) : 0;
        frame = frame.extract({
          left: 0,
          top,
          width: dimensions.width,
          height:
            scan.region === 'bottom' ? dimensions.height - top : Math.ceil(dimensions.height * 0.6),
        });
      }
      if (scan.region === 'left' || scan.region === 'right') {
        const left = scan.region === 'right' ? Math.floor(dimensions.width * 0.4) : 0;
        frame = frame.extract({
          left,
          top: 0,
          height: dimensions.height,
          width:
            scan.region === 'right' ? dimensions.width - left : Math.ceil(dimensions.width * 0.6),
        });
      }
      const { data, info } = await frame
        .resize({ width: scan.size, height: scan.size, fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixels = new Uint8ClampedArray(data);
      // Dense thermal-print QR codes can escape jsQR even when a phone reads
      // them. Check all valid codes with the stronger local decoder as well;
      // fiscal parsing and multi-receipt ambiguity checks remain unchanged.
      const codes = await readCodes(pixels, info.width, info.height);
      for (const code of codes) {
        if (
          code.isValid !== true ||
          code.error ||
          !['QRCode', 'QRCodeModel2'].includes(code.format) ||
          typeof code.text !== 'string'
        )
          continue;
        try {
          const receipt = parseReceiptQr(code.text);
          results.set(JSON.stringify(receipt), receipt);
        } catch {
          /* A decoded QR is not sufficient fiscal proof by itself. */
        }
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const found = jsQR(pixels, info.width, info.height, { inversionAttempts: 'attemptBoth' });
        if (!found?.data) break;
        try {
          const receipt = parseReceiptQr(found.data);
          results.set(JSON.stringify(receipt), receipt);
        } catch {
          /* A loyalty/payment QR is not a fiscal receipt. */
        }
        const corners = Object.values(found.location || {}).filter(
          (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y),
        );
        if (!corners.length) break;
        const left = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))) - 4);
        const right = Math.min(info.width, Math.ceil(Math.max(...corners.map((p) => p.x))) + 4);
        const top = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))) - 4);
        const bottom = Math.min(info.height, Math.ceil(Math.max(...corners.map((p) => p.y))) + 4);
        for (let y = top; y < bottom; y++) {
          for (let x = left; x < right; x++)
            pixels.fill(255, (y * info.width + x) * 4, (y * info.width + x + 1) * 4);
        }
      }
    }
    if (results.size === 1) return [...results.values()][0];
    if (results.size > 1)
      throw receiptError('FORTUNE_RECEIPT_AMBIGUOUS', 'Прикрепите фото одного фискального чека');
    throw receiptError(
      'FORTUNE_RECEIPT_QR_UNREADABLE',
      'Не удалось прочитать QR. Снимите код крупнее и без бликов',
    );
  } catch (error) {
    if (error.code?.startsWith('FORTUNE_')) throw error;
    throw receiptError('FORTUNE_RECEIPT_IMAGE_INVALID', 'Не удалось прочитать фото чека', 400);
  }
}

module.exports = { parseReceiptQr, decodeReceipt, decodeReceiptImage, moneyCents, receiptError };
