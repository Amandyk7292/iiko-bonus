import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../lib/api';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingCustomer, setEditingCustomer] = useState<any | null>(null);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const data = await api.getCustomers();
      setCustomers(Array.isArray(data) ? data : (data.customers || []));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const handleExport = () => {
    const rows = [['Имя', 'Телефон', 'Баланс', 'Сумма покупок']];
    customers.forEach(c => rows.push([
      c.name || '',
      c.phone || '',
      c.balance || 0,
      c.total_spent || 0
    ]));
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'bulka-customers.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const triggerExpireBonuses = async () => {
    if (!window.confirm('Запустить проверку неактивных клиентов?\nУ всех гостей, которые не совершали покупки более 90 дней, баллы будут автоматически списаны.')) return;
    try {
      const data = await api.expireInactive();
      alert(`Проверка завершена!\nСгорели неактивные бонусы у клиентов: ${data.expiredCount}\nОбщая сумма списанных бонусов: ${data.totalExpiredAmount} бон.`);
      fetchCustomers();
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
    }
  };

  const triggerNotifyInactive = async () => {
    if (!window.confirm('Запустить проверку и отправку напоминаний?\nУведомления в Telegram будут отправлены всем гостям, которые не приходили более 30 дней и у которых есть положительный баланс бонусов.')) return;
    try {
      const data = await api.notifyInactive();
      alert(`Напоминания отправлены!\nГостей, получивших уведомление: ${data.notifiedCount}\nОбщая сумма их баллов под угрозой сгорания: ${data.totalNotifiedBalance} бон.`);
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
    }
  };

  const deleteCustomer = async (id: string) => {
    if (!window.confirm('Вы уверены, что хотите безвозвратно удалить этого клиента и всю историю его транзакций?')) return;
    try {
      await api.deleteCustomer(id);
      alert('Клиент удален.');
      fetchCustomers();
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
    }
  };

  const manualBonus = async (id: string) => {
    const amount = window.prompt("Введите сумму бонусов (с минусом для списания):");
    if (!amount || isNaN(Number(amount))) return;
    const reason = window.prompt("Причина (необязательно):") || "Ручное начисление";
    try {
      const response = await fetch('/admin/api/customers/bonus', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminPwd')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ customerId: id, amount: Number(amount), reason })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP Error ${response.status}`);
      }
      alert('Успешно');
      fetchCustomers();
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.updateCustomer(editingCustomer.id, editingCustomer);
      setEditingCustomer(null);
      fetchCustomers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return customers.filter(c => {
      const nameMatch = (c.name || '').toLowerCase().includes(q);
      const phoneMatch = String(c.phone || '').toLowerCase().includes(q);
      return nameMatch || phoneMatch;
    });
  }, [search, customers]);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={handleExport} className="btn-outline px-5 py-2">Экспорт</button>
      </div>
      <div className="sagi-filter">
        <div className="sagi-field flex-1 min-w-[280px]">
          <label>Поиск</label>
          <input 
            type="text" 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            placeholder="Поиск по имени или по номеру телефона 7077087778" 
            className="input-classic w-full"
          />
        </div>
        <button onClick={triggerNotifyInactive} className="btn-outline px-4 py-2 text-sm">Напомнить гостям</button>
        <button onClick={triggerExpireBonuses} className="btn-outline px-4 py-2 text-sm text-red-600">Списать неактивные</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-beige-50">
            <tr>
              <th className="py-4 px-4">#</th>
              <th className="py-4 px-6">Имя</th>
              <th className="py-4 px-6">Телефон</th>
              <th className="py-4 px-6 text-right">Баланс</th>
              <th className="py-4 px-6 text-right">Покупки</th>
              <th className="py-4 px-6 text-center">Управление</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-700">
            {loading ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400">Загрузка...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400">Клиентов не найдено.</td></tr>
            ) : (
              filtered.map((c, i) => (
                <tr key={c.id}>
                  <td className="py-4 px-4 text-gray-400">{i + 1}</td>
                  <td className="py-4 px-6 font-medium">{c.name || 'Без имени'}</td>
                  <td className="py-4 px-6 text-gray-500">{c.phone}</td>
                  <td className="py-4 px-6 text-right font-bold text-blue-600">{c.balance || 0}</td>
                  <td className="py-4 px-6 text-right text-gray-600">{(c.total_spent || 0).toLocaleString()}</td>
                  <td className="py-4 px-6 text-center space-x-2 whitespace-nowrap">
                    <button onClick={() => manualBonus(c.id)} className="btn-outline px-3 py-1 text-xs">+/- Бонусы</button>
                    <button onClick={() => setEditingCustomer(c)} className="btn-outline px-3 py-1 text-xs">Редакт.</button>
                    <button onClick={() => deleteCustomer(c.id)} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1 rounded text-xs font-medium">Удалить</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editingCustomer && (
        <div className="fixed inset-0 bg-[#333333] bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm transition-opacity duration-300">
          <form onSubmit={saveEdit} className="card p-8 w-full max-w-md text-left">
            <h3 className="text-2xl font-serif text-beige-800 mb-6">Редактирование клиента</h3>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Имя</label>
                <input 
                  type="text" 
                  value={editingCustomer.name || ''} 
                  onChange={e => setEditingCustomer({ ...editingCustomer, name: e.target.value })}
                  className="input-classic w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Телефон</label>
                <input 
                  type="text" 
                  value={editingCustomer.phone || ''} 
                  onChange={e => setEditingCustomer({ ...editingCustomer, phone: e.target.value })}
                  className="input-classic w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Баланс бонусов</label>
                  <input 
                    type="number" 
                    value={editingCustomer.balance || 0} 
                    onChange={e => setEditingCustomer({ ...editingCustomer, balance: Number(e.target.value) })}
                    className="input-classic w-full text-blue-600 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Общие покупки (тнг)</label>
                  <input 
                    type="number" 
                    value={editingCustomer.total_spent || 0} 
                    onChange={e => setEditingCustomer({ ...editingCustomer, total_spent: Number(e.target.value) })}
                    className="input-classic w-full text-gray-700 font-semibold"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="btn-classic flex-1 py-3 font-medium shadow-sm">Сохранить</button>
              <button type="button" onClick={() => setEditingCustomer(null)} className="btn-outline flex-1 py-3 font-medium">Отмена</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
