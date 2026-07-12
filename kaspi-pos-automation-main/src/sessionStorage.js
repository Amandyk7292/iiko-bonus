import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSION_FILE = path.join(__dirname, '..', 'session.json');

export const saveGlobalSession = (tokenSN, vtokenSecret, profileId) => {
  const data = {
    tokenSN,
    vtokenSecret,
    profileId,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf8');
};

export const getGlobalSession = () => {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    return data;
  } catch (err) {
    console.error('Error reading global session:', err.message);
    return null;
  }
};
