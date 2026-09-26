const crypto = require('node:crypto');
const multer = require('multer');
const { supabase } = require('../../config/supabase');
const { optimizeUploadedImage } = require('../../utils/image.util');
const { validateRequest, z } = require('../../middlewares/validation.middleware');

function registerCustomerAvatarRoutes(router, db = supabase) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
  }).single('image');
  // Registered after customer authentication; never accept a customer ID from the upload.
  router.post(
    '/api/customer/profile/avatar',
    validateRequest({ query: z.object({}).strict() }),
    (req, res) => {
      if (!req.customerAuth?.id)
        return res.status(401).json({ success: false, code: 'UNAUTHORIZED' });
      upload(req, res, async (uploadError) => {
        const fail = (status, code, message) =>
          res.status(status).json({ success: false, code, message });
        if (uploadError)
          return fail(
            uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
            uploadError.code === 'LIMIT_FILE_SIZE'
              ? 'CUSTOMER_AVATAR_TOO_LARGE'
              : 'CUSTOMER_AVATAR_FORMAT',
            'Выберите одно изображение JPEG, PNG или WebP размером до 5 МБ.',
          );
        let image;
        try {
          image = await optimizeUploadedImage(req.file?.buffer, req.file?.mimetype);
        } catch (_) {
          return fail(
            400,
            'CUSTOMER_AVATAR_FORMAT',
            'Не удалось прочитать фото. Выберите JPEG, PNG или WebP без анимации.',
          );
        }
        const bucket = db.storage.from('customer_avatars');
        const path = `${req.customerAuth.id}/${crypto.randomUUID()}.${image.extension}`;
        let uploaded = false;
        try {
          const { error } = await bucket.upload(path, image.buffer, {
            contentType: image.mime,
            upsert: false,
          });
          if (error) throw error;
          uploaded = true;
          const avatarUrl = bucket.getPublicUrl(path).data?.publicUrl;
          if (!avatarUrl) throw new Error('Missing avatar URL');
          const saved = await db
            .from('customers')
            .update({ avatar_key: 'custom', avatar_url: avatarUrl, avatar_storage_path: path })
            .eq('id', req.customerAuth.id)
            .is('deleted_at', null)
            .select('id')
            .maybeSingle();
          if (saved.error || !saved.data) throw new Error('Avatar profile update failed');
          return res.json({ success: true, avatar: { avatarKey: 'custom', avatarUrl } });
        } catch (_) {
          if (uploaded) await bucket.remove([path]).catch(() => {});
          return fail(
            503,
            'CUSTOMER_AVATAR_STORAGE',
            'Сервис сохранения фото временно недоступен. Попробуйте позже.',
          );
        }
      });
    },
  );
}

module.exports = { registerCustomerAvatarRoutes };
