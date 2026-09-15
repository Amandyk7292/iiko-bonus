const crypto = require('node:crypto');

// Formatting tools may add blank lines after the final SQL statement.
// Their bytes do not change the applied migration. Keep every other byte
// significant so a modified command still fails history verification.
const checksum = (sql) =>
  crypto.createHash('sha256').update(String(sql).trimEnd()).digest('hex');

module.exports = { checksum };
