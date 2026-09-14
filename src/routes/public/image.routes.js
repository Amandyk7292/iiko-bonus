const { validateRequest, z } = require('../../middlewares/validation.middleware');
const { publicImage } = require('../../services/public-image.service');
function registerPublicImageRoutes(router) {
  router.get(
    '/api/public/image',
    validateRequest({
      query: z.object({
        path: z.string().min(1).max(500),
        edge: z.coerce.number().int(),
      }),
    }),
    async (req, res, next) => {
      try {
        const result = await publicImage(req.query.path, Number(req.query.edge));
        res.set({
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          ETag: '"' + result.key + '"',
          'X-Content-Type-Options': 'nosniff',
        });
        if (req.fresh) return res.status(304).end();
        return res.type('image/webp').send(result.buffer);
      } catch (error) {
        next(error);
      }
    },
  );
}
module.exports = { registerPublicImageRoutes };
