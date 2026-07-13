import { Router } from 'express';
import { KASPI_QRPAY_URL } from '../config.js';
import { kaspiProxyJson, loggedFetch, signedQrPayHeaders } from '../helpers.js';
import { decryptSecret } from '../crypto.js';
import { inactiveSessionResponse, isActiveSession } from '../activeSession.js';
import { getGlobalSession } from '../sessionStorage.js';

const router = Router();

// Extract session from request headers
const extractSession = (req) => ({
  tokenSN: req.headers['x-token-sn'] || null,
  profileId: req.headers['x-profile-id'] || null,
  vtokenSecret: req.headers['x-vtoken-secret'] || null,
});

const requireAuth = (req, res, next) => {
  let session = extractSession(req);
  if (!session.tokenSN || !session.vtokenSecret) {
    const globalSession = getGlobalSession();
    if (globalSession) session = globalSession;
  }

  if (!session.tokenSN) return res.status(401).json({ error: 'Missing X-Token-SN header or global session.' });
  if (!session.vtokenSecret)
    return res.status(401).json({ error: 'Missing X-Vtoken-Secret header or global session.' });
  if (!isActiveSession(session.tokenSN)) return res.status(401).json(inactiveSessionResponse());
  try {
    session.decryptedSecret = decryptSecret(session.vtokenSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired vtokenSecret. Re-authenticate.' });
  }
  req.session = session;
  next();
};

router.use(requireAuth);

// ─── Return (refund) ───

router.post('/create', async (req, res) => {
  const { qrOperationId, returnAmount } = req.body;
  const operationId = String(qrOperationId || '').trim();
  const amount = Number(returnAmount);
  if (!/^\d{1,100}$/.test(operationId) || !Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
    return res.status(400).json({ error: 'Valid qrOperationId and returnAmount are required' });
  }
  try {
    const url = `${KASPI_QRPAY_URL}/v01/kaspi-qr/history-pos-return`;
    const headers = { ...signedQrPayHeaders(url, req.session), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ReturnAmount: amount,
        QrOperationId: Number(operationId),
        DeviceInterface: 'Pos',
      }),
    });
    return kaspiProxyJson(res, resp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
