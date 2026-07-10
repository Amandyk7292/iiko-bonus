import React from 'react';

export default function SettingsPage() {
  const logout = () => {
    localStorage.removeItem('adminToken');
    window.location.reload();
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="card p-8">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h3 className="text-2xl font-serif text-beige-800 mb-2">Общая информация</h3>
            <p className="text-gray-500 text-sm">Профиль администратора и системные настройки</p>
          </div>
          <button onClick={logout} className="btn-outline px-4 py-2 text-red-600 border-red-200 hover:bg-red-50 text-sm font-medium">Выйти из системы</button>
        </div>

        <div className="space-y-6">
          <div className="flex items-center gap-4 p-4 border border-gray-100 rounded-xl bg-gray-50/50">
            <div className="w-16 h-16 bg-gradient-to-br from-beige-400 to-beige-600 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-sm">B</div>
            <div>
              <p className="font-bold text-gray-800 text-lg">Bulka Business</p>
              <p className="text-gray-500 text-sm">Владелец / Администратор</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="card p-4 shadow-sm border-0 bg-white ring-1 ring-gray-100">
              <p className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Версия системы</p>
              <p className="text-gray-800 font-medium">v2.1.0 (React SPA)</p>
            </div>
            <div className="card p-4 shadow-sm border-0 bg-white ring-1 ring-gray-100">
              <p className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">База данных</p>
              <p className="text-green-600 font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
                Supabase
              </p>
            </div>
            <div className="card p-4 shadow-sm border-0 bg-white ring-1 ring-gray-100">
              <p className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Интеграция с кассой</p>
              <p className="text-green-600 font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
                iiko Front
              </p>
            </div>
            <div className="card p-4 shadow-sm border-0 bg-white ring-1 ring-gray-100">
              <p className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Рассылки</p>
              <p className="text-blue-600 font-medium flex items-center gap-1.5">
                WhatsApp API
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
