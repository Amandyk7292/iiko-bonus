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
const sessionBody = z.object({ shift: z.enum(['daily', 'day', 'night']).optional() }).strict();
const deviceParams = z.object({ deviceId: z.uuid() }).strict();
const devicesQuery = z.object({ branchId: z.uuid().optional() }).strip();
const approveDeviceBody = z
  .object({ code: z.string().regex(/^\d{6}$/), name: z.string().trim().min(1).max(80) })
  .strict();
module.exports = {
  branchParams,
  photoParams,
  calendarQuery,
  detailQuery,
  uploadBody,
  sessionBody,
  deviceParams,
  devicesQuery,
  approveDeviceBody,
};
