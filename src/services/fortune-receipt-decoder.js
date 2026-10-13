const { readFileSync } = require('node:fs');
const { prepareZXingModule, readBarcodes } = require('zxing-wasm/reader');

// Keep the decoder and its WASM local to the receipt worker. The photograph
// and its pixels must never be sent to a third-party decoding service or CDN.
prepareZXingModule({
  overrides: {
    wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')),
  },
});

async function readReceiptCodes(pixels, width, height) {
  return readBarcodes(
    { data: pixels, width, height },
    {
      formats: ['QRCodeModel2'],
      tryHarder: true,
      tryDownscale: false,
      tryRotate: true,
      tryInvert: true,
      maxNumberOfSymbols: 8,
      returnErrors: false,
      textMode: 'Plain',
    },
  );
}

module.exports = { readReceiptCodes };
