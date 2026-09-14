const express = require('express');
const path = require('node:path');
const { publicApiRateLimit } = require('../middlewares/rate-limit.middleware');
const { service } = require('../services/screen-cakes.service');
const router = express.Router();
const root = path.resolve(__dirname, '../../public/screencakes');

router.get('/api/public/screencakes', publicApiRateLimit, async (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await service.getSnapshot());
  } catch (error) {
    next(error);
  }
});
router.get(['/screencakes', '/screencakes/'], (_req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(root, 'index.html'));
});
router.use('/screencakes', express.static(root, { index: false, maxAge: '1h' }));
module.exports = router;
