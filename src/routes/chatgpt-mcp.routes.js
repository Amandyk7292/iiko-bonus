const express = require('express');
const path = require('node:path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createBulkaMcpServer } = require('../services/chatgpt-mcp.service');
const { mcpRequestBody } = require('../contracts/chatgpt-mcp.contract');
const { validateRequest } = require('../middlewares/validation.middleware');

const mcpOrigins = new Set(['https://chatgpt.com', 'https://chat.openai.com']);
if (process.env.PUBLIC_BASE_URL) mcpOrigins.add(new URL(process.env.PUBLIC_BASE_URL).origin);
const mcpCors = cors({
  origin(origin, callback) {
    callback(null, !origin || mcpOrigins.has(origin));
  },
  credentials: false,
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'MCP-Protocol-Version', 'Mcp-Session-Id'],
});
function createMcpRouter({ createServer = createBulkaMcpServer } = {}) {
  const router = express.Router();
  router.get(['/chatgpt', '/chatgpt/'], (_req, res) =>
    res.sendFile(path.resolve(__dirname, '../../public/chatgpt/index.html')),
  );
  router.use(
    '/mcp',
    rateLimit({ windowMs: 60000, max: 180, standardHeaders: true, legacyHeaders: false }),
  );
  router.use('/mcp', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.headers.origin && !mcpOrigins.has(req.headers.origin)) {
      return res.status(403).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: 'Origin is not allowed' },
      });
    }
    if (Buffer.byteLength(JSON.stringify(req.body || {})) > 32768) {
      return res
        .status(413)
        .json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } });
    }
    next();
  });
  router.post('/mcp', validateRequest({ body: mcpRequestBody }), async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (_error) {
      if (!res.headersSent)
        res.status(500).json({
          jsonrpc: '2.0',
          id: req.body?.id ?? null,
          error: { code: -32603, message: 'MCP request failed' },
        });
    }
  });
  router.get('/mcp', (_req, res) => res.status(405).set('Allow', 'POST, OPTIONS').end());
  return router;
}

module.exports = { router: createMcpRouter(), createMcpRouter, mcpCors };
