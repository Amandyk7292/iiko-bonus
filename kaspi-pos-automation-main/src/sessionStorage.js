import path from 'path';
import { fileURLToPath } from 'url';
import { persistRuntimeJson, readRuntimeJson } from './runtimeJson.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sessionFileOverride = String(process.env.KASPI_SESSION_FILE || '').trim();
const SESSION_FILE = sessionFileOverride
  ? path.resolve(sessionFileOverride)
  : path.join(__dirname, '..', 'session.json');
let inMemorySession;

const loadSession = () => {
  if (inMemorySession !== undefined) return inMemorySession;
  inMemorySession = readRuntimeJson(SESSION_FILE, 'SESSION_JSON_B64');
  return inMemorySession;
};

export const saveGlobalSession = (tokenSN, vtokenSecret, profileId) => {
  const data = {
    tokenSN,
    vtokenSecret,
    profileId,
    updatedAt: new Date().toISOString(),
  };
  inMemorySession = data;
  persistRuntimeJson(SESSION_FILE, data);
  return data;
};

export const clearGlobalSession = (reason = 'reauth_required', expectedSession = null) => {
  const current = getGlobalSession();
  if (expectedSession) {
    const expected =
      typeof expectedSession === 'string' ? { tokenSN: expectedSession } : expectedSession;
    if (
      !current ||
      (expected.tokenSN && current.tokenSN !== expected.tokenSN) ||
      (expected.vtokenSecret && current.vtokenSecret !== expected.vtokenSecret)
    ) {
      return false;
    }
  }
  const data = {
    revoked: true,
    reason: String(reason || 'reauth_required').slice(0, 100),
    updatedAt: new Date().toISOString(),
  };
  inMemorySession = data;
  persistRuntimeJson(SESSION_FILE, data);
  return true;
};

export const getGlobalSession = () => {
  try {
    const saved = loadSession();
    if (saved?.revoked) return null;
    if (saved) return saved;

    const tokenSN = String(process.env.KASPI_TOKEN_SN || '').trim();
    const vtokenSecret = String(process.env.KASPI_VTOKEN_SECRET || '').trim();
    const profileId = String(process.env.KASPI_PROFILE_ID || '').trim();
    return tokenSN && vtokenSecret && profileId ? { tokenSN, vtokenSecret, profileId } : null;
  } catch (err) {
    console.error('Error reading global session:', err.message);
    return null;
  }
};
