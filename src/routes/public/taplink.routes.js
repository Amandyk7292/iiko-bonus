const taplink = require('../../services/taplink.service');

function registerTaplinkPublicRoutes(router, { service = taplink } = {}) {
  router.get('/api/public/taplink', async (req, res, next) => {
    try {
      const page = await service.getPublicTaplink();
      const etag = `"taplink-${page.revision}"`;
      res.set({
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
        ETag: etag,
      });
      if (req.get('If-None-Match') === etag) return res.status(304).end();
      return res.json({ success: true, page });
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = { registerTaplinkPublicRoutes };
