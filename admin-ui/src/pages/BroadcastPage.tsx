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
      <div className="max-w-2xl mx-auto">        <div className="card p-8 bg-gradient-to-br from-indigo-600 to-purple-600 text-white">
          <h3 className="text-2xl font-serif mb-2">Push-уведомления</h3>
          <p className="text-indigo-100 text-sm mb-6">Отправьте бесплатное push-уведомление прямо на телефоны (Android/iOS).</p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-indigo-100 uppercase mb-2">Заголовок</label>
              <input 
                type="text"
                id="pushTitle"
                placeholder="Скидка 20% на всю выпечку!" 
                className="w-full bg-white/10 border border-white/20 text-white placeholder-indigo-200/50 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-white/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-indigo-100 uppercase mb-2">Текст сообщения</label>
              <textarea 
                id="pushBody"
                rows={3} 
                placeholder="Ждем вас после 20:00 в пекарнях Bulka..." 
                className="w-full bg-white/10 border border-white/20 text-white placeholder-indigo-200/50 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-white/50"
              />
            </div>
            
            <button 
              onClick={async () => {
                const title = (document.getElementById('pushTitle') as HTMLInputElement).value;
                const body = (document.getElementById('pushBody') as HTMLTextAreaElement).value;
                if (!title || !body) return alert('Заполните заголовок и текст');
                if (!window.confirm('Отправить Push-уведомление всем клиентам приложения?')) return;
                setLoading(true);
                try {
                  const token = localStorage.getItem('adminToken') || '';
                  const res = await fetch('/admin/api/push/mass', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ title, body })
                  });
                  const data = await res.json();
                  if (data.success) {
                    alert(`Успешно отправлено! Доставлено ${data.count} клиентам.`);
                    (document.getElementById('pushTitle') as HTMLInputElement).value = '';
                    (document.getElementById('pushBody') as HTMLTextAreaElement).value = '';
                  } else {
                    alert('Ошибка: ' + data.error);
                  }
                } catch(e: any) {
                  alert('Ошибка связи: ' + e.message);
                }
                setLoading(false);
              }} 
              disabled={loading}
              className="w-full bg-white text-indigo-600 font-bold py-3.5 rounded-xl shadow-lg hover:bg-indigo-50 transition-all flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? 'Отправка...' : 'Отправить PUSH всем'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
