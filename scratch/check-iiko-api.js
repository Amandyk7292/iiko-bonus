// Используем нативный fetch

const API_LOGIN = '2GeejrU30pZfUww3pu_Ap0M8qPBdxHB5HxBtsZR2tnM';

async function checkApi() {
  try {
    // 1. Получаем токен
    const tokenRes = await fetch('https://api.iiko.services/api/1/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiLogin: API_LOGIN })
    });
    
    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      throw new Error(`Token failed: ${errorText}`);
    }
    
    const { token } = await tokenRes.json();
    console.log('Token received:', token.substring(0, 10) + '...');

    // 2. Получаем организации
    const orgRes = await fetch('https://api-ru.iiko.services/api/1/organizations', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        organizationIds: null,
        returnAdditionalInfo: true
      })
    });

    if (!orgRes.ok) {
      const errorText = await orgRes.text();
      throw new Error(`Orgs failed: ${errorText}`);
    }

    const { organizations } = await orgRes.json();
    console.log('Organizations:', organizations.map(o => ({
      id: o.id,
      name: o.name
    })));
    
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkApi();
