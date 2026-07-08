import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function IikoPage() {
  const [operations, setOperations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchIikoOperations = async () => {
    setLoading(true);
    try {
      const data = await api.getIikoOperations();
      setOperations(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIikoOperations();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex gap-4 mb-4">
        <div className="flex-1 card p-6 border-l-4 border-l-orange-500 bg-orange-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center text-orange-600 font-bold text-xl">iiko</div>
            <div>
              <p className="font-bold text-gray-800">Статус интеграции</p>
              <p className="text-sm text-green-600 font-medium flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
                Подключено и работает
              </p>
            </div>
          </div>
        </div>
        <div className="card p-6 flex items-center justify-center min-w-[200px]">
          <button onClick={fetchIikoOperations} className="btn-outline px-4 py-2 w-full">Обновить лог</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-beige-50">
            <tr>
              <th className="py-4 px-6">Дата</th>
              <th className="py-4 px-6">ID Операции</th>
              <th className="py-4 px-6">Тип</th>
              <th className="py-4 px-6">Сумма заказа</th>
              <th className="py-4 px-6">Оплачено бонусами</th>
              <th className="py-4 px-6">Начислено бонусов</th>
              <th className="py-4 px-6">Клиент</th>
              <th className="py-4 px-6">Статус iiko</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-700">
            {loading ? (
              <tr><td colSpan={8} className="py-8 text-center text-gray-400">Загрузка...</td></tr>
            ) : operations.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-gray-400">Операций пока нет</td></tr>
            ) : (
              operations.map(op => (
                <tr key={op.id}>
                  <td className="py-4 px-6 text-gray-500 text-xs">{new Date(op.created_at).toLocaleString()}</td>
                  <td className="py-4 px-6 font-mono text-xs">{op.order_id || '—'}</td>
                  <td className="py-4 px-6">
                    <span className={`px-2 py-1 rounded text-xs ${op.discount_amount > 0 ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {op.discount_amount > 0 ? 'Списание' : 'Начисление'}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-right font-medium">{op.order_total || '—'}</td>
                  <td className="py-4 px-6 text-right text-red-500">{op.discount_amount > 0 ? op.discount_amount : '—'}</td>
                  <td className="py-4 px-6 text-right text-green-600 font-bold">{op.earned_bonus > 0 ? `+${op.earned_bonus}` : '—'}</td>
                  <td className="py-4 px-6 text-gray-500">{op.customers?.phone || '—'}</td>
                  <td className="py-4 px-6">
                    <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded font-medium">SUCCESS</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
