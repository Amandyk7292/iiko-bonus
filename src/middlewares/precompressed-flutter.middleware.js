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
    let encoding = req.acceptsEncodings(...Object.keys(files), 'identity');
    // Express breaks equal-quality ties by the client's order (Chrome lists gzip first).
    const accepted = String(req.headers['accept-encoding'] || '')
      .toLowerCase()
      .split(',')
      .map((item) => {
        const [name, ...parameters] = item.trim().split(';');
        const q = parameters.find((value) => value.trim().startsWith('q='));
        return { name, quality: q ? Number(q.trim().slice(2)) : 1 };
      });
    const quality = (name) =>
      (accepted.find((item) => item.name === name) || accepted.find((item) => item.name === '*'))
        ?.quality || 0;
    if (encoding === 'gzip' && files.br && quality('br') > 0 && quality('br') === quality('gzip'))
      encoding = 'br';
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
