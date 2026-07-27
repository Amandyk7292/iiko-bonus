import fs from 'fs';
import path from 'path';

const decodeBase64Json = (value, label) => {
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    throw new Error(`${label} must be base64-encoded JSON`);
  }
};

export const readRuntimeJson = (filePath, envName) => {
  if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const encoded = String(process.env[envName] || '').trim();
  if (!encoded) return null;

  const seeded = decodeBase64Json(encoded, envName);
  persistRuntimeJson(filePath, seeded);
  return seeded;
};

export const persistRuntimeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
  fs.chmodSync(filePath, 0o600);
};
