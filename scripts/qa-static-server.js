const path = require('node:path');
const express = require('express');
const compression = require('compression');

const port = Number(process.argv[2] || 4173);
const root = path.resolve(process.argv[3] || 'scratch/qa-web');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Invalid QA server port');
}

const app = express();
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});
app.use(compression());
app.use(
  express.static(root, {
    setHeaders(res, filePath) {
      if (/\.(?:html|js|mjs|wasm)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  }),
);
app.get('/app/*', (_req, res) => res.sendFile(path.join(root, 'app', 'index.html')));
app.get(
  ['/catalog', '/catalog/*', '/cart', '/orders', '/promos', '/profile'],
  (_req, res) => res.sendFile(path.join(root, 'index.html')),
);
app.listen(port, '127.0.0.1', () => {
  console.log(`QA static server listening on ${port}`);
});
