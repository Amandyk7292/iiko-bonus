import express from 'express';
import path from 'path';
import { PORT, ROOT_DIR } from './src/config.js';
import authRoutes from './src/routes/auth.js';
import invoiceRoutes from './src/routes/invoice.js';
import qrRoutes from './src/routes/qr.js';
import historyRoutes from './src/routes/history.js';
import refundRoutes from './src/routes/refund.js';
import sessionRoutes from './src/routes/session.js';
import { startPolling } from './src/polling.js';
import 'dotenv/config';

const app = express();

// ─── CORS for Bulka frontend ───
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://bulka-site.web.app',
  'https://bulka-site.firebaseapp.com',
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Token-SN, X-Profile-Id, X-Vtoken-Secret');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(path.join(ROOT_DIR, 'public')));

import fs from 'fs';

const CREDENTIALS_FILE = path.join(ROOT_DIR, 'session-credentials.json');

// Load session from disk or env on startup
let kaspiSession = {
  tokenSN: process.env.KASPI_TOKEN_SN || null,
  vtokenSecret: process.env.KASPI_VTOKEN_SECRET || null,
  profileId: process.env.KASPI_PROFILE_ID || null
};
try {
  if (!kaspiSession.tokenSN && fs.existsSync(CREDENTIALS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    kaspiSession = { ...kaspiSession, ...saved };
    console.log('[SESSION] Loaded credentials from file on startup');
  } else if (kaspiSession.tokenSN) {
    console.log('[SESSION] Loaded credentials from ENV variables');
  }
} catch (e) {
  console.error('[SESSION] Failed to load credentials from file:', e.message);
}

app.get('/api/session/credentials', (req, res) => {
  const ready = !!(kaspiSession.tokenSN && kaspiSession.vtokenSecret);
  res.json({ ready, profileId: kaspiSession.profileId });
});

app.post('/api/session/credentials', (req, res) => {
  const { tokenSN, vtokenSecret, profileId } = req.body;
  if (!tokenSN || !vtokenSecret) {
    return res.status(400).json({ error: 'tokenSN and vtokenSecret required' });
  }
  kaspiSession = { tokenSN, vtokenSecret, profileId: profileId || null };
  try {
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(kaspiSession, null, 2));
    console.log('[SESSION] Saved credentials to file');
  } catch (e) {
    console.error('[SESSION] Failed to save credentials to file:', e.message);
  }
  res.json({ success: true, message: 'Kaspi session saved on server' });
});

app.delete('/api/session/credentials', (req, res) => {
  kaspiSession = { tokenSN: null, vtokenSecret: null, profileId: null };
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      fs.unlinkSync(CREDENTIALS_FILE);
    }
    console.log('[SESSION] Cleared credentials file');
  } catch (e) {
    console.error('[SESSION] Failed to clear credentials file:', e.message);
  }
  res.json({ success: true, message: 'Kaspi session cleared on server' });
});


// ─── Auto-inject stored session headers for API routes ───
const injectSession = (req, res, next) => {
  if (!req.headers['x-token-sn'] && kaspiSession.tokenSN) {
    req.headers['x-token-sn'] = kaspiSession.tokenSN;
  }
  if (!req.headers['x-vtoken-secret'] && kaspiSession.vtokenSecret) {
    req.headers['x-vtoken-secret'] = kaspiSession.vtokenSecret;
  }
  if (!req.headers['x-profile-id'] && kaspiSession.profileId) {
    req.headers['x-profile-id'] = kaspiSession.profileId;
  }
  next();
};
app.use('/api', injectSession);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/invoice', invoiceRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/refund', refundRoutes);
app.use('/api/session', sessionRoutes);

if (!process.env.KASPI_MOUNTED) {
  app.listen(PORT, () => {
    console.log(`\n  🟢 Kaspi Pay App running at http://localhost:${PORT}\n`);
    startPolling();
  });
}

export { app as kaspiApp, startPolling };
