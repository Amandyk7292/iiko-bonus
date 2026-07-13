import path from 'path';
import { fileURLToPath } from 'url';
import { persistRuntimeJson, readRuntimeJson } from './runtimeJson.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSION_FILE = path.join(__dirname, '..', 'session.json');
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
  persistRuntimeJson(SESSION_FILE, data, 'SESSION_JSON_B64');
};

export const getGlobalSession = () => {
  try {
    const saved = loadSession();
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
