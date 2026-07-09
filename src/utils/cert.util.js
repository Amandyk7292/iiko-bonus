const fs = require('fs');
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.VERCEL;

function readSecretBuffer(envKey, localFile) {
  if (process.env[envKey]) return Buffer.from(process.env[envKey], 'base64');
  if (!isProduction) {
    const filePath = path.join(process.cwd(), localFile);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
  }
  throw new Error(`${envKey} is required`);
}

module.exports = { readSecretBuffer };
