import React, { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import {
  Upload,
  Image as ImageIcon,
  Smartphone,
  Trash2,
  Plus,
  Edit2,
  Globe,
  CheckCircle2,
  Clock,
  ArrowUpDown,
  X,
  AlertCircle,
  RefreshCw
} from 'lucide-react';

type LanguageKey = 'ru' | 'kz' | 'en';

interface LocalizedStoryData {
  title: string;
  description: string;
  coverUrl: string;
  contentUrl: string;
}

const LANGUAGES: { key: LanguageKey; label: string; flag: string; placeholderTitle: string; placeholderDesc: string }[] = [
  {
    key: 'ru',
    label: 'Русский',
    flag: '🇷🇺',
    placeholderTitle: 'СЧАСТЛИВЫЕ ЧАСЫ',
    placeholderDesc: 'После 21:00 — 3 булочки по цене 2-х!'
  },
  {
    key: 'kz',
    label: 'Қазақша',
    flag: '🇰🇿',
    placeholderTitle: 'БАҚЫТТЫ САҒАТТАР',
    placeholderDesc: 'Сағат 21:00-ден кейін — 2 бөлке бағасына 3 бөлке!'
  },
  {
    key: 'en',
    label: 'English',
    flag: '🇬🇧',
    placeholderTitle: 'HAPPY HOURS',
    placeholderDesc: 'After 21:00 — get 3 pastries for the price of 2!'
  }
];

export default function StoriesPage() {
  const [stories, setStories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStory, setEditingStory] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<LanguageKey>('ru');

  const [form, setForm] = useState({
    groupId: '',
    duration: 15,
    sortOrder: 0
  });

  const [i18nData, setI18nData] = useState<Record<LanguageKey, LocalizedStoryData>>({
    ru: { title: '', description: '', coverUrl: '', contentUrl: '' },
    kz: { title: '', description: '', coverUrl: '', contentUrl: '' },
    en: { title: '', description: '', coverUrl: '', contentUrl: '' }
  });

  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const contentInputRef = useRef<HTMLInputElement | null>(null);

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
    setActiveTab('ru');
    setUploadError(null);
    if (story) {
      setEditingStory(story);
      const defaultRu = {
        title: story.title || '',
        description: story.description || '',
        coverUrl: story.coverUrl || story.groupCoverUrl || '',
        contentUrl: story.contentUrl || ''
      };

      const storyI18n = story.i18n || {
        ru: defaultRu,
        kz: { title: '', description: '', coverUrl: '', contentUrl: '' },
        en: { title: '', description: '', coverUrl: '', contentUrl: '' }
      };

      setI18nData({
        ru: { ...defaultRu, ...storyI18n.ru },
        kz: {
          title: storyI18n.kz?.title || '',
          description: storyI18n.kz?.description || '',
          coverUrl: storyI18n.kz?.coverUrl || '',
          contentUrl: storyI18n.kz?.contentUrl || ''
        },
        en: {
          title: storyI18n.en?.title || '',
          description: storyI18n.en?.description || '',
          coverUrl: storyI18n.en?.coverUrl || '',
          contentUrl: storyI18n.en?.contentUrl || ''
        }
      });

      setForm({
        groupId: story.groupId || '',
        duration: story.duration || 15,
        sortOrder: story.sortOrder || 0
      });
    } else {
      setEditingStory(null);
      setI18nData({
        ru: { title: '', description: '', coverUrl: '', contentUrl: '' },
        kz: { title: '', description: '', coverUrl: '', contentUrl: '' },
        en: { title: '', description: '', coverUrl: '', contentUrl: '' }
      });
      setForm({
        groupId: '',
        duration: 15,
        sortOrder: 0
      });
    }
    setModalOpen(true);
  };

  const updateI18nField = (lang: LanguageKey, field: keyof LocalizedStoryData, value: string) => {
    setI18nData(prev => ({
      ...prev,
      [lang]: {
        ...prev[lang],
        [field]: value
      }
    }));
  };

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>, field: 'coverUrl' | 'contentUrl') => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    
    setUploadingField(`${activeTab}_${field}`);
    setUploadError(null);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target?.result as string;
      try {
        const res = await api.uploadPhoto(base64, file.name);
        if (res.success && res.url) {
          updateI18nField(activeTab, field, res.url);
        } else {
          setUploadError('Не удалось загрузить файл в хранилище');
        }
      } catch (err: any) {
        setUploadError('Ошибка загрузки: ' + (err.message || 'Сбой сети'));
      } finally {
        setUploadingField(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!i18nData.ru.title || !i18nData.ru.coverUrl) {
      alert('Заполните заголовок и загрузите горизонтальную обложку для русского языка (RU) — это основной язык акции!');
      setActiveTab('ru');
      return;
    }

    const payload = {
      title: i18nData.ru.title,
      groupTitle: i18nData.ru.title,
      description: i18nData.ru.description,
      coverUrl: i18nData.ru.coverUrl,
      contentUrl: i18nData.ru.contentUrl || i18nData.ru.coverUrl,
      groupId: form.groupId || i18nData.ru.title.trim().toLowerCase().replace(/\s+/g, '-'),
      duration: form.duration,
      sortOrder: form.sortOrder,
      i18n: i18nData
    };

    try {
      if (editingStory) {
        await api.updateStory({ ...payload, id: editingStory.id });
      } else {
        await api.addStory(payload);
      }
      setModalOpen(false);
      fetchStories();
    } catch (err: any) {
      alert('Ошибка при сохранении: ' + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Удалить эту акцию?')) return;
    try {
      await api.deleteStory(id);
      fetchStories();
    } catch (err: any) {
      alert('Ошибка: ' + err.message);
    }
  };

  const currentLang = i18nData[activeTab];
  const ruLang = i18nData.ru;

  const effectiveCover = currentLang.coverUrl || (activeTab !== 'ru' ? ruLang.coverUrl : '');
  const effectiveContent = currentLang.contentUrl || (activeTab !== 'ru' ? ruLang.contentUrl : '');

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold text-[#6d3317]">Слайдер акций и истории</h2>
          <p className="text-sm text-gray-600 mt-1">
            Управляйте рекламными баннерами на главном экране с поддержкой 3 языков (Русский, Қазақша, English)
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="btn-classic px-5 py-3 font-medium shadow-md flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
        >
          <Plus size={18} />
          <span>Создать баннер акции</span>
        </button>
      </div>

      <div className="card overflow-hidden border border-amber-900/10 shadow-lg">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[#fcf8f2] border-b border-amber-900/10">
            <tr>
              <th className="py-4 px-6 text-xs uppercase tracking-wider font-semibold text-[#6d3317]">Иллюстрация</th>
              <th className="py-4 px-6 text-xs uppercase tracking-wider font-semibold text-[#6d3317]">Название и описание акции</th>
              <th className="py-4 px-6 text-xs uppercase tracking-wider font-semibold text-[#6d3317]">Языки</th>
              <th className="py-4 px-6 text-xs uppercase tracking-wider font-semibold text-[#6d3317] text-center">Порядок</th>
              <th className="py-4 px-6 text-xs uppercase tracking-wider font-semibold text-[#6d3317] text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-900/5 text-sm text-gray-700">
            {loading ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-400">
                  <RefreshCw className="animate-spin mx-auto mb-2 text-[#6d3317]" size={24} />
                  Загрузка акций...
                </td>
              </tr>
            ) : stories.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-500">
                  <ImageIcon className="mx-auto mb-2 text-gray-300" size={32} />
                  <p className="font-medium">Акции пока не добавлены</p>
                  <p className="text-xs text-gray-400 mt-1">В мобильном приложении сейчас отображаются акции по умолчанию</p>
                </td>
              </tr>
            ) : (
              stories.map(s => {
                const sI18n = s.i18n || {};
                const hasKz = Boolean(sI18n.kz?.title || sI18n.kz?.coverUrl);
                const hasEn = Boolean(sI18n.en?.title || sI18n.en?.coverUrl);

                return (
                  <tr key={s.id} className="hover:bg-[#fefcf8] transition-colors">
                    <td className="py-4 px-6">
                      <div className="w-20 h-11 rounded-lg overflow-hidden border border-amber-900/10 shadow-sm bg-gray-100">
                        <img
                          src={s.groupCoverUrl || s.coverUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="font-semibold text-[#6d3317] text-base">
                        {s.groupTitle || s.title}
                      </div>
                      <div className="text-gray-500 text-xs line-clamp-1 mt-0.5">
                        {s.description || '—'}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-[#6d3317]">
                          🇷🇺 RU
                        </span>
                        {hasKz && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-800">
                            🇰🇿 KZ
                          </span>
                        )}
                        {hasEn && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-800">
                            🇬🇧 EN
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center font-semibold text-[#6d3317]">
                      {s.sortOrder || 0}
                    </td>
                    <td className="py-4 px-6 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenModal(s)}
                          className="px-3 py-1.5 rounded-lg border border-amber-900/20 text-[#6d3317] hover:bg-amber-50 text-xs font-medium flex items-center gap-1.5 transition-colors"
                        >
                          <Edit2 size={13} />
                          Редактировать
                        </button>
                        <button
                          onClick={() => handleDelete(s.id)}
                          className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-xs font-medium flex items-center gap-1.5 transition-colors"
                        >
                          <Trash2 size={13} />
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl border border-amber-900/10 overflow-hidden my-8">
            {/* Header */}
            <div className="px-8 pt-7 pb-5 bg-[#fcf8f2] border-b border-amber-900/10 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-serif font-bold text-[#6d3317]">
                  {editingStory ? 'Редактировать акцию' : 'Создать баннер акции'}
                </h3>
                <p className="text-xs text-gray-600 mt-1">
                  Заполните информацию на нужных языках. Если для KZ или EN фото не указано, автоматически используется фото из RU.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="w-10 h-10 rounded-full bg-white border border-amber-900/10 flex items-center justify-center text-gray-500 hover:text-[#6d3317] hover:bg-amber-50 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Language Tabs */}
            <div className="px-8 pt-5 bg-white border-b border-gray-100">
              <div className="flex gap-2">
                {LANGUAGES.map(lang => {
                  const isSelected = activeTab === lang.key;
                  const hasData = Boolean(i18nData[lang.key].title || i18nData[lang.key].coverUrl);

                  return (
                    <button
                      key={lang.key}
                      type="button"
                      onClick={() => setActiveTab(lang.key)}
                      className={`px-4 py-2.5 rounded-t-xl font-medium text-sm flex items-center gap-2 border-b-2 transition-all ${
                        isSelected
                          ? 'border-[#6d3317] text-[#6d3317] bg-[#fcf8f2] font-semibold'
                          : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                      }`}
                    >
                      <span className="text-base">{lang.flag}</span>
                      <span>{lang.label}</span>
                      {hasData && (
                        <CheckCircle2 size={14} className="text-emerald-600 ml-1" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="p-8 space-y-6">
              {uploadError && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* Title & Description for active tab */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-[#6d3317] uppercase tracking-wider mb-1.5">
                    Заголовок акции ({activeTab.toUpperCase()})
                    {activeTab === 'ru' && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <input
                    type="text"
                    required={activeTab === 'ru'}
                    placeholder={LANGUAGES.find(l => l.key === activeTab)?.placeholderTitle}
                    value={currentLang.title}
                    onChange={e => updateI18nField(activeTab, 'title', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#6d3317] focus:ring-2 focus:ring-[#6d3317]/20 outline-none text-gray-900 transition-all text-sm font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#6d3317] uppercase tracking-wider mb-1.5">
                    Описание акции ({activeTab.toUpperCase()})
                  </label>
                  <input
                    type="text"
                    placeholder={LANGUAGES.find(l => l.key === activeTab)?.placeholderDesc}
                    value={currentLang.description}
                    onChange={e => updateI18nField(activeTab, 'description', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#6d3317] focus:ring-2 focus:ring-[#6d3317]/20 outline-none text-gray-900 transition-all text-sm"
                  />
                </div>
              </div>

              {/* Upload sections */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                {/* Horizontal Banner Cover */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-[#6d3317] uppercase tracking-wider flex items-center gap-1.5">
                      <ImageIcon size={14} />
                      Горизонтальный баннер (1080×480 px)
                    </label>
                    {activeTab === 'ru' && <span className="text-xs font-medium text-amber-800">Обязательно</span>}
                  </div>

                  <input
                    type="file"
                    accept="image/*"
                    ref={coverInputRef}
                    onChange={e => uploadFile(e, 'coverUrl')}
                    className="hidden"
                  />

                  <div
                    onClick={() => coverInputRef.current?.click()}
                    className={`relative group h-44 rounded-2xl border-2 border-dashed overflow-hidden flex flex-col items-center justify-center cursor-pointer transition-all ${
                      effectiveCover
                        ? 'border-transparent bg-gray-900'
                        : 'border-[#b88c5a]/40 hover:border-[#6d3317] bg-[#fcf8f2]'
                    }`}
                  >
                    {uploadingField === `${activeTab}_coverUrl` ? (
                      <div className="flex flex-col items-center gap-2 text-[#6d3317] p-4 text-center">
                        <RefreshCw className="animate-spin" size={24} />
                        <span className="text-xs font-medium">Загрузка изображения...</span>
                      </div>
                    ) : effectiveCover ? (
                      <>
                        <img
                          src={effectiveCover}
                          alt="Cover preview"
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white p-4 text-center">
                          <Upload size={22} className="mb-1" />
                          <span className="text-xs font-semibold">Нажмите, чтобы заменить</span>
                        </div>
                        {activeTab !== 'ru' && !currentLang.coverUrl && (
                          <div className="absolute bottom-2 left-2 right-2 bg-black/70 backdrop-blur-md text-white text-[11px] px-2.5 py-1 rounded-lg text-center">
                            Показывается фото из RU. Нажмите, чтобы загрузить своё для {activeTab.toUpperCase()}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-gray-500 p-4 text-center">
                        <div className="w-10 h-10 rounded-full bg-amber-100/70 text-[#6d3317] flex items-center justify-center">
                          <Upload size={20} />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[#6d3317]">Нажмите для выбора фото</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">Формат 16:9 для главного экрана</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {currentLang.coverUrl && activeTab !== 'ru' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateI18nField(activeTab, 'coverUrl', '');
                      }}
                      className="text-xs text-red-600 hover:text-red-700 font-medium mt-1.5 flex items-center gap-1"
                    >
                      <Trash2 size={13} />
                      Сбросить фото для {activeTab.toUpperCase()} (вернуть RU)
                    </button>
                  )}
                </div>

                {/* Vertical Fullscreen Story Content */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-[#6d3317] uppercase tracking-wider flex items-center gap-1.5">
                      <Smartphone size={14} />
                      Вертикальная история (1080×1920 px)
                    </label>
                    <span className="text-xs text-gray-400">Опционально</span>
                  </div>

                  <input
                    type="file"
                    accept="image/*"
                    ref={contentInputRef}
                    onChange={e => uploadFile(e, 'contentUrl')}
                    className="hidden"
                  />

                  <div
                    onClick={() => contentInputRef.current?.click()}
                    className={`relative group h-44 rounded-2xl border-2 border-dashed overflow-hidden flex flex-col items-center justify-center cursor-pointer transition-all ${
                      effectiveContent
                        ? 'border-transparent bg-gray-900'
                        : 'border-[#b88c5a]/40 hover:border-[#6d3317] bg-[#fcf8f2]'
                    }`}
                  >
                    {uploadingField === `${activeTab}_contentUrl` ? (
                      <div className="flex flex-col items-center gap-2 text-[#6d3317] p-4 text-center">
                        <RefreshCw className="animate-spin" size={24} />
                        <span className="text-xs font-medium">Загрузка истории...</span>
                      </div>
                    ) : effectiveContent ? (
                      <>
                        <img
                          src={effectiveContent}
                          alt="Story preview"
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white p-4 text-center">
                          <Upload size={22} className="mb-1" />
                          <span className="text-xs font-semibold">Нажмите, чтобы заменить</span>
                        </div>
                        {activeTab !== 'ru' && !currentLang.contentUrl && (
                          <div className="absolute bottom-2 left-2 right-2 bg-black/70 backdrop-blur-md text-white text-[11px] px-2.5 py-1 rounded-lg text-center">
                            Показывается история из RU. Нажмите для своего фото
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-gray-500 p-4 text-center">
                        <div className="w-10 h-10 rounded-full bg-amber-100/70 text-[#6d3317] flex items-center justify-center">
                          <Smartphone size={20} />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[#6d3317]">Загрузить вертикальное фото</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">Если не выбрано, откроется горизонтальная обложка</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {currentLang.contentUrl && activeTab !== 'ru' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateI18nField(activeTab, 'contentUrl', '');
                      }}
                      className="text-xs text-red-600 hover:text-red-700 font-medium mt-1.5 flex items-center gap-1"
                    >
                      <Trash2 size={13} />
                      Сбросить вертикальное фото для {activeTab.toUpperCase()}
                    </button>
                  )}
                </div>
              </div>

              {/* Display settings */}
              <div className="pt-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-[#6d3317] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Clock size={14} />
                    Длительность показа (секунды)
                  </label>
                  <input
                    type="number"
                    min={3}
                    max={120}
                    value={form.duration}
                    onChange={e => setForm({ ...form, duration: Number(e.target.value) })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-[#6d3317] focus:ring-2 focus:ring-[#6d3317]/20 outline-none text-gray-900 font-medium text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#6d3317] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <ArrowUpDown size={14} />
                    Порядок на главном экране (0 — первый)
                  </label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-[#6d3317] focus:ring-2 focus:ring-[#6d3317]/20 outline-none text-gray-900 font-medium text-sm"
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-3">
                <button
                  type="submit"
                  className="btn-classic flex-1 py-3.5 font-semibold text-base shadow-lg hover:shadow-xl transition-all"
                >
                  {editingStory ? 'Сохранить изменения' : 'Создать баннер акции'}
                </button>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-6 py-3.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
