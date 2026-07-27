import { Router } from 'express';
import { KASPI_QRPAY_URL } from '../config.js';
import { kaspiProxyJson, loggedFetch, signedQrPayHeaders } from '../helpers.js';
import { decryptSecret } from '../crypto.js';
import { trackPayment } from '../polling.js';
import { clearGlobalSession, getGlobalSession } from '../sessionStorage.js';
import { clearActiveSession, inactiveSessionResponse, isActiveSession } from '../activeSession.js';
import { isKaspiSessionExpired } from '../kaspiResponse.js';

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

// ─── Create QR token ───

router.post('/create', async (req, res) => {
  const { amount, latitude, longitude } = req.body;
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 10000000) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  try {
    const url = `${KASPI_QRPAY_URL}/v01/qr-token/create`;
    const payload = JSON.stringify({
      PaymentAmount: numericAmount,
      DeviceInterface: 'Pos',
      Latitude: latitude || 43.204643483375889,
      Longitude: longitude || 76.891962364115912,
    });
    const headers = { ...signedQrPayHeaders(url, req.session, payload), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: payload,
    });
    const kaspiResponse = await resp.json();
    if (isKaspiSessionExpired(kaspiResponse)) {
      clearActiveSession(req.session.tokenSN);
      clearGlobalSession('kaspi_session_expired', req.session);
      return res.status(401).json(inactiveSessionResponse());
    }
    const d = kaspiResponse.Data;
    if (d && d.QrOperationId) {
      const opts = d.QrPaymentBehaviorOptions || {};
      trackPayment(
        d.QrOperationId,
        'qr',
        {
          tokenSN: req.session.tokenSN,
          vtokenSecret: req.session.vtokenSecret,
          profileId: req.session.profileId,
        },
        {
          qrToken: d.QrToken,
          expireDate: d.ExpireDate,
          receiptUrl: d.ReceiptUrl,
          amount: d.Amount,
          pollingIntervals: {
            scanWaitTimeout: Number(opts.qrCodeScanWaitTimeout) || 180,
            scanPollingInterval: Number(opts.qrCodeScanEventPollingInterval) || 3,
            statusCountdown: Number(opts.paymentStatusCountdown) || 2,
            confirmationTimeout: Number(opts.paymentConfirmationTimeout) || 65,
          },
        },
      );
    }
    if (d && d.QrToken) {
      d.QrToken = d.QrToken.replace('https://qr.kaspi.kz/', 'https://pay.kaspi.kz/pay/');
    }
    res.json(kaspiResponse);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── QR payment status ───

router.get('/status', async (req, res) => {
  const { qrOperationId } = req.query;
  if (!qrOperationId) return res.status(400).json({ error: 'qrOperationId required' });

  try {
    const url = `${KASPI_QRPAY_URL}/v02/kaspi-qr/status?qrOperationId=${qrOperationId}`;
    const resp = await loggedFetch(url, { headers: signedQrPayHeaders(url, req.session) });
    return kaspiProxyJson(res, resp, req.session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
