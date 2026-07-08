import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function LocationsPage() {
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<any | null>(null);

  const [form, setForm] = useState({
    name: '',
    address: '',
    latitude: '',
    longitude: '',
    status: 'active'
  });

  const fetchLocations = async () => {
    setLoading(true);
    try {
      const data = await api.getLocations();
      setLocations(data.locations || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLocations();
  }, []);

  const handleOpenModal = (loc?: any) => {
    if (loc) {
      setEditingLocation(loc);
      setForm({
        name: loc.name || '',
        address: loc.address || '',
        latitude: String(loc.latitude || ''),
        longitude: String(loc.longitude || ''),
        status: loc.status || 'active'
      });
    } else {
      setEditingLocation(null);
      setForm({ name: '', address: '', latitude: '', longitude: '', status: 'active' });
    }
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.address || !form.latitude || !form.longitude) {
      alert('Заполните все поля!');
      return;
    }
    const payload = {
      ...form,
      latitude: parseFloat(form.latitude),
      longitude: parseFloat(form.longitude)
    };
    try {
      if (editingLocation) {
        await api.updateLocation(editingLocation.id, payload);
      } else {
        await api.addLocation(payload);
      }
      setModalOpen(false);
      fetchLocations();
    } catch (err: any) {
      alert('Ошибка при сохранении: ' + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Удалить филиал?')) return;
    try {
      await api.deleteLocation(id);
      fetchLocations();
    } catch (err: any) {
      alert('Ошибка: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end mb-4">
        <button onClick={() => handleOpenModal()} className="btn-classic px-5 py-2.5 font-medium shadow-sm">
          + Добавить филиал
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-beige-50">
            <tr>
              <th className="py-4 px-6">Название филиала</th>
              <th className="py-4 px-6">Адрес</th>
              <th className="py-4 px-6">Координаты</th>
              <th className="py-4 px-6">Статус</th>
              <th className="py-4 px-6 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-700">
            {loading ? (
              <tr><td colSpan={5} className="py-8 text-center text-gray-400">Загрузка...</td></tr>
            ) : locations.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-gray-400">Нет филиалов</td></tr>
            ) : (
              locations.map(loc => (
                <tr key={loc.id}>
                  <td className="py-4 px-6 font-medium">{loc.name}</td>
                  <td className="py-4 px-6">{loc.address}</td>
                  <td className="py-4 px-6 text-gray-500">{loc.latitude}, {loc.longitude}</td>
                  <td className="py-4 px-6">
                    <span className={`px-2 py-1 rounded text-xs ${loc.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {loc.status === 'active' ? 'Активен' : 'Скрыт'}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-right space-x-2 whitespace-nowrap">
                    <button onClick={() => handleOpenModal(loc)} className="btn-outline px-3 py-1 text-xs">Изменить</button>
                    <button onClick={() => handleDelete(loc.id)} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1 rounded text-xs font-medium">Удалить</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-[#333333] bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="card p-8 w-full max-w-md text-left max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-serif text-beige-800 mb-6">{editingLocation ? 'Редактировать филиал' : 'Добавить филиал'}</h3>
            
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Название (Город, ТЦ)</label>
                <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-classic w-full" placeholder="Булька - Ақтау" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Точный адрес</label>
                <input type="text" value={form.address} onChange={e => setForm({...form, address: e.target.value})} className="input-classic w-full" placeholder="12 мкр, д 15" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Широта (Lat)</label>
                  <input type="number" step="any" value={form.latitude} onChange={e => setForm({...form, latitude: e.target.value})} className="input-classic w-full" placeholder="43.64" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Долгота (Lng)</label>
                  <input type="number" step="any" value={form.longitude} onChange={e => setForm({...form, longitude: e.target.value})} className="input-classic w-full" placeholder="51.15" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Статус видимости в приложении</label>
                <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} className="input-classic w-full">
                  <option value="active">Показывать на карте</option>
                  <option value="hidden">Временно скрыть (Ремонт)</option>
                </select>
              </div>

              <div className="flex gap-3 mt-6">
                <button type="submit" className="btn-classic flex-1 py-3 font-medium shadow-sm">Сохранить</button>
                <button type="button" onClick={() => setModalOpen(false)} className="btn-outline flex-1 py-3 font-medium">Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
