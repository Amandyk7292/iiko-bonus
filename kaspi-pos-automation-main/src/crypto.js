import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {ecKeyPair} from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ECDH_FILE = path.join(__dirname, '..', 'ecdh-keypair.json');

// ─── ECDH ───

const vtokenSuite = 'OCRA-1:HOTP-SHA256-6:QH64-T1M';

// ─── AES-256-GCM encryption for vtokenSecret ───

if (!process.env.TOKEN_SECRET_KEY) {
  console.error('FATAL: TOKEN_SECRET_KEY environment variable is not set.');
  console.error('Generate one with: echo "TOKEN_SECRET_KEY=$(openssl rand -hex 32)" > .env');
  process.exit(1);
}
const ENCRYPTION_KEY = Buffer.from(process.env.TOKEN_SECRET_KEY, 'hex');

export const encryptSecret = (secretBuffer) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(secretBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
};

export const decryptSecret = (tokenB64) => {
  const buf = Buffer.from(tokenB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

let lastEcdhKeyPair = null;

export const generateECDH = () => {
  lastEcdhKeyPair = crypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  // Persist ECDH private key so refresh (SignInLite) can reuse it
  const saved = {
    privateKey: lastEcdhKeyPair.privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64'),
    publicKey: lastEcdhKeyPair.publicKey.export({type: 'spki', format: 'der'}).toString('base64'),
  };
  fs.writeFileSync(ECDH_FILE, JSON.stringify(saved, null, 2));
  const spki = lastEcdhKeyPair.publicKey.export({type: 'spki', format: 'der'});
  return spki.toString('base64');
};

const p256SpkiPrefix = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');

const publicKeyFromRawP256Point = (point) => crypto.createPublicKey({
  key: Buffer.concat([p256SpkiPrefix, point]),
  format: 'der',
  type: 'spki',
});

const decodeKaspiPublicKey = (serverX509B64) => {
  const value = String(serverX509B64).trim();

  if (value.startsWith('-----BEGIN')) {
    const attempts = [
      () => crypto.createPublicKey(value),
      () => new crypto.X509Certificate(value).publicKey,
    ];
    const errors = [];
    for (const attempt of attempts) {
      try {
        return attempt();
      } catch (err) {
        errors.push(err.message);
      }
    }
    throw new Error(`Unsupported Kaspi ECDH PEM public key format: ${errors.join('; ')}`);
  }

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const der = Buffer.from(normalized, 'base64');

  const attempts = [
    () => crypto.createPublicKey({key: der, format: 'der', type: 'spki'}),
    () => new crypto.X509Certificate(der).publicKey,
  ];

  // Some Kaspi responses use a raw P-256 point instead of a full SPKI wrapper.
  if (der.length === 65 && der[0] === 0x04) {
    attempts.push(() => publicKeyFromRawP256Point(der));
  }
  if ((der.length === 33) && (der[0] === 0x02 || der[0] === 0x03)) {
    attempts.push(() => publicKeyFromRawP256Point(crypto.ECDH.convertKey(der, 'prime256v1', undefined, undefined, 'uncompressed')));
  }

  const errors = [];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (err) {
      errors.push(err.message);
    }
  }

  throw new Error(`Unsupported Kaspi ECDH public key format (${der.length} bytes, first byte 0x${der[0]?.toString(16) || '??'}): ${errors.join('; ')}`);
};

export const completeECDH = (serverX509B64) => {
  if (!lastEcdhKeyPair) throw new Error('No ECDH keypair generated');
  const serverPubKey = decodeKaspiPublicKey(serverX509B64);
  const secret = crypto.diffieHellman({
    privateKey: lastEcdhKeyPair.privateKey,
    publicKey: serverPubKey,
  });
  console.log('ECDH shared secret derived, length:', secret.length);
  lastEcdhKeyPair = null;
  return secret;
};

export const completeECDHWithSaved = (serverX509B64) => {
  if (!fs.existsSync(ECDH_FILE)) throw new Error('No saved ECDH keypair (ecdh-keypair.json missing)');
  const saved = JSON.parse(fs.readFileSync(ECDH_FILE, 'utf8'));
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(saved.privateKey, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const serverPubKey = decodeKaspiPublicKey(serverX509B64);
  const secret = crypto.diffieHellman({privateKey, publicKey: serverPubKey});
  console.log('ECDH (saved key) shared secret derived, length:', secret.length);
  return secret;
};

// ─── Helpers ───

const hexToBytes = (hex) => {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return Buffer.from(bytes);
};

// ─── OCRA-1 TOTP (matches Kaspi vtoken) ───

export const computeTokenSnMac = (tokenSN, secret) => {
  if (!secret) return '000000';

  const timeStep = BigInt(Date.now()) / BigInt(30000);
  const timeHex = timeStep.toString(16);

  const qHex = Buffer.from(tokenSN || '00000000')
    .toString('hex')
    .substring(0, 64);

  const suiteBytes = Buffer.from(vtokenSuite);
  const separator = Buffer.from([0x00]);

  const qPadded = qHex.padEnd(256, '0');
  const qBytes = hexToBytes(qPadded);

  const tPadded = timeHex.padStart(16, '0');
  const tBytes = hexToBytes(tPadded);

  const dataBuffer = Buffer.concat([suiteBytes, separator, qBytes, tBytes]);

  const hash = crypto.createHmac('sha256', secret).update(dataBuffer).digest();

  // Dynamic truncation (RFC 4226)
  const offset = hash[hash.length - 1] & 0x0f;
  const binCode =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  return (binCode % 1000000).toString().padStart(6, '0');
};

// ─── ECDSA signing ───

export const ecSign = (data) => {
  const sign = crypto.createSign('SHA256');
  sign.update(data);
  sign.end();
  return sign.sign(ecKeyPair.privateKey).toString('base64');
};

export const signDataPayload = (dataB64) => ecSign(dataB64);

export const computeXSU = (url) => crypto.createHash('md5').update(url.toLowerCase()).digest('hex');

export const computeXSign = (url, headers, xshList) => {
  const parts = xshList.split(',').map((name) => {
    if (name === 'url') {
      try {
        const u = new URL(url);
        return u.pathname + u.search;
      } catch {
        return url;
      }
    }
    return headers[name] || '';
  });
  return ecSign(parts.join(''));
};
