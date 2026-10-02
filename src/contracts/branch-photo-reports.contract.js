const { z } = require('../middlewares/validation.middleware');
const date = z.iso.date();
const branchParams = z.object({ branchId: z.uuid() }).strict();
const photoParams = z.object({ photoId: z.uuid() }).strict();
const calendarQuery = z
  .object({
    end: date.optional(),
    days: z.coerce.number().int().min(1).max(31).default(14),
  })
  .strip();
const detailQuery = z.object({ date }).strip();
const uploadBody = z
  .object({
    uploadId: z.uuid(),
    kind: z.enum(['hall', 'baker']),
  })
  .strict();
module.exports = { branchParams, photoParams, calendarQuery, detailQuery, uploadBody };
