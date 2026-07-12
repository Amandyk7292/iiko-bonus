import { Router } from 'express';
import { KASPI_QRPAY_URL } from '../config.js';
import { loggedFetch, signedQrPayHeaders } from '../helpers.js';
import { decryptSecret } from '../crypto.js';
import { inactiveSessionResponse, isActiveSession } from '../activeSession.js';
import { getKaspiErrorMessage, isKaspiSessionExpired, isKaspiSuccess } from '../kaspiResponse.js';
import { getGlobalSession, saveGlobalSession } from '../sessionStorage.js';

const router = Router();

// Extract session from request headers
const extractSession = (req) => ({
  tokenSN: req.headers['x-token-sn'] || null,
  profileId: req.headers['x-profile-id'] || null,
  vtokenSecret: req.headers['x-vtoken-secret'] || null,
});

// ─── Check session validity ───

router.get('/check', async (req, res) => {
  const session = extractSession(req);

  // 1. Check required headers
  if (!session.tokenSN) return res.status(401).json({ active: false, error: 'Missing X-Token-SN header.' });
  if (!session.vtokenSecret) return res.status(401).json({ active: false, error: 'Missing X-Vtoken-Secret header.' });
  if (!isActiveSession(session.tokenSN)) {
    return res.status(401).json({ active: false, ...inactiveSessionResponse() });
  }

  // 2. Try to decrypt vtokenSecret
  try {
    session.decryptedSecret = decryptSecret(session.vtokenSecret);
  } catch {
    return res.status(401).json({ active: false, error: 'Invalid or expired vtokenSecret. Re-authenticate.' });
  }

  // 3. Ping Kaspi API to verify the token is still accepted
  try {
    const url = `${KASPI_QRPAY_URL}/v02/history/operations`;
    const headers = { ...signedQrPayHeaders(url, session), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        EndDate: new Date().toISOString().slice(0, 10),
        LastTransactionDate: '',
        StatementPeriodCode: 0,
      }),
    });

    const body = await resp.json().catch(() => ({}));

    if (isKaspiSessionExpired(body)) {
      return res.status(401).json({ active: false, ...inactiveSessionResponse(getKaspiErrorMessage(body)) });
    }

    if (resp.ok && isKaspiSuccess(body)) {
      saveGlobalSession(session.tokenSN, session.vtokenSecret, session.profileId);
      return res.json({ active: true });
    }

    return res.status(resp.ok ? 401 : resp.status).json({
      active: false,
      error: getKaspiErrorMessage(body, 'Session rejected by Kaspi API.'),
      code: body.StatusCode || body.Code || body.ResultCode,
      details: body,
    });
  } catch (err) {
    return res.status(500).json({ active: false, error: err.message });
  }
});

export default router;
