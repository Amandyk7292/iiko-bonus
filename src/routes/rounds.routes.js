const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { validateRequest, emptyBodySchema } = require('../middlewares/validation.middleware');
const c = require('../contracts/rounds.contract');
const { rounds } = require('../services/rounds.service');
const { fail, inspectorDto } = require('../services/rounds-access.service');
const media = require('../services/rounds-media.service');
const COOKIE = 'bulka_rounds_session';
let uploadsInFlight = 0;
const acquireUploadSlot = (req, res, next) => {
  if (uploadsInFlight >= 3)
    return next(fail('Загрузка занята. Повторите через минуту', 503, 'ROUNDS_UPLOAD_BUSY'));
  uploadsInFlight += 1;
  let released = false;
  req.releaseRoundsUpload = () => {
    if (!released) {
      released = true;
      uploadsInFlight -= 1;
    }
  };
  res.once('finish', req.releaseRoundsUpload);
  res.once('close', () => {
    if (!req.roundsUploadProcessing) req.releaseRoundsUpload();
  });
  next();
};
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/rounds',
  maxAge: 30 * 86400000,
});
const readCookie = (req) =>
  String(req.headers.cookie || '')
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1) || '';
const handle = (work) => async (req, res, next) => {
  try {
    res.json({ success: true, ...(await work(req, res)) });
  } catch (error) {
    next(error);
  }
};
function createRoundsRouter({ service = rounds, mediaService = media } = {}) {
  const router = express.Router();
  const headers = (_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    next();
  };
  const sameOrigin = (req, _res, next) => {
    const origin = req.headers.origin;
    if (
      req.headers['sec-fetch-site'] === 'cross-site' ||
      (process.env.NODE_ENV === 'production' &&
        origin &&
        origin !== new URL(process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz').origin)
    ) {
      return next(fail('Недопустимый источник запроса', 403, 'ROUNDS_ORIGIN_INVALID'));
    }
    return next();
  };
  const authenticate = async (req, res, next) => {
    try {
      const token = readCookie(req);
      req.roundsActor = await service.resolve(token);
      res.cookie(COOKIE, token, cookieOptions());
      next();
    } catch (error) {
      next(error);
    }
  };
  const csrf = (req, _res, next) => {
    const expected = Buffer.from(req.roundsActor.csrfToken);
    const received = Buffer.from(String(req.headers['x-csrf-token'] || ''));
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received))
      return next(fail('Обновите страницу и повторите действие', 403, 'ROUNDS_CSRF_INVALID'));
    return next();
  };
  const requestLimit = rateLimit({
    windowMs: 60000,
    limit: 150,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Слишком много запросов. Подождите минуту.' },
  });
  const loginLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Слишком много попыток входа. Повторите через 15 минут.' },
  });
  const uploadLimit = rateLimit({
    windowMs: 3600000,
    limit: 60,
    keyGenerator: (req) => req.roundsActor.inspector.id,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Лимит материалов за час исчерпан. Повторите позже.' },
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: media.MAX_BYTES, files: 1, fields: 0, parts: 1 },
  });
  router.use(
    '/rounds',
    headers,
    express.static(path.resolve(__dirname, '../../public/rounds'), {
      index: 'index.html',
      dotfiles: 'deny',
      redirect: false,
    }),
  );
  router.get('/rounds', headers, (_req, res) =>
    res.sendFile(path.resolve(__dirname, '../../public/rounds/index.html')),
  );
  router.use('/api/rounds', headers, sameOrigin, requestLimit);
  router.post(
    '/api/rounds/login',
    loginLimit,
    validateRequest({ body: c.login }),
    handle(async (req, res) => {
      const result = await service.login(req.body.username, req.body.password);
      res.cookie(COOKIE, result.token, cookieOptions());
      return { inspector: result.inspector, csrfToken: result.csrfToken };
    }),
  );
  router.use('/api/rounds', authenticate);
  router.get(
    '/api/rounds/session',
    handle((req) => ({
      inspector: inspectorDto(req.roundsActor.inspector),
      csrfToken: req.roundsActor.csrfToken,
    })),
  );
  router.post(
    '/api/rounds/logout',
    csrf,
    validateRequest({ body: emptyBodySchema }),
    handle(async (req, res) => {
      await service.logout(readCookie(req));
      res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
      return {};
    }),
  );
  router.get(
    '/api/rounds',
    validateRequest({ query: c.dateQuery }),
    handle((req) => service.list(req.roundsActor, req.query.date)),
  );
  router.get(
    '/api/rounds/:roundId',
    validateRequest({ params: c.roundParams }),
    handle((req) => service.detail(req.roundsActor, req.params.roundId)),
  );
  router.post(
    '/api/rounds/tasks/:taskId/media',
    csrf,
    uploadLimit,
    validateRequest({ params: c.taskParams, body: emptyBodySchema }),
    acquireUploadSlot,
    (req, res, next) =>
      upload.single('file')(req, res, (error) => {
        if (error) req.releaseRoundsUpload();
        else req.roundsUploadProcessing = true;
        next(error);
      }),
    async (req, res, next) => {
      try {
        res.json({
          success: true,
          ...(await mediaService.uploadMedia(
            service,
            req.roundsActor,
            req.params.taskId,
            req.file,
          )),
        });
      } catch (error) {
        next(error);
      } finally {
        req.releaseRoundsUpload();
      }
    },
  );
  router.delete(
    '/api/rounds/media/:mediaId',
    csrf,
    validateRequest({ params: c.mediaParams, body: emptyBodySchema }),
    handle(async (req) => {
      const fileName = await service.deleteMedia(req.roundsActor, req.params.mediaId);
      if (fileName) await mediaService.removeFile(fileName);
      return {};
    }),
  );
  router.post(
    '/api/rounds/tasks/:taskId/complete',
    csrf,
    validateRequest({ params: c.taskParams, body: c.complete }),
    handle((req) => service.complete(req.roundsActor, req.params.taskId, req.body.comment)),
  );
  router.get(
    '/api/rounds/media/:mediaId',
    validateRequest({ params: c.mediaParams }),
    async (req, res, next) => {
      try {
        await mediaService.sendMedia(
          service,
          req.roundsActor,
          req.params.mediaId,
          false,
          res,
          next,
        );
      } catch (error) {
        next(error);
      }
    },
  );
  router.use((error, _req, _res, next) => {
    if (error instanceof multer.MulterError)
      return next(
        fail('Один материал до 8 МБ. Не добавляйте лишние поля.', 400, 'ROUNDS_UPLOAD_INVALID'),
      );
    return next(error);
  });
  return router;
}
module.exports = createRoundsRouter();
module.exports.createRoundsRouter = createRoundsRouter;
module.exports.readCookie = readCookie;
