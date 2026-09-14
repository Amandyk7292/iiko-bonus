const fs = require('node:fs');
const path = require('node:path');

function precompressedFlutter(directory, setHeaders) {
  const original = path.join(directory, 'main.dart.js');
  const files = Object.fromEntries(
    [
      ['br', `${original}.br`],
      ['gzip', `${original}.gz`],
    ].filter(([, file]) => fs.existsSync(file)),
  );
  return (req, res, next) => {
    res.vary('Accept-Encoding');
    // Preserve the normal static server's range and identity semantics.
    if (req.headers.range) return next();
    const encoding = req.acceptsEncodings(...Object.keys(files), 'identity');
    if (!files[encoding]) return next();
    setHeaders(res, original);
    res.type('application/javascript');
    res.setHeader('Content-Encoding', encoding);
    return res.sendFile(files[encoding], { cacheControl: false }, (error) => {
      if (error) next(error);
    });
  };
}

module.exports = { precompressedFlutter };
