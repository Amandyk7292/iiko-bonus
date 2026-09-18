const express = require('express');
const path = require('node:path');

const router = express.Router();
const root = path.resolve(__dirname, '../../public/applink');

router.get(['/applink', '/applink/'], (_req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(root, 'index.html'));
});

router.use('/applink', express.static(root, { index: false, maxAge: '1h' }));

module.exports = router;
