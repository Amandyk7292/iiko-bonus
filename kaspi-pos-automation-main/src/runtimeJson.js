import fs from 'fs';

const decodeBase64Json = (value, label) => {
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    throw new Error(`${label} must be base64-encoded JSON`);
  }
};

export const readRuntimeJson = (filePath, envName) => {
  const encoded = String(process.env[envName] || '').trim();
  if (encoded) return decodeBase64Json(encoded, envName);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

export const persistRuntimeJson = (filePath, value, envName) => {
  if (process.env[envName]) return;
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
};
