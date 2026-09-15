const crypto = require('node:crypto');

// Release builds can preserve mixed Windows/Linux line endings and append
// blank lines after the last statement. Normalize only those bytes; keep
// every SQL character significant so a modified command still fails.
const checksum = (sql) =>
  crypto.createHash('sha256').update(String(sql).replace(/\r\n?/g, '\n').trimEnd()).digest('hex');

module.exports = { checksum };
