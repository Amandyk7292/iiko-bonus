const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
const QRCode = require('qrcode');

async function cashierInviteQr(url) {
  const candidates = [
    path.resolve(
      process.env.BULKA_PUBLIC_APP_DIR || path.join(__dirname, '../../public/app'),
      'assets/assets/brand/qr_logo.png',
    ),
    path.resolve(__dirname, '../../BulkaAndroid/assets/brand/qr_logo.png'),
    path.resolve(__dirname, '../assets/pass.model/brand-logo.png'),
  ];
  const logoPath = candidates.find((file) => fs.existsSync(file));
  const qr = await QRCode.toBuffer(url, { width: 900, margin: 4, errorCorrectionLevel: 'H' });
  const logo = await sharp(logoPath).trim().resize(140, 140, { fit: 'inside' }).png().toBuffer();
  const badge = await sharp({
    create: { width: 180, height: 180, channels: 4, background: '#ffffff' },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toBuffer();
  return sharp(qr)
    .composite([{ input: badge, gravity: 'centre' }])
    .png()
    .toBuffer();
}
module.exports = { cashierInviteQr };
