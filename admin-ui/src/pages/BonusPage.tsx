import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function BonusPage() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const data = await api.getSettings();
      setSettings(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleChange = (field: string, value: any) => {
    setSettings((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    try {
      await api.updateSettings(settings);
      alert('Настройки сохранены успешно!');
    } catch (e: any) {
      alert('Ошибка при сохранении: ' + e.message);
    }
  };

  if (loading || !settings) {
    return <div className="p-8 text-center text-gray-500">Загрузка настроек...</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="card p-8">
        <h3 className="text-2xl font-serif text-beige-800 mb-6">Настройки бонусной системы</h3>
        
        <div className="space-y-8">
          <div className="bonus-form-section">
            <label>Базовый Кэшбэк (%)</label>
            <input 
              type="number" 
              value={settings.base_cashback_percent || 0} 
              onChange={e => handleChange('base_cashback_percent', Number(e.target.value))}
              className="input-classic w-full max-w-xs" 
            />
            <p className="text-xs text-gray-500 mt-2">Стандартный процент кэшбэка для новых клиентов (Бронза).</p>
          </div>

          <div className="bonus-form-section">
            <label>Уровни лояльности (Пороги и %)</label>
            <div className="grid grid-cols-2 gap-4 max-w-2xl">
              <div className="card p-4 bg-gray-50/50">
                <p className="font-bold text-gray-700 mb-2">Серебро</p>
                <div className="space-y-3">
                  <div>
                    <span className="text-xs text-gray-500">Порог (тнг)</span>
                    <input type="number" value={settings.tier_silver_th || 0} onChange={e => handleChange('tier_silver_th', Number(e.target.value))} className="input-classic w-full" />
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Кэшбэк (%)</span>
                    <input type="number" value={settings.tier_silver_cb || 0} onChange={e => handleChange('tier_silver_cb', Number(e.target.value))} className="input-classic w-full" />
                  </div>
                </div>
              </div>
              <div className="card p-4 bg-gray-50/50">
                <p className="font-bold text-gray-700 mb-2">Золото</p>
                <div className="space-y-3">
                  <div>
                    <span className="text-xs text-gray-500">Порог (тнг)</span>
                    <input type="number" value={settings.tier_gold_th || 0} onChange={e => handleChange('tier_gold_th', Number(e.target.value))} className="input-classic w-full" />
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Кэшбэк (%)</span>
                    <input type="number" value={settings.tier_gold_cb || 0} onChange={e => handleChange('tier_gold_cb', Number(e.target.value))} className="input-classic w-full" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bonus-form-section">
            <label>Максимальный процент списания (%)</label>
            <input 
              type="number" 
              value={settings.max_discount_percent || 0} 
              onChange={e => handleChange('max_discount_percent', Number(e.target.value))}
              className="input-classic w-full max-w-xs" 
            />
            <p className="text-xs text-gray-500 mt-2">Какую часть чека можно оплатить бонусами.</p>
          </div>

          <div className="bonus-form-section">
            <label>Автосгорание бонусов</label>
            <div className="flex items-center gap-2 mb-4">
              <input 
                type="checkbox" 
                checked={settings.bonus_expiration?.enabled || false}
                onChange={e => handleChange('bonus_expiration', { ...settings.bonus_expiration, enabled: e.target.checked })}
              />
              <span className="text-sm">Включить автосгорание при неактивности</span>
            </div>
            {settings.bonus_expiration?.enabled && (
              <div className="space-y-3 max-w-xs">
                <div>
                  <span className="text-xs text-gray-500">Дней неактивности</span>
                  <input 
                    type="number" 
                    value={settings.bonus_expiration?.expiration_days || 90}
                    onChange={e => handleChange('bonus_expiration', { ...settings.bonus_expiration, expiration_days: Number(e.target.value) })}
                    className="input-classic w-full" 
                  />
                </div>
                <div>
                  <span className="text-xs text-gray-500">Предупреждать за (дней)</span>
                  <input 
                    type="number" 
                    value={settings.bonus_expiration?.notify_before_days || 30}
                    onChange={e => handleChange('bonus_expiration', { ...settings.bonus_expiration, notify_before_days: Number(e.target.value) })}
                    className="input-classic w-full" 
                  />
                </div>
              </div>
            )}
          </div>

        </div>

        <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end">
          <button onClick={handleSave} className="btn-classic px-8 py-3 font-bold shadow-md">Сохранить настройки</button>
        </div>
      </div>
    </div>
  );
}
