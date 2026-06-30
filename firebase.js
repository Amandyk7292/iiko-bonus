const admin = require('firebase-admin');
require('dotenv').config();

// Инициализация Firebase
// Вариант 1: Через сервисный аккаунт, если указан в .env
if (process.env.FIREBASE_PRIVATE_KEY) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
} else {
  // Вариант 2: Для локального тестирования или запуска в Google Cloud (использует дефолтные credentials)
  admin.initializeApp();
}

const db = admin.firestore();

module.exports = { admin, db };
