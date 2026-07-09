import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function LocationsPage() {
  const [cities, setCities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Модалка для Городов
  const [cityModalOpen, setCityModalOpen] = useState(false);
  const [editingCity, setEditingCity] = useState<any | null>(null);
  const [cityForm, setCityForm] = useState({ name: '' });

  // Модалка для Точек
  const [pointModalOpen, setPointModalOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState<any | null>(null);
  const [targetCityId, setTargetCityId] = useState<string>('');
  const [pointForm, setPointForm] = useState({ name: '', address: '' });

  const fetchCities = async () => {
    setLoading(true);
    try {
      const data = await api.getCities();
      setCities(data.cities || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCities();
  }, []);

  // Города CRUD
  const handleOpenCityModal = (city?: any) => {
    if (city) {
      setEditingCity(city);
      setCityForm({ name: city.name || '' });
    } else {
      setEditingCity(null);
      setCityForm({ name: '' });
    }
    setCityModalOpen(true);
  };

  const handleSaveCity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cityForm.name) {
      alert('Введите название города!');
      return;
    }
    try {
      if (editingCity) {
        await api.updateCity(editingCity.id, cityForm);
      } else {
        await api.addCity(cityForm);
      }
      setCityModalOpen(false);
      fetchCities();
    } catch (err: any) {
      alert('Ошибка при сохранении города: ' + err.message);
    }
  };

  const handleDeleteCity = async (id: string) => {
    if (!window.confirm('Вы уверены, что хотите удалить этот город и все его точки?')) return;
    try {
      await api.deleteCity(id);
      fetchCities();
    } catch (err: any) {
      alert('Ошибка: ' + err.message);
    }
  };

  // Точки CRUD
  const handleOpenPointModal = (cityId: string, point?: any) => {
    setTargetCityId(cityId);
    if (point) {
      setEditingPoint(point);
      setPointForm({ name: point.name || '', address: point.address || '' });
    } else {
      setEditingPoint(null);
      setPointForm({ name: '', address: '' });
    }
    setPointModalOpen(true);
  };

  const handleSavePoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pointForm.name || !pointForm.address) {
      alert('Заполните все поля!');
      return;
    }
    try {
      if (editingPoint) {
        await api.updatePoint(editingPoint.id, pointForm);
      } else {
        await api.addPoint(targetCityId, pointForm);
      }
      setPointModalOpen(false);
      fetchCities();
    } catch (err: any) {
      alert('Ошибка при сохранении точки: ' + err.message);
    }
  };

  const handleDeletePoint = async (id: string) => {
    if (!window.confirm('Удалить эту точку?')) return;
    try {
      await api.deletePoint(id);
      fetchCities();
    } catch (err: any) {
      alert('Ошибка: ' + err.message);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold text-[#6d3317]">Города и точки</h2>
          <p className="text-sm text-gray-600 mt-1">Управляйте списком городов и их филиалами</p>
        </div>
        <button onClick={() => handleOpenCityModal()} className="btn-classic px-5 py-3 font-medium shadow-md flex items-center justify-center gap-2 transition-all hover:scale-[1.02]">
          <span>+ Добавить город</span>
        </button>
      </div>

      <div className="card overflow-hidden border border-amber-900/10 shadow-lg">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[#fcf8f2] border-b border-amber-900/10">
            <tr>
              <th className="py-4 px-6 text-xs uppercase tracking-wider font-semibold text-[#6d3317]">Город / Название точки</th>
              <th className="py-4 px-6 text-xs uppercase tracking-wider font-semibold text-[#6d3317]">Адрес</th>
              <th className="py-4 px-6 text-xs uppercase tracking-wider font-semibold text-[#6d3317] text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-900/5 text-sm text-gray-700">
            {loading ? (
              <tr><td colSpan={3} className="py-12 text-center text-gray-400">Загрузка...</td></tr>
            ) : cities.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-12 text-center text-gray-500">
                  <p className="font-medium">Города пока не добавлены</p>
                </td>
              </tr>
            ) : (
              cities.map(city => (
                <React.Fragment key={city.id}>
                  {/* Строка Города */}
                  <tr className="bg-[#fdfbf7] border-b-2 border-amber-900/5">
                    <td className="py-4 px-6 font-bold text-lg text-[#6d3317]">
                      🏢 {city.name}
                    </td>
                    <td className="py-4 px-6 text-gray-500">—</td>
                    <td className="py-4 px-6 text-right space-x-2 whitespace-nowrap">
                      <button onClick={() => handleOpenPointModal(city.id)} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1 rounded text-xs font-medium">+ Добавить точку</button>
                      <button onClick={() => handleOpenCityModal(city)} className="btn-outline px-3 py-1 text-xs ml-2">Изменить</button>
                      <button onClick={() => handleDeleteCity(city.id)} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1 rounded text-xs font-medium ml-2">Удалить</button>
                    </td>
                  </tr>
                  
                  {/* Точки Города */}
                  {(!city.points || city.points.length === 0) ? (
                    <tr>
                      <td colSpan={3} className="py-4 px-12 text-gray-400 italic bg-white text-sm">
                        Нет точек в этом городе
                      </td>
                    </tr>
                  ) : (
                    city.points.map((point: any) => (
                      <tr key={point.id} className="bg-white hover:bg-[#fefcf8] transition-colors">
                        <td className="py-4 pl-12 pr-6 font-medium text-gray-800 border-l-4 border-l-amber-200">
                          📍 {point.name}
                        </td>
                        <td className="py-4 px-6 text-gray-600">
                          {point.address}
                        </td>
                        <td className="py-4 px-6 text-right space-x-2 whitespace-nowrap">
                          <button onClick={() => handleOpenPointModal(city.id, point)} className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2">Ред.</button>
                          <button onClick={() => handleDeletePoint(point.id)} className="text-red-500 hover:text-red-700 text-xs font-medium px-2">Удалить</button>
                        </td>
                      </tr>
                    ))
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Модалка Города */}
      {cityModalOpen && (
        <div className="fixed inset-0 bg-[#333333] bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md border border-amber-900/10 overflow-hidden">
            <div className="px-8 pt-7 pb-5 bg-[#fcf8f2] border-b border-amber-900/10">
              <h3 className="text-2xl font-serif font-bold text-[#6d3317]">{editingCity ? 'Редактировать город' : 'Новый город'}</h3>
            </div>
            <form onSubmit={handleSaveCity} className="p-8 space-y-5">
              <div>
                <label className="block text-xs font-bold text-[#6d3317] uppercase tracking-wider mb-1.5">Название города</label>
                <input required type="text" value={cityForm.name} onChange={e => setCityForm({...cityForm, name: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#6d3317] focus:ring-2 focus:ring-[#6d3317]/20 outline-none text-gray-900 transition-all text-sm font-medium" placeholder="Ақтау" />
              </div>
              <div className="flex gap-3 pt-3">
                <button type="submit" className="btn-classic flex-1 py-3 font-semibold shadow-md">Сохранить</button>
                <button type="button" onClick={() => setCityModalOpen(false)} className="px-6 py-3 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium">Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модалка Точки */}
      {pointModalOpen && (
        <div className="fixed inset-0 bg-[#333333] bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md border border-amber-900/10 overflow-hidden">
            <div className="px-8 pt-7 pb-5 bg-[#fcf8f2] border-b border-amber-900/10">
              <h3 className="text-2xl font-serif font-bold text-[#6d3317]">{editingPoint ? 'Редактировать точку' : 'Новая точка'}</h3>
            </div>
            <form onSubmit={handleSavePoint} className="p-8 space-y-5">
              <div>
                <label className="block text-xs font-bold text-[#6d3317] uppercase tracking-wider mb-1.5">Название (ТЦ, Филиал)</label>
                <input required type="text" value={pointForm.name} onChange={e => setPointForm({...pointForm, name: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#6d3317] focus:ring-2 focus:ring-[#6d3317]/20 outline-none text-gray-900 transition-all text-sm font-medium" placeholder="ТРЦ Актау" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#6d3317] uppercase tracking-wider mb-1.5">Точный адрес</label>
                <input required type="text" value={pointForm.address} onChange={e => setPointForm({...pointForm, address: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#6d3317] focus:ring-2 focus:ring-[#6d3317]/20 outline-none text-gray-900 transition-all text-sm font-medium" placeholder="16 мкр, д 11" />
              </div>
              <div className="flex gap-3 pt-3">
                <button type="submit" className="btn-classic flex-1 py-3 font-semibold shadow-md">Сохранить</button>
                <button type="button" onClick={() => setPointModalOpen(false)} className="px-6 py-3 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium">Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
