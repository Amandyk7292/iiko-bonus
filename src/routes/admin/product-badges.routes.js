const { supabase } = require('../../config/supabase');
const { z, validateRequest } = require('../../middlewares/validation.middleware');
const { badgeCatalog } = require('../../services/product-badges.service');
const realtime = require('../../services/realtime.service');
const productId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_:-]+$/);
module.exports.registerProductBadgeRoutes = (router) => {
  router.get(
    '/admin/api/menu/badges',
    validateRequest({ query: z.object({ productId: productId.optional() }).strip() }),
    async (req, res, next) => {
      try {
        const badges = await badgeCatalog();
        let selected = [];
        if (req.query.productId) {
          const { data, error } = await supabase
            .from('product_badge_assignments')
            .select('badge_ids')
            .eq('product_id', req.query.productId)
            .maybeSingle();
          if (error) throw error;
          selected = data?.badge_ids || [];
        }
        res.json({ badges, selected });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/admin/api/menu/badges',
    validateRequest({
      body: z
        .object({
          id: z.string().uuid().optional(),
          label: z.string().trim().min(1).max(24),
          background: z.string().regex(/^#[0-9a-f]{6}$/i),
          foreground: z.string().regex(/^#[0-9a-f]{6}$/i),
        })
        .strict(),
    }),
    async (req, res, next) => {
      try {
        const { data, error } = await supabase
          .from('product_badges')
          .upsert({ ...req.body, updated_at: new Date().toISOString() })
          .select('id,label,background,foreground')
          .single();
        if (error) throw error;
        realtime.publish('menu.updated', {});
        res.json({ badge: data });
      } catch (error) {
        next(error);
      }
    },
  );
  router.put(
    '/admin/api/menu/badges/assignment',
    validateRequest({
      body: z.object({ productId, badgeIds: z.array(z.string().uuid()).max(3) }).strict(),
    }),
    async (req, res, next) => {
      try {
        const ids = [...new Set(req.body.badgeIds)];
        const badges = await badgeCatalog();
        if (ids.some((id) => !badges.some((b) => b.id === id)))
          return res.status(400).json({ error: 'Выберите существующие метки' });
        const { error } = await supabase
          .from('product_badge_assignments')
          .upsert({ product_id: req.body.productId, badge_ids: ids });
        if (error) throw error;
        realtime.publish('menu.updated', {});
        res.json({ success: true });
      } catch (error) {
        next(error);
      }
    },
  );
};
