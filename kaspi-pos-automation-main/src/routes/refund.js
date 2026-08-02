import { Router } from 'express';
import { KASPI_QRPAY_URL } from '../config.js';
import { kaspiProxyJson, loggedFetch, signedQrPayHeaders } from '../helpers.js';
import { decryptSecret } from '../crypto.js';
import { clearActiveSession, inactiveSessionResponse, isActiveSession } from '../activeSession.js';
import { clearGlobalSession, getGlobalSession } from '../sessionStorage.js';

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

  if (!session.tokenSN || !session.vtokenSecret) {
    return res.status(401).json(inactiveSessionResponse());
  }
  if (!isActiveSession(session.tokenSN)) return res.status(401).json(inactiveSessionResponse());
  try {
    session.decryptedSecret = decryptSecret(session.vtokenSecret);
  } catch {
    clearActiveSession(session.tokenSN);
    clearGlobalSession('invalid_vtoken_secret', session);
    return res.status(401).json(inactiveSessionResponse());
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
    const payload = JSON.stringify({
      ReturnAmount: amount,
      QrOperationId: Number(operationId),
      DeviceInterface: 'Pos',
    });
    const headers = { ...signedQrPayHeaders(url, req.session, payload), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: payload,
    });
    return kaspiProxyJson(res, resp, req.session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
