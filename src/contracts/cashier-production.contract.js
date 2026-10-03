const { z } = require('../middlewares/validation.middleware');
const reportQuery = z.object({ date: z.iso.date() }).strict();
const createBody = z
  .object({ requestId: z.uuid(), date: z.iso.date(), eventIds: z.array(z.uuid()).min(1).max(1000) })
  .strict();
module.exports = { reportQuery, createBody };
