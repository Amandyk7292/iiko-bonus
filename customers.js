const { db } = require('./firebase');

/**
 * Получение клиента по номеру телефона
 * Если клиента нет, он создается с балансом 0
 */
async function getOrCreateCustomerByPhone(phone) {
  // Убираем лишние символы из телефона (например, оставляем только цифры)
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  
  const customersRef = db.collection('customers');
  const snapshot = await customersRef.where('phone', '==', cleanPhone).get();
  
  if (snapshot.empty) {
    // Создаем нового клиента
    const newCustomer = {
      phone: cleanPhone,
      balance: 0,
      createdAt: new Date().toISOString(),
      name: 'Новый Гость'
    };
    const docRef = await customersRef.add(newCustomer);
    return { id: docRef.id, ...newCustomer };
  }
  
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

/**
 * Обновление баланса клиента
 */
async function updateCustomerBalance(customerId, amountChange) {
  const customerRef = db.collection('customers').doc(customerId);
  
  await db.runTransaction(async (t) => {
    const doc = await t.get(customerRef);
    if (!doc.exists) {
      throw new Error('Customer not found');
    }
    const newBalance = (doc.data().balance || 0) + amountChange;
    t.update(customerRef, { balance: newBalance });
  });
}

/**
 * Запись транзакции
 */
async function logTransaction(transactionData) {
  transactionData.timestamp = new Date().toISOString();
  await db.collection('transactions').add(transactionData);
}

module.exports = {
  getOrCreateCustomerByPhone,
  updateCustomerBalance,
  logTransaction
};
