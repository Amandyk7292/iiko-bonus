require('dotenv').config();
const { auth } = require('google-auth-library');
const fetch = require('node-fetch');

async function createOrUpdateGoogleWalletClass() {
  const issuerId = process.env.GOOGLE_ISSUER_ID;
  const credentialsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
  
  // Вы можете поменять CLASS_ID на любой другой (только английские буквы и цифры без пробелов)
  const classIdSuffix = process.env.GOOGLE_CLASS_ID || 'bulka_loyalty_1';
  
  if (!issuerId || !credentialsRaw) {
    console.error("ОШИБКА: Не заданы GOOGLE_ISSUER_ID или GOOGLE_CREDENTIALS_JSON в .env");
    console.error("Сначала создайте сервисный аккаунт, получите Issuer ID и добавьте их в .env");
    process.exit(1);
  }

  let credentials;
  try {
    credentials = JSON.parse(credentialsRaw);
  } catch (e) {
    console.error("ОШИБКА: GOOGLE_CREDENTIALS_JSON содержит невалидный JSON.");
    process.exit(1);
  }

  const classId = `${issuerId}.${classIdSuffix}`;
  
  console.log(`Авторизация в Google API...`);
  
  const client = auth.fromJSON(credentials);
  client.scopes = ['https://www.googleapis.com/auth/wallet_object.issuer'];
  
  await client.authorize();
  const token = await client.getAccessToken();

  console.log(`Создание/обновление класса лояльности: ${classId}...`);

  // Настройка внешнего вида карты (Класса)
  const loyaltyClass = {
    id: classId,
    issuerName: 'Bulka',
    reviewStatus: 'UNDER_REVIEW', // Для тестирования нормально, потом Google сам переведет в APPROVED (или можно сразу 'UNDER_REVIEW', чтобы опубликовать - нужно запросить доступ в консоли)
    programName: 'Bulka Bonus',
    programLogo: {
      sourceUri: {
        uri: 'https://cdn-icons-png.flaticon.com/512/3014/3014493.png' // Временная иконка, лучше поменять на ваш реальный логотип (в интернете)
      }
    },
    hexBackgroundColor: '#1e140c',
    heroImage: {
      sourceUri: {
        uri: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=1024&auto=format&fit=crop' // Временная картинка пекарни/хлеба на фоне
      }
    },
    textModulesData: [
      {
        id: 'balance_info',
        header: 'Как тратить бонусы?',
        body: '1 бонус = 1 тенге. Оплачивайте бонусами до 50% стоимости заказа.'
      }
    ],
    locations: [
      {
        latitude: 43.238949, // Алматы (для примера, можно поменять на точные координаты)
        longitude: 76.889709
      }
    ]
  };

  try {
    // Сначала пробуем получить класс (может он уже существует)
    const getRes = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${classId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token.token}` }
    });

    if (getRes.ok) {
      console.log(`Класс уже существует. Обновляем (PUT)...`);
      const putRes = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${classId}`, {
        method: 'PUT',
        headers: { 
          Authorization: `Bearer ${token.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(loyaltyClass)
      });
      const putData = await putRes.json();
      if (!putRes.ok) throw new Error(JSON.stringify(putData));
      console.log(`Класс успешно обновлен!`);
    } else {
      console.log(`Класс не найден. Создаем новый (POST)...`);
      const postRes = await fetch('https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(loyaltyClass)
      });
      const postData = await postRes.json();
      if (!postRes.ok) throw new Error(JSON.stringify(postData));
      console.log(`Класс успешно создан!`);
    }

    console.log(`\n======================================================`);
    console.log(`ГОТОВО! ID вашего класса: ${classIdSuffix}`);
    console.log(`Пожалуйста, убедитесь, что в файле .env прописано:`);
    console.log(`GOOGLE_CLASS_ID="${classIdSuffix}"`);
    console.log(`======================================================\n`);

  } catch (error) {
    console.error("Ошибка при запросе к Google Wallet API:");
    console.error(error.message);
  }
}

createOrUpdateGoogleWalletClass();
