import { Router } from 'express';
import { KASPI_QRPAY_URL } from '../config.js';
import { loggedFetch, signedQrPayHeaders } from '../helpers.js';
import { decryptSecret } from '../crypto.js';
import path from 'path';
import fs from 'fs';
import admin from 'firebase-admin';

// Initialize Firebase Admin for syncing refunds to database
const keyPath = path.resolve(process.cwd(), '../bulka-site-firebase-adminsdk-fbsvc-10fb5f6ecb.json');
if (fs.existsSync(keyPath) && admin.apps.length === 0) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('[FIREBASE] Admin initialized in refund route');
  } catch (e) {
    console.error('[FIREBASE] Failed to initialize admin in refund route:', e.message);
  }
}

const router = Router();

// Extract session from request headers
const extractSession = (req) => ({
  tokenSN: req.headers['x-token-sn'] || null,
  profileId: req.headers['x-profile-id'] || null,
  vtokenSecret: req.headers['x-vtoken-secret'] || null,
});

const requireAuth = (req, res, next) => {
  const session = extractSession(req);
  if (!session.tokenSN) return res.status(401).json({ error: 'Missing X-Token-SN header.' });
  if (!session.vtokenSecret) return res.status(401).json({ error: 'Missing X-Vtoken-Secret header.' });
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
  if (!qrOperationId || !returnAmount)
    return res.status(400).json({ error: 'qrOperationId and returnAmount required' });
  try {
    const url = `${KASPI_QRPAY_URL}/v01/kaspi-qr/history-pos-return`;
    const headers = { ...signedQrPayHeaders(url, req.session), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ReturnAmount: Number(returnAmount),
        QrOperationId: Number(qrOperationId),
        DeviceInterface: 'Pos',
      }),
    });
    
    const kaspiResult = await resp.json();
    
    // If Kaspi return is successful (StatusCode === 0), update order status in Firestore to 'rejected' (cancelled)
    if (kaspiResult && kaspiResult.StatusCode === 0) {
      try {
        const db = admin.firestore();
        const ordersRef = db.collection('orders');
        const querySnapshot = await ordersRef.where('kaspiOperationId', '==', String(qrOperationId)).get();
        
        if (!querySnapshot.empty) {
          const batch = db.batch();
          querySnapshot.forEach(doc => {
            console.log(`[REFUND] Updating Firestore order ${doc.id} status to rejected`);
            batch.update(doc.ref, {
              status: 'rejected',
              paymentStatus: 'refunded',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              rejectedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          });
          await batch.commit();
        } else {
          console.warn(`[REFUND] No Firestore order found with kaspiOperationId: ${qrOperationId}`);
        }
      } catch (fbErr) {
        console.error('[REFUND] Failed to update order in Firestore:', fbErr.message);
      }
    }
    
    res.json(kaspiResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
