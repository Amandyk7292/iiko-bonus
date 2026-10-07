const express = require('express');
const path = require('node:path');
const router = express.Router();
const publicDirectory = path.resolve(__dirname, '../../public');
const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Content-Security-Policy': [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self'",
    "style-src-attr 'none'",
    'media-src blob:',
    "connect-src 'none'",
  ].join('; '),
};
for (const [url, file] of [
  ['/pickup/camera-v1', 'pickup-camera-v1.html'],
  ['/assets/pickup-camera-v1.js', 'pickup-camera-v1.js'],
  ['/assets/pickup-camera-v1.css', 'pickup-camera-v1.css'],
]) {
  router.get(url, (_req, res) => {
    res.removeHeader('Cross-Origin-Embedder-Policy');
    res.set(headers).sendFile(path.join(publicDirectory, file));
  });
}
module.exports = router;
