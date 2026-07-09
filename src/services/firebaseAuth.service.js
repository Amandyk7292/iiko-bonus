const { getAuth } = require('firebase-admin/auth');

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyAJqvIWCtwDBLtRyEPQ2gFv0uN0r8dWcdw';

/**
 * Отправляет письмо подтверждения почты через Firebase Authentication
 */
async function sendFirebaseVerificationEmail(email, displayName = '') {
  if (!email || !email.includes('@')) return false;

  try {
    const auth = getAuth();
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        userRecord = await auth.createUser({
          email,
          emailVerified: false,
          displayName: displayName || ''
        });
      } else {
        throw e;
      }
    }

    // Генерируем custom token и обмениваем на idToken для отправки стандартного письма Firebase
    const customToken = await auth.createCustomToken(userRecord.uid);

    const signRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true })
    });

    const signData = await signRes.json();
    if (!signData.idToken) {
      if (signData.error && signData.error.message === 'CONFIGURATION_NOT_FOUND') {
        console.warn('⚠️ Firebase Authentication не включен в консоли Firebase! Включите Email/Password провайдер в консоли Firebase (Authentication -> Sign-in method).');
        return false;
      }
      throw new Error(signData.error?.message || 'Failed to sign in with custom token');
    }

    const oobRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: 'VERIFY_EMAIL',
        idToken: signData.idToken
      })
    });

    const oobData = await oobRes.json();
    if (oobData.error) {
      console.warn('⚠️ Ошибка отправки подтверждения почты Firebase:', oobData.error.message);
      return false;
    }

    console.log(`✉️ Письмо подтверждения почты Firebase успешно отправлено на ${email}`);
    return true;
  } catch (err) {
    console.error('Ошибка sendFirebaseVerificationEmail:', err.message);
    return false;
  }
}

module.exports = {
  sendFirebaseVerificationEmail
};
