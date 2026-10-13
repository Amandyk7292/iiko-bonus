const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseReceiptQr,
  decodeReceipt,
  decodeReceiptImage,
} = require('../src/services/fortune-receipt-qr');
const valid = 'https://consumer.wofd.kz/?i=527035232&f=090500022375&s=3007.50&t=20261010T191800';

test('Kazakhstan fiscal QR preserves RNM/sign identity, exact cents and UTC+5 wall time', () => {
  const receipt = parseReceiptQr(valid);
  assert.equal(receipt.registrationNumber, '090500022375');
  assert.equal(receipt.fiscalSign, '527035232');
  assert.equal(receipt.totalCents, 300750);
  assert.equal(receipt.localClosedAt, '2026-10-10T19:18:00');
  assert.equal(receipt.closedAt, '2026-10-10T14:18:00.000Z');
  assert.equal(receipt.provider, 'wofd');
  assert.equal(
    parseReceiptQr(valid.replace('https://consumer.wofd.kz/', 'http://consumer.wofd.kz/'))
      .receiptIdentity,
    receipt.receiptIdentity,
  );
  assert.equal(
    parseReceiptQr(valid.replace('3007.50', '3007.5')).receiptIdentity,
    receipt.receiptIdentity,
  );
});

test('parser rejects arbitrary URLs, duplicate params, credentials and malformed fiscal proof', () => {
  for (const value of [
    valid.replace('consumer.wofd.kz', '127.0.0.1'),
    valid.replace('consumer.wofd.kz', 'consumer.wofd.kz.evil.example'),
    valid.replace('consumer.wofd.kz', 'user:pass@consumer.wofd.kz'),
    valid.replace('consumer.wofd.kz', 'consumer.wofd.kz:8443'),
    valid + '&i=1',
    valid + '&url=https://example.com',
    valid + '#unsafe',
    valid.replace('090500022375', 'SWK00534409'),
    valid.replace('090500022375', '000000000000'),
    valid.replace('3007.50', '3007.501'),
    valid.replace('3007.50', '-3'),
    valid.replace('3007.50', '0'),
    valid.replace('3007.50', '1e5'),
    valid.replace('20261010T191800', '20260230T191800'),
    valid.replace('20261010T191800', '20261010T241800'),
    't=20261010T191800&s=3007.50&fn=1&i=1&fp=2&n=1',
  ])
    assert.throws(() => parseReceiptQr(value), { code: 'FORTUNE_RECEIPT_QR_INVALID' });
});

test('server decodes the uploaded QR image locally and applies the same strict parser', async () => {
  const QRCode = require('qrcode');
  const sharp = require('sharp');
  const image = await QRCode.toBuffer(valid, { margin: 4, width: 700 });
  const rotated = await sharp(image).rotate(90).jpeg().toBuffer();
  assert.deepEqual(await decodeReceipt(rotated), parseReceiptQr(valid));
  assert.equal((await decodeReceipt(image)).total, 3007.5);
  const foreign = await QRCode.toBuffer('https://example.com/not-a-receipt', { width: 500 });
  await assert.rejects(() => decodeReceipt(foreign), { code: 'FORTUNE_RECEIPT_QR_UNREADABLE' });
});

test('a small skewed fiscal QR missed by jsQR is decoded by the offline reader', async () => {
  const QRCode = require('qrcode');
  const sharp = require('sharp');
  // Generated fiscal fields only: no customer receipt or photo is committed.
  const fiscal = 'https://consumer.oofd.kz/?i=123456789&f=090500022375&s=720.00&t=20261013T110316';
  const original = await QRCode.toBuffer(fiscal, {
    scale: 8,
    margin: 4,
    errorCorrectionLevel: 'M',
  });
  const qr = await sharp(original)
    .resize(100, 100)
    .affine([1, 0.1, 0.05, 0.85], { background: 'white' })
    .blur(0.7)
    .jpeg({ quality: 70 })
    .toBuffer();
  const photograph = await sharp({
    create: { width: 900, height: 1600, channels: 3, background: '#c4c4c4' },
  })
    .composite([{ input: qr, left: 400, top: 1150 }])
    .jpeg({ quality: 85 })
    .toBuffer();
  await assert.rejects(() => decodeReceiptImage(photograph, { barcodeImpl: async () => [] }), {
    code: 'FORTUNE_RECEIPT_QR_UNREADABLE',
  });
  assert.deepEqual(await decodeReceipt(photograph), parseReceiptQr(fiscal));
});

