const { supabase } = require('../../config/supabase');
const { z, validateRequest } = require('../../middlewares/validation.middleware');
const { badgeCatalog, badgeDto } = require('../../services/product-badges.service');
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
        let stickerId = null;
        if (req.query.productId) {
          const { data, error } = await supabase
            .from('product_badge_assignments')
            .select('badge_ids,sticker_id')
            .eq('product_id', req.query.productId)
            .maybeSingle();
          if (error) throw error;
          selected = data?.badge_ids || [];
          stickerId = data?.sticker_id || null;
        }
        res.json({ badges, selected, stickerId });
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
          labelKk: z.string().trim().max(24).optional(),
          background: z.string().regex(/^#[0-9a-f]{6}$/i),
          foreground: z.string().regex(/^#[0-9a-f]{6}$/i),
          imageUrl: z.url().max(2048).startsWith('https://').nullable().optional(),
        })
        .strict(),
    }),
    async (req, res, next) => {
      try {
        const { labelKk, imageUrl, ...fields } = req.body;
        if (fields.id && imageUrl !== undefined) {
          const { data: current, error: readError } = await supabase
            .from('product_badges')
            .select('image_url')
            .eq('id', fields.id)
            .maybeSingle();
          if (readError) throw readError;
          if (current && Boolean(current.image_url) !== Boolean(imageUrl))
            return res.status(400).json({ error: 'Создайте отдельный стикер или текстовую метку' });
        }
        const { data, error } = await supabase
          .from('product_badges')
          .upsert({
            ...fields,
            ...(labelKk !== undefined ? { label_kk: labelKk } : {}),
            ...(imageUrl !== undefined ? { image_url: imageUrl } : {}),
            updated_at: new Date().toISOString(),
          })
          .select('id,label,label_kk,background,foreground,image_url')
          .single();
        if (error) throw error;
        realtime.publish('menu.updated', {});
        res.json({ badge: badgeDto(data) });
      } catch (error) {
        next(error);
      }
    },
  );
  router.put(
    '/admin/api/menu/badges/assignment',
    validateRequest({
      body: z
        .object({
          productId,
          badgeIds: z.array(z.string().uuid()).max(3),
          stickerId: z.string().uuid().nullable().optional(),
        })
        .strict(),
    }),
    async (req, res, next) => {
      try {
        const ids = [...new Set(req.body.badgeIds)];
        const badges = await badgeCatalog();
        if (ids.some((id) => !badges.some((b) => b.id === id && !b.imageUrl)))
          return res.status(400).json({ error: 'Выберите существующие текстовые метки' });
        if (req.body.stickerId && !badges.some((b) => b.id === req.body.stickerId && b.imageUrl))
          return res.status(400).json({ error: 'Выберите существующий стикер' });
        const { error } = await supabase.from('product_badge_assignments').upsert({
          product_id: req.body.productId,
          badge_ids: ids,
          ...(req.body.stickerId !== undefined ? { sticker_id: req.body.stickerId } : {}),
        });
        if (error) throw error;
        realtime.publish('menu.updated', {});
        res.json({ success: true });
      } catch (error) {
        next(error);
      }
    },
  );
};
