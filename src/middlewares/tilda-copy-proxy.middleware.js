const http = require('http');

const UPSTREAM_HOST = '127.0.0.1';
const UPSTREAM_PORT = 8080;
const JOB_PATH = /^\/(?:generated|run)\/[A-Za-z0-9_-]{24,64}\.js$/;
const CALLBACK_PATH = /^\/(?:complete|report)\/[A-Za-z0-9_-]{24,64}$/;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const isAllowedPath = (url) => {
  const pathname = String(url || '/').split('?', 1)[0];
  return (
    pathname === '/' ||
    pathname === '/health' ||
    JOB_PATH.test(pathname) ||
    CALLBACK_PATH.test(pathname)
  );
};

const tildaCopyProxy = (req, res) => {
  const pathname = String(req.url || '/').split('?', 1)[0];
  const validMethod = CALLBACK_PATH.test(pathname)
    ? req.method === 'POST'
    : ['GET', 'HEAD'].includes(req.method);
  if (!validMethod) {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!isAllowedPath(req.url)) {
    return res.status(404).json({ error: 'Not Found' });
  }

  const headers = { ...req.headers };
  delete headers.authorization;
  delete headers.cookie;
  delete headers.connection;
  headers.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;
  headers['x-forwarded-prefix'] = '/tilda-copy-bot';

  const upstreamRequest = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url || '/',
      headers,
    },
    (upstreamResponse) => {
      res.statusCode = upstreamResponse.statusCode || 502;
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (value !== undefined && !HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
          res.setHeader(name, value);
        }
      }
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
      upstreamResponse.pipe(res);
    },
  );

  upstreamRequest.setTimeout(15_000, () => {
    upstreamRequest.destroy(new Error('Tilda helper upstream timeout'));
  });
  upstreamRequest.on('error', (error) => {
    console.error('Tilda helper proxy error:', error.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Tilda helper unavailable' });
    } else {
      res.end();
    }
  });
  req.on('aborted', () => upstreamRequest.destroy());
  req.pipe(upstreamRequest);
  return undefined;
};

module.exports = { tildaCopyProxy };
