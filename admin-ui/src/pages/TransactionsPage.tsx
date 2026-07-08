import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../lib/api';

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const data = await api.getTransactions();
      setTransactions(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  const manualBonus = async () => {
    const phone = window.prompt("Введите телефон клиента:");
    if (!phone) return;
    
    // In a real app we'd search the backend, but since this is an admin panel we might need to search the customer list
    // or provide an autocomplete. For simplicity, we just trigger an alert to use CustomersPage.
    alert("Для ручного начисления перейдите во вкладку 'База клиентов' и нажмите кнопку '+/- Бонусы' у нужного клиента.");
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return transactions.filter(t => {
      const name = t.customers?.name || '';
      const phone = t.customers?.phone || '';
      const orderId = String(t.order_id || '');
      return name.toLowerCase().includes(q) || phone.includes(q) || orderId.toLowerCase().includes(q);
    });
  }, [search, transactions]);

  return (
    <div className="space-y-6">
      <div className="flex gap-2 flex-wrap justify-end">
        <button onClick={() => alert('Форма оплаты подключается к iiko POS. Используйте кассу для проведения оплаты.')} className="btn-classic px-4 py-2">Провести оплату</button>
        <button onClick={manualBonus} className="btn-outline px-4 py-2">Начислить бонус</button>
      </div>

      <div className="sagi-filter">
        <div className="sagi-field">
          <label>За весь период</label>
          <input type="date" className="input-classic" />
        </div>
        <div className="sagi-field">
          <label>До</label>
          <input type="date" className="input-classic" />
        </div>
        <div className="sagi-field flex-1 min-w-[260px]">
          <label>Поиск</label>
          <input 
            type="text" 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            placeholder="Поиск по номеру телефона или чеку" 
            className="input-classic w-full"
          />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-beige-50">
            <tr>
              <th className="py-4 px-6">Дата</th>
              <th className="py-4 px-6">Номер транзакции</th>
              <th className="py-4 px-6">Клиент</th>
              <th className="py-4 px-6">Телефон</th>
              <th className="py-4 px-6 text-right">Сумма</th>
              <th className="py-4 px-6 text-right">Использовано</th>
              <th className="py-4 px-6 text-right">Бонус</th>
              <th className="py-4 px-6">Статус</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-700">
            {loading ? (
              <tr><td colSpan={8} className="py-8 text-center text-gray-400">Загрузка транзакций...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-gray-400">Транзакций не найдено</td></tr>
            ) : (
              filtered.map(t => {
                const d = new Date(t.timestamp).toLocaleString();
                const isDeposit = t.type.includes('deposit');
                const color = isDeposit ? 'text-green-600' : 'text-red-500';
                const sign = isDeposit ? '+' : '-';
                const name = t.customers?.name || 'Unknown';
                const phone = t.customers?.phone || '—';
                
                let typeStr = t.type;
                if(t.type === 'deposit') typeStr = 'Начисление кэшбэка';
                if(t.type === 'pending_deposit') typeStr = 'Ожидает активации';
                if(t.type === 'withdrawal') typeStr = 'Оплата бонусами';
                if(t.type === 'manual_deposit') typeStr = 'Ручное начисление';
                if(t.type === 'manual_withdrawal') typeStr = 'Ручное списание';
                if(t.type === 'expiration') typeStr = 'Сгорание (90 дней)';

                let orderBadge = (
                  <span className="bg-beige-100 text-beige-800 font-mono px-2.5 py-1 rounded text-xs border border-beige-200 font-semibold">
                    Чек №{t.order_id || '—'}
                  </span>
                );
                
                if (t.order_id === 'MANUAL' || t.type.includes('manual')) {
                  orderBadge = <span className="bg-purple-100 text-purple-700 font-sans px-2.5 py-1 rounded text-xs border border-purple-200 font-medium">Ручная операция</span>;
                } else if (t.type === 'expiration' || t.order_id === 'EXPIRED_90_DAYS') {
                  orderBadge = <span className="bg-orange-100 text-orange-700 font-sans px-2.5 py-1 rounded text-xs border border-orange-200 font-medium">Автосгорание</span>;
                }

                return (
                  <tr key={t.id}>
                    <td className="py-4 px-6 text-gray-500 text-xs">{d}</td>
                    <td className="py-4 px-6">{orderBadge}</td>
                    <td className="py-4 px-6 font-medium">{name}</td>
                    <td className="py-4 px-6 text-gray-500">{phone}</td>
                    <td className="py-4 px-6 text-right text-gray-700 font-medium">{t.order_total?.toLocaleString() || '—'}</td>
                    <td className={`py-4 px-6 text-right ${color}`}>{t.type.includes('withdrawal') ? t.amount : '—'}</td>
                    <td className={`py-4 px-6 text-right font-bold ${color}`}>{sign}{t.amount}</td>
                    <td className="py-4 px-6"><span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded text-xs font-medium">{typeStr}</span></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
