import { Router } from 'express';
import { KASPI_QRPAY_URL } from '../config.js';
import { kaspiProxyJson, loggedFetch, signedQrPayHeaders } from '../helpers.js';
import { decryptSecret } from '../crypto.js';
import { trackPayment } from '../polling.js';
import { normalizeKaspiPhoneNumber } from '../phone.js';
import { getGlobalSession } from '../sessionStorage.js';
import { inactiveSessionResponse, isActiveSession } from '../activeSession.js';
import { getKaspiErrorMessage, isKaspiSessionExpired } from '../kaspiResponse.js';

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
    if (globalSession) {
      session = globalSession;
    }
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

// ─── Client info ───

router.get('/client-info', async (req, res) => {
  const { phoneNumber } = req.query;
  const normalizedPhone = normalizeKaspiPhoneNumber(phoneNumber);
  if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber required' });
  if (!normalizedPhone) return res.status(400).json({ error: 'Invalid phoneNumber format' });

  try {
    const url = `${KASPI_QRPAY_URL}/v01/remote/client-info?phoneNumber=${encodeURIComponent(normalizedPhone)}`;
    const headers = signedQrPayHeaders(url, req.session);
    const resp = await loggedFetch(url, { headers });
    return kaspiProxyJson(res, resp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Create invoice ───

router.post('/create', async (req, res) => {
  const { phoneNumber, amount, comment } = req.body;
  const numericAmount = Number(amount);
  const normalizedPhone = normalizeKaspiPhoneNumber(phoneNumber);
  if (!phoneNumber || !Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 10000000) {
    return res.status(400).json({ error: 'Valid phoneNumber and amount are required' });
  }
  if (!normalizedPhone) return res.status(400).json({ error: 'Invalid phoneNumber format' });

  try {
    const url = `${KASPI_QRPAY_URL}/v01/remote/create`;
    const headers = { ...signedQrPayHeaders(url, req.session), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        PhoneNumber: normalizedPhone,
        Amount: numericAmount,
        Comment: String(comment || '').slice(0, 500),
      }),
    });
    const kaspiResponse = await resp.json();
    if (isKaspiSessionExpired(kaspiResponse)) {
      return res.status(401).json(inactiveSessionResponse(getKaspiErrorMessage(kaspiResponse)));
    }
    const d = kaspiResponse.Data;
    const opId = d ? d.Id || d.QrOperationId : null;
    if (d && opId && (d.Status === 'RemotePaymentCreated' || d.Status === 'null' || !d.Status)) {
      trackPayment(
        opId,
        'invoice',
        {
          tokenSN: req.session.tokenSN,
          vtokenSecret: req.session.vtokenSecret,
          profileId: req.session.profileId,
        },
        {
          amount: d.Amount,
          clientMobile: d.ClientMobile,
          receiptUrl: d.ReceiptUrl,
          orderNumber: d.OrderNumber,
        },
      );
    }
    res.json(kaspiResponse);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Invoice details ───

router.get('/details', async (req, res) => {
  const { operationId } = req.query;
  if (!operationId) return res.status(400).json({ error: 'operationId required' });

  try {
    const url = `${KASPI_QRPAY_URL}/v01/remote/details?qrOperationId=${operationId}`;
    const resp = await loggedFetch(url, { headers: signedQrPayHeaders(url, req.session) });
    return kaspiProxyJson(res, resp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cancel invoice ───

router.post('/cancel', async (req, res) => {
  const { operationId } = req.body;
  if (!operationId) return res.status(400).json({ error: 'operationId required' });

  try {
    const url = `${KASPI_QRPAY_URL}/v01/remote/cancel`;
    const headers = { ...signedQrPayHeaders(url, req.session), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ qrOperationId: Number(operationId) }),
    });
    return kaspiProxyJson(res, resp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Invoice history ───

router.post('/history', async (req, res) => {
  try {
    const url = `${KASPI_QRPAY_URL}/v01/remote/history`;
    const headers = { ...signedQrPayHeaders(url, req.session), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ MaxResult: 20 }),
    });
    return kaspiProxyJson(res, resp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
