const { z } = require('zod');

const rpcMessage = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string().max(100), z.number().finite()]).optional(),
    method: z.string().min(1).max(100),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

module.exports = { mcpRequestBody: rpcMessage };
