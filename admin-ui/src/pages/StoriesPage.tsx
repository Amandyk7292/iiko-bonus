import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function StoriesPage() {
  const [stories, setStories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStory, setEditingStory] = useState<any | null>(null);

  const [form, setForm] = useState({
    title: '',
    groupTitle: '',
    groupId: '',
    coverUrl: '',
    contentUrl: '',
    description: '',
    duration: 15,
    sortOrder: 0
  });
  const [uploadStatus, setUploadStatus] = useState<string>('');

  const fetchStories = async () => {
    setLoading(true);
    try {
      const data = await api.getStories();
      setStories(data.stories || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStories();
  }, []);

  const handleOpenModal = (story?: any) => {
    if (story) {
      setEditingStory(story);
      setForm({
        title: story.title || '',
        groupTitle: story.groupTitle || story.title || '',
        groupId: story.groupId || '',
        coverUrl: story.coverUrl || story.groupCoverUrl || '',
        contentUrl: story.contentUrl || '',
        description: story.description || '',
        duration: story.duration || 15,
        sortOrder: story.sortOrder || 0
      });
    } else {
      setEditingStory(null);
      setForm({
        title: '', groupTitle: '', groupId: '', coverUrl: '', contentUrl: '', description: '', duration: 15, sortOrder: 0
      });
    }
    setModalOpen(true);
  };

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>, field: 'coverUrl' | 'contentUrl') => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    
    setUploadStatus('Загрузка в Supabase...');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target?.result as string;
      try {
        const res = await api.uploadPhoto(base64, file.name);
        if (res.success) {
          setForm(prev => ({ ...prev, [field]: res.url }));
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
    if (!form.title || !form.coverUrl) {
      alert('Укажите заголовок и фото обложки!');
      return;
    }
    try {
      if (editingStory) {
        await api.updateStory({ ...form, id: editingStory.id });
      } else {
        await api.addStory(form);
      }
      setModalOpen(false);
      fetchStories();
    } catch (err: any) {
      alert('Ошибка при сохранении: ' + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Удалить Сториз?')) return;
    try {
      await api.deleteStory(id);
      fetchStories();
    } catch (err: any) {
      alert('Ошибка: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end mb-4">
        <button onClick={() => handleOpenModal()} className="btn-classic px-5 py-2.5 font-medium shadow-sm flex items-center gap-2">
          <span>+ Создать Сториз</span>
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-beige-50">
            <tr>
              <th className="py-4 px-6">Обложка</th>
              <th className="py-4 px-6">Тема</th>
              <th className="py-4 px-6">Заголовок</th>
              <th className="py-4 px-6 text-center">Время (сек)</th>
              <th className="py-4 px-6 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-700">
            {loading ? (
              <tr><td colSpan={5} className="py-8 text-center text-gray-400">Загрузка...</td></tr>
            ) : stories.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-gray-400">Сториз пока нет</td></tr>
            ) : (
              stories.map(s => (
                <tr key={s.id}>
                  <td className="py-4 px-6">
                    <img src={s.groupCoverUrl || s.coverUrl} className="w-12 h-12 object-cover rounded-md border border-gray-200" />
                  </td>
                  <td className="py-4 px-6 font-medium text-gray-900">{s.groupTitle || s.title}</td>
                  <td className="py-4 px-6">{s.title}</td>
                  <td className="py-4 px-6 text-center">{s.duration || 15}</td>
                  <td className="py-4 px-6 text-right space-x-2 whitespace-nowrap">
                    <button onClick={() => handleOpenModal(s)} className="btn-outline px-3 py-1 text-xs">Редактировать</button>
                    <button onClick={() => handleDelete(s.id)} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1 rounded text-xs font-medium">Удалить</button>
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
            <h3 className="text-2xl font-serif text-beige-800 mb-6">{editingStory ? 'Редактировать Сториз' : 'Создать Сториз'}</h3>
            
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Заголовок</label>
                <input required type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="input-classic w-full" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Тема</label>
                  <input type="text" value={form.groupTitle} onChange={e => setForm({...form, groupTitle: e.target.value})} className="input-classic w-full" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">ID темы</label>
                  <input type="text" value={form.groupId} onChange={e => setForm({...form, groupId: e.target.value})} className="input-classic w-full" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-beige-800 uppercase mb-2">Обложка</label>
                <div className="flex gap-4 items-center">
                  {form.coverUrl && <img src={form.coverUrl} className="w-16 h-16 rounded object-cover" />}
                  <input type="file" accept="image/*" onChange={e => uploadFile(e, 'coverUrl')} className="text-xs" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-beige-800 uppercase mb-2">Контент (Фото)</label>
                <div className="flex gap-4 items-center">
                  {form.contentUrl && <img src={form.contentUrl} className="w-16 h-16 rounded object-cover" />}
                  <input type="file" accept="image/*" onChange={e => uploadFile(e, 'contentUrl')} className="text-xs" />
                </div>
              </div>
              
              {uploadStatus && <p className="text-xs font-bold text-blue-600">{uploadStatus}</p>}

              <div>
                <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Описание / Текст</label>
                <textarea rows={2} value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input-classic w-full" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Время (сек)</label>
                  <input type="number" value={form.duration} onChange={e => setForm({...form, duration: Number(e.target.value)})} className="input-classic w-full" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-beige-800 uppercase mb-1">Порядок</label>
                  <input type="number" value={form.sortOrder} onChange={e => setForm({...form, sortOrder: Number(e.target.value)})} className="input-classic w-full" />
                </div>
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
