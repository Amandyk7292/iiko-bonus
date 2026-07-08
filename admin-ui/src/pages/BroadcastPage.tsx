import React, { useState } from 'react';
import { api } from '../lib/api';

export default function BroadcastPage() {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleSend = async () => {
    if (!message.trim()) {
      alert('Введите текст рассылки');
      return;
    }
    if (!window.confirm('Отправить сообщение всем клиентам?')) return;

    setLoading(true);
    setStatus(null);
    try {
      const data = await api.sendBroadcast(message);
      if (data.success) {
        setStatus({ type: 'success', text: `Успешно отправлено! Рассылка доставлена ${data.sentCount} клиентам.` });
        setMessage('');
      } else {
        setStatus({ type: 'error', text: `Ошибка: ${data.error}` });
      }
    } catch (e: any) {
      setStatus({ type: 'error', text: `Ошибка связи с сервером: ${e.message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="card p-8 bg-gradient-to-br from-[#128C7E] to-[#075E54] text-white">
          <h3 className="text-2xl font-serif mb-2">WhatsApp / Telegram Рассылка</h3>
          <p className="text-emerald-100 text-sm mb-6">Отправьте сообщение об акции, новинках или изменениях в графике работы всем вашим гостям.</p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-emerald-100 uppercase mb-2">Текст сообщения</label>
              <textarea 
                rows={6} 
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Привет! В Bulka Cafe появились новые сезонные напитки..." 
                className="w-full bg-white/10 border border-white/20 text-white placeholder-emerald-200/50 rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-white/50"
              />
            </div>
            
            <button 
              onClick={handleSend} 
              disabled={loading}
              className="w-full bg-white text-[#075E54] font-bold py-3.5 rounded-xl shadow-lg hover:bg-emerald-50 transition-all flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? 'Отправка...' : 'Отправить всем'}
            </button>

            {status && (
              <p className={`text-center mt-4 text-sm font-medium ${status.type === 'success' ? 'text-emerald-300' : 'text-red-300'}`}>
                {status.text}
              </p>
            )}
          </div>
        </div>
        
        <div className="space-y-6">
          <div className="card p-6 border-l-4 border-l-blue-500">
            <h4 className="font-bold text-gray-800 mb-2">Автоматические напоминания</h4>
            <p className="text-sm text-gray-600 mb-4">Вы можете настроить автоматическую отправку PUSH или WhatsApp-сообщений гостям, которые не приходили к вам более 30 дней.</p>
            <button className="btn-outline px-4 py-2 text-sm text-blue-600 border-blue-200 hover:bg-blue-50 w-full text-center">
              Перейти в настройки
            </button>
          </div>
          
          <div className="card p-6">
            <h4 className="font-bold text-gray-800 mb-3">Правила рассылок</h4>
            <ul className="text-sm text-gray-600 space-y-2 list-disc pl-4">
              <li>Избегайте спама: отправляйте не чаще 1-2 раз в месяц.</li>
              <li>WhatsApp-рассылки требуют подключенного провайдера (Infobip, Twilio или GreenAPI).</li>
              <li>Всегда предлагайте опцию отписки.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