test('offline barcode results must be valid QR symbols and pass the strict fiscal parser', async () => {
  const sharp = require('sharp');
  const image = await sharp({
    create: { width: 64, height: 64, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  const barcode = { isValid: true, format: 'QRCode', text: valid };
  const invalidResults = [
    { ...barcode, isValid: false },
    { ...barcode, isValid: undefined },
    { ...barcode, isValid: 1 },
    { ...barcode, error: 'ChecksumError' },
    { ...barcode, format: 'DataMatrix' },
    { ...barcode, format: 'Code128' },
    { ...barcode, text: 123 },
    { ...barcode, text: valid.replace('consumer.wofd.kz', 'consumer.wofd.kz.evil.example') },
    { ...barcode, text: valid + '&i=1' },
    { ...barcode, text: valid.replace('3007.50', '3007.501') },
  ];
  await assert.rejects(
    () =>
      decodeReceiptImage(image, {
        qrImpl: () => null,
        barcodeImpl: async () => invalidResults,
      }),
    { code: 'FORTUNE_RECEIPT_QR_UNREADABLE' },
  );
  assert.deepEqual(
    await decodeReceiptImage(image, {
      qrImpl: () => null,
      barcodeImpl: async () => [
        ...invalidResults,
        barcode,
        { ...barcode, format: 'QRCodeModel2', text: valid.replace('3007.50', '3007.5') },
      ],
    }),
    parseReceiptQr(valid),
  );
});

test('all readers contribute fiscal identities before ambiguity is decided', async () => {
  const sharp = require('sharp');
  const image = await sharp({
    create: { width: 64, height: 64, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  const second = valid.replace('527035232', '527035233');
  const barcode = (text) => ({ isValid: true, format: 'QRCodeModel2', text });
  await assert.rejects(
    () =>
      decodeReceiptImage(image, {
        qrImpl: () => null,
        barcodeImpl: async () => [barcode(valid), barcode(second)],
      }),
    { code: 'FORTUNE_RECEIPT_AMBIGUOUS' },
  );
  // One reader can miss the second receipt; a successful fallback must not
  // return early and silently accept a photo containing two fiscal receipts.
  await assert.rejects(
    () =>
      decodeReceiptImage(image, {
        qrImpl: () => ({ data: second }),
        barcodeImpl: async () => [barcode(valid)],
      }),
    { code: 'FORTUNE_RECEIPT_AMBIGUOUS' },
  );
});

test('uploads reject empty, broken, huge and non-photo content before receipt lookup', async () => {
  for (const value of [
    Buffer.alloc(0),
    Buffer.from('not an image'),
    'http://example.com',
    Buffer.alloc(8 * 1024 * 1024 + 1),
  ])
    await assert.rejects(() => decodeReceipt(value), { code: 'FORTUNE_RECEIPT_IMAGE_INVALID' });
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>',
  );
  await assert.rejects(() => decodeReceipt(svg), { code: 'FORTUNE_RECEIPT_IMAGE_INVALID' });
});

test('a whole receipt with a loyalty QR still finds fiscal proof and two fiscal receipts are ambiguous', async () => {
  const QRCode = require('qrcode');
  const sharp = require('sharp');
  const fiscal = await QRCode.toBuffer(valid, { width: 500 });
  const loyalty = await QRCode.toBuffer('https://bulka.com.kz/profile', { width: 500 });
  const page = (first) =>
    sharp({ create: { width: 700, height: 1500, channels: 3, background: 'white' } })
      .composite([
        { input: first, left: 100, top: 100 },
        { input: fiscal, left: 100, top: 850 },
      ])
      .png()
      .toBuffer();
  assert.equal(
    (await decodeReceipt(await page(loyalty))).receiptIdentity,
    parseReceiptQr(valid).receiptIdentity,
  );
  const second = await QRCode.toBuffer(valid.replace('527035232', '527035233'), { width: 500 });
  const combined = await page(second);
  await assert.rejects(() => decodeReceipt(combined), { code: 'FORTUNE_RECEIPT_AMBIGUOUS' });
});

test('pixel bombs are refused and bounded workers reject excess work without blocking the event loop', async () => {
  const QRCode = require('qrcode');
  const sharp = require('sharp');
  const bomb = await sharp({
    create: { width: 4001, height: 4001, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  await assert.rejects(() => decodeReceipt(bomb), { code: 'FORTUNE_RECEIPT_IMAGE_INVALID' });
  const image = await QRCode.toBuffer(valid, { width: 700 });
  const first = decodeReceipt(image);
  const second = decodeReceipt(image);
  await assert.rejects(() => decodeReceipt(image), {
    code: 'FORTUNE_RECEIPT_BUSY',
    statusCode: 503,
  });
  const timerWorked = await new Promise((resolve) => setTimeout(() => resolve(true), 5));
  assert(timerWorked);
  assert.equal((await first).receiptIdentity, (await second).receiptIdentity);
});
