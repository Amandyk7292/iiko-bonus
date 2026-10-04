const express = require('express');
const path = require('node:path');

const router = express.Router();
const root = path.resolve(__dirname, '../../public/reset-password');
const privacyHeaders = (res) => {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  });
};

router.get(['/reset-password', '/reset-password/'], (_req, res) => {
  privacyHeaders(res);
  res.sendFile(path.join(root, 'index.html'));
});
router.use('/reset-password', express.static(root, { index: false, setHeaders: privacyHeaders }));

module.exports = router;
