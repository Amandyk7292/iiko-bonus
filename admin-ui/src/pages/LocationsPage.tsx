import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

type LanguageKey = 'ru' | 'kz' | 'en';
const LANGUAGES: { key: LanguageKey; label: string }[] = [
  { key: 'ru', label: 'Русский' },
  { key: 'kz', label: 'Қазақша' },
  { key: 'en', label: 'English' }
];

export default function LocationsPage() {
  const [cities, setCities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Общие
  const [activeTab, setActiveTab] = useState<LanguageKey>('ru');
  const [translating, setTranslating] = useState(false);

  // Модалка для Городов
  const [cityModalOpen, setCityModalOpen] = useState(false);
  const [editingCity, setEditingCity] = useState<any | null>(null);
  const [cityI18n, setCityI18n] = useState<Record<LanguageKey, { name: string }>>({
    ru: { name: '' },
    kz: { name: '' },
    en: { name: '' }
  });

  // Модалка для Точек
  const [pointModalOpen, setPointModalOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState<any | null>(null);
  const [targetCityId, setTargetCityId] = useState<string>('');
  const [pointI18n, setPointI18n] = useState<Record<LanguageKey, { name: string, address: string }>>({
    ru: { name: '', address: '' },
    kz: { name: '', address: '' },
    en: { name: '', address: '' }
  });

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

  const translateText = async (text: string, from: string, to: string) => {
    if (!text) return '';
    try {
      const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`);
      const data = await res.json();
      return data?.responseData?.translatedText || text;
    } catch (e) {
      console.error(e);
      return text;
    }
  };

  // --- ГОРОДА ---
  const handleOpenCityModal = (city?: any) => {
    setActiveTab('ru');
    if (city) {
      setEditingCity(city);
      const i18n = city.i18n || {};
      setCityI18n({
        ru: { name: i18n.ru?.name || city.name || '' },
        kz: { name: i18n.kz?.name || '' },
        en: { name: i18n.en?.name || '' }
      });
    } else {
      setEditingCity(null);
      setCityI18n({
        ru: { name: '' },
        kz: { name: '' },
        en: { name: '' }
      });
    }
    setCityModalOpen(true);
  };

  const handleAutoTranslateCity = async () => {
    if (!cityI18n.ru.name) return;
    setTranslating(true);
    try {
      const [kzName, enName] = await Promise.all([
        translateText(cityI18n.ru.name, 'ru', 'kk'),
        translateText(cityI18n.ru.name, 'ru', 'en')
      ]);
      setCityI18n(prev => ({
        ...prev,
        kz: { name: kzName },
        en: { name: enName }
      }));
    } finally {
      setTranslating(false);
    }
  };

  const handleSaveCity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cityI18n.ru.name) {
      alert('Введите название города на русском!');
      return;
    }
    
    const payload = {
      name: cityI18n.ru.name,
      i18n: cityI18n
    };

    try {
      if (editingCity) {
        await api.updateCity(editingCity.id, payload);
      } else {
        await api.addCity(payload);
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

  // --- ТОЧКИ ---
  const handleOpenPointModal = (cityId: string, point?: any) => {
    setTargetCityId(cityId);
    setActiveTab('ru');
    if (point) {
      setEditingPoint(point);
      const i18n = point.i18n || {};
      setPointI18n({
        ru: { name: i18n.ru?.name || point.name || '', address: i18n.ru?.address || point.address || '' },
        kz: { name: i18n.kz?.name || '', address: i18n.kz?.address || '' },
        en: { name: i18n.en?.name || '', address: i18n.en?.address || '' }
      });
    } else {
      setEditingPoint(null);
      setPointI18n({
        ru: { name: '', address: '' },
        kz: { name: '', address: '' },
        en: { name: '', address: '' }
      });
    }
    setPointModalOpen(true);
  };

  const handleAutoTranslatePoint = async () => {
    if (!pointI18n.ru.name && !pointI18n.ru.address) return;
    setTranslating(true);
    try {
      const [kzName, enName, kzAddress, enAddress] = await Promise.all([
        translateText(pointI18n.ru.name, 'ru', 'kk'),
        translateText(pointI18n.ru.name, 'ru', 'en'),
        translateText(pointI18n.ru.address, 'ru', 'kk'),
        translateText(pointI18n.ru.address, 'ru', 'en')
      ]);
      setPointI18n(prev => ({
        ...prev,
        kz: { name: kzName, address: kzAddress },
        en: { name: enName, address: enAddress }
      }));
    } finally {
      setTranslating(false);
    }
  };

  const handleSavePoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pointI18n.ru.name || !pointI18n.ru.address) {
      alert('Заполните название и адрес на русском!');
      return;
    }
    
    const payload = {
      name: pointI18n.ru.name,
      address: pointI18n.ru.address,
      latitude: 0,
      longitude: 0,
      i18n: pointI18n
    };

    try {
      if (editingPoint) {
        await api.updatePoint(editingPoint.id, payload);
      } else {
        await api.addPoint(targetCityId, payload);
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

  // --- UI Components ---
  const renderLanguageTabs = () => (
    <div className="flex border-b border-gray-200 mb-6">
      {LANGUAGES.map(lang => (
        <button
          key={lang.key}
          type="button"
          onClick={() => setActiveTab(lang.key)}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === lang.key
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Города и филиалы</h2>
          <p className="text-sm text-gray-500 mt-1">Управление локациями и их переводами</p>
        </div>
        <button onClick={() => handleOpenCityModal()} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Добавить город
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">Город / Филиал</th>
              <th className="py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">Адрес</th>
              <th className="py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
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
                  <tr className="bg-gray-50/50">
                    <td className="py-4 px-6">
                      <span className="font-bold text-gray-900">{city.i18n?.ru?.name || city.name}</span>
                    </td>
                    <td className="py-4 px-6 text-gray-400">—</td>
                    <td className="py-4 px-6 text-right space-x-2 whitespace-nowrap">
                      <button onClick={() => handleOpenPointModal(city.id)} className="text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-md text-xs font-medium transition-colors">
                        + Добавить точку
                      </button>
                      <button onClick={() => handleOpenCityModal(city)} className="text-gray-600 hover:text-gray-900 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-md text-xs font-medium transition-colors">
                        Изменить
                      </button>
                      <button onClick={() => handleDeleteCity(city.id)} className="text-red-600 hover:text-red-800 border border-red-100 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-md text-xs font-medium transition-colors">
                        Удалить
                      </button>
                    </td>
                  </tr>
                  
                  {/* Точки Города */}
                  {(!city.points || city.points.length === 0) ? (
                    <tr>
                      <td colSpan={3} className="py-4 px-12 text-gray-400 italic text-sm">
                        Нет точек в этом городе
                      </td>
                    </tr>
                  ) : (
                    city.points.map((point: any) => (
                      <tr key={point.id} className="hover:bg-gray-50 transition-colors">
                        <td className="py-4 pl-12 pr-6 font-medium text-gray-700 relative">
                          <span className="absolute left-6 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-gray-300"></span>
                          {point.i18n?.ru?.name || point.name}
                        </td>
                        <td className="py-4 px-6 text-gray-600">
                          {point.i18n?.ru?.address || point.address}
                        </td>
                        <td className="py-4 px-6 text-right space-x-3 whitespace-nowrap">
                          <button onClick={() => handleOpenPointModal(city.id, point)} className="text-indigo-600 hover:text-indigo-800 text-xs font-medium">Редактировать</button>
                          <button onClick={() => handleDeletePoint(point.id)} className="text-red-500 hover:text-red-700 text-xs font-medium">Удалить</button>
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
        <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">{editingCity ? 'Редактировать город' : 'Новый город'}</h3>
              <button onClick={() => setCityModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSaveCity} className="p-6">
              
              <div className="flex justify-between items-center mb-2">
                {renderLanguageTabs()}
                <button 
                  type="button" 
                  onClick={handleAutoTranslateCity}
                  disabled={translating || !cityI18n.ru.name}
                  className="mb-6 px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {translating ? 'Переводим...' : 'Автоперевод'}
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Название города</label>
                  <input 
                    required={activeTab === 'ru'} 
                    type="text" 
                    value={cityI18n[activeTab].name} 
                    onChange={e => setCityI18n({...cityI18n, [activeTab]: { ...cityI18n[activeTab], name: e.target.value }})} 
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-gray-900 transition-all text-sm" 
                    placeholder={activeTab === 'ru' ? "Актау" : (activeTab === 'kz' ? "Ақтау" : "Aktau")} 
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-8">
                <button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg font-medium transition-colors">Сохранить</button>
                <button type="button" onClick={() => setCityModalOpen(false)} className="px-6 py-2.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors">Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модалка Точки */}
      {pointModalOpen && (
        <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">{editingPoint ? 'Редактировать точку' : 'Новая точка'}</h3>
              <button onClick={() => setPointModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSavePoint} className="p-6">

              <div className="flex justify-between items-center mb-2">
                {renderLanguageTabs()}
                <button 
                  type="button" 
                  onClick={handleAutoTranslatePoint}
                  disabled={translating || (!pointI18n.ru.name && !pointI18n.ru.address)}
                  className="mb-6 px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {translating ? 'Переводим...' : 'Автоперевод'}
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Название (ТЦ, Филиал)</label>
                  <input 
                    required={activeTab === 'ru'} 
                    type="text" 
                    value={pointI18n[activeTab].name} 
                    onChange={e => setPointI18n({...pointI18n, [activeTab]: { ...pointI18n[activeTab], name: e.target.value }})} 
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-gray-900 transition-all text-sm" 
                    placeholder="ТРЦ Актау" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Точный адрес</label>
                  <input 
                    required={activeTab === 'ru'} 
                    type="text" 
                    value={pointI18n[activeTab].address} 
                    onChange={e => setPointI18n({...pointI18n, [activeTab]: { ...pointI18n[activeTab], address: e.target.value }})} 
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-gray-900 transition-all text-sm" 
                    placeholder="16 мкр, д 11" 
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-8">
                <button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg font-medium transition-colors">Сохранить</button>
                <button type="button" onClick={() => setPointModalOpen(false)} className="px-6 py-2.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors">Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
