// Isolated fixture serving the production camera router without accounts or live APIs.
const express = require('express');
const camera = require('../src/routes/pickup-camera.routes');
const app = express();
app.disable('x-powered-by');
app.use(camera);
app.use((_request, response) => response.sendStatus(404));
const server = app.listen(Number(process.env.PICKUP_CAMERA_TEST_PORT || 4179), '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
