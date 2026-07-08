import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function NewsPage() {
  const [newsList, setNewsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingNews, setEditingNews] = useState<any | null>(null);

  const [form, setForm] = useState({
    title: '',
    imageUrl: '',
    description: ''
  });
  const [uploadStatus, setUploadStatus] = useState<string>('');

  const fetchNews = async () => {
    setLoading(true);
    try {
      const data = await api.getNews();
      setNewsList(data.news || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
  }, []);

  const handleOpenModal = (newsItem?: any) => {
    if (newsItem) {
      setEditingNews(newsItem);
      setForm({
        title: newsItem.title || '',
        imageUrl: newsItem.imageUrl || newsItem.imageurl || '',
        description: newsItem.description || ''
      });
    } else {
      setEditingNews(null);
      setForm({ title: '', imageUrl: '', description: '' });
    }
    setModalOpen(true);
  };

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    
    setUploadStatus('Загрузка в Supabase...');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target?.result as string;
      try {
        const res = await api.uploadPhoto(base64, file.name);
        if (res.success) {
          setForm(prev => ({ ...prev, imageUrl: res.url }));
          setUploadStatus('Успешно загружено!');
          setTimeout(() => setUploadStatus(''), 3000);
        } else {
          setUploadStatus('Ошибка загрузки');
        }
      } catch (err: any) {
        setUploadStatus('Ошибка: ' + err.message);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.imageUrl) {
      alert('Укажите заголовок и фото!');
      return;
    }
    try {
      if (editingNews) {
        await api.updateNews({ ...form, id: editingNews.id });
      } else {
        await api.addNews(form);
      }
      setModalOpen(false);
      fetchNews();
    } catch (err: any) {
      alert('Ошибка при сохранении: ' + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Удалить новость?')) return;
    try {
      await api.deleteNews(id);
      fetchNews();
    } catch (err: any) {
      alert('Ошибка: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end mb-4">
        <button onClick={() => handleOpenModal()} className="btn-classic px-5 py-2.5 font-medium shadow-sm flex items-center gap-2">
          <span>+ Создать новость</span>
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-beige-50">
            <tr>
              <th className="py-4 px-6">Фото</th>
              <th className="py-4 px-6">Заголовок</th>
              <th className="py-4 px-6">Описание</th>
              <th className="py-4 px-6">Дата</th>
              <th className="py-4 px-6 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-700">
            {loading ? (
              <tr><td colSpan={5} className="py-8 text-center text-gray-400">Загрузка...</td></tr>
            ) : newsList.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-gray-400">Новостей пока нет</td></tr>
            ) : (
              newsList.map(n => (
                <tr key={n.id}>
                  <td className="py-4 px-6">
                    <img src={n.imageUrl || n.imageurl} className="w-16 h-10 object-cover rounded-md border border-gray-200" />
                  </td>
                  <td className="py-4 px-6 font-medium text-gray-900">{n.title}</td>
                  <td className="py-4 px-6 max-w-xs truncate">{n.description}</td>
                  <td className="py-4 px-6">{new Date(n.created_at).toLocaleDateString()}</td>
                  <td className="py-4 px-6 text-right space-x-2 whitespace-nowrap">
                    <button onClick={() => handleOpenModal(n)} className="btn-outline px-3 py-1 text-xs">Редактировать</button>
                    <button onClick={() => handleDelete(n.id)} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1 rounded text-xs font-medium">Удалить</button>
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
            <h3 className="text-2xl font-serif text-beige-800 mb-6">{editingNews ? 'Редактировать новость' : 'Создать новость'}</h3>
            
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Заголовок</label>
                <input required type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="input-classic w-full" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-beige-800 uppercase mb-2">Фотография (Баннер)</label>
                <div className="flex gap-4 items-center">
                  {form.imageUrl && <img src={form.imageUrl} className="w-20 h-12 rounded object-cover" />}
                  <input type="file" accept="image/*" onChange={uploadFile} className="text-xs" />
                </div>
                {uploadStatus && <p className="text-xs font-bold text-blue-600 mt-1">{uploadStatus}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Описание / Текст</label>
                <textarea rows={4} value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input-classic w-full" />
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
