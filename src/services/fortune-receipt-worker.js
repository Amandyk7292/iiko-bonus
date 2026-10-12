const { parentPort, workerData } = require('node:worker_threads');
const { decodeReceiptImage } = require('./fortune-receipt-qr');

decodeReceiptImage(Buffer.from(workerData)).then(
  (receipt) => parentPort.postMessage({ receipt }),
  (error) =>
    parentPort.postMessage({
      error: {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
      },
    }),
);
