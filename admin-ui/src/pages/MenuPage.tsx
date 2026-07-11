import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Eye,
  EyeOff,
  Image as ImageIcon,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  UtensilsCrossed,
} from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface IikoProduct {
  id: string;
  name: string;
  description?: string;
  price?: number;
  parentGroup?: string;
}

interface IikoGroup {
  id: string;
  name: string;
  order?: number;
}

interface ProductOverride {
  iiko_product_id: string;
  custom_name?: string;
  custom_price?: number;
  custom_image_url?: string;
  custom_description?: string;
  is_hidden?: boolean;
  is_stop_listed?: boolean;
}

interface CategoryOverride {
  iiko_category_id: string;
  custom_name?: string;
  custom_image_url?: string;
  is_hidden?: boolean;
}

interface CustomProduct {
  id?: string;
  name: string;
  description?: string;
  price: number;
  category_name: string;
  image_url?: string;
  is_available?: boolean;
  sort_order?: number;
}

export default function MenuPage() {
  const { t } = useI18n();
  const { toast, confirm } = useFeedback();

  const [activeTab, setActiveTab] = useState<'products' | 'categories' | 'custom'>('products');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [rawProducts, setRawProducts] = useState<IikoProduct[]>([]);
  const [rawGroups, setRawGroups] = useState<IikoGroup[]>([]);
  const [productOverrides, setProductOverrides] = useState<Record<string, ProductOverride>>({});
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, CategoryOverride>>({});
  const [customProducts, setCustomProducts] = useState<CustomProduct[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  // Модалка редактирования товара iiko
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<IikoProduct | null>(null);
  const [editForm, setEditForm] = useState({ name: '', price: 0, description: '', imageUrl: '' });
  const [editSaving, setEditSaving] = useState(false);

  // Модалка для кастомного блюда
  const [modalOpen, setModalOpen] = useState(false);
  const [customForm, setCustomForm] = useState<CustomProduct>({
    name: '',
    description: '',
    price: 0,
    category_name: 'Фирменное',
    image_url: '',
    is_available: true,
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchMenu = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getAdminMenu();
      const raw = data.rawMenu || {};
      setRawProducts(raw.products || []);
      setRawGroups(raw.groups || []);

      const pMap: Record<string, ProductOverride> = {};
      (data.overrides?.products || []).forEach((o: ProductOverride) => {
        pMap[o.iiko_product_id] = o;
      });
      setProductOverrides(pMap);

      const cMap: Record<string, CategoryOverride> = {};
      (data.overrides?.categories || []).forEach((o: CategoryOverride) => {
        cMap[o.iiko_category_id] = o;
      });
      setCategoryOverrides(cMap);

      setCustomProducts(data.overrides?.customProducts || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchMenu();
  }, [fetchMenu]);

  // Загрузка фото для блюда iiko
  const handleUploadPhoto = async (productId: string, file: File) => {
    setUploadingId(productId);
    try {
      const res = await api.uploadMenuPhoto(file);
      if (res.success && res.imageUrl) {
        const cur = productOverrides[productId] || { iiko_product_id: productId };
        const updated = { ...cur, custom_image_url: res.imageUrl };
        await api.setProductOverride(productId, updated);
        setProductOverrides(prev => ({ ...prev, [productId]: updated }));
        toast('Фотография блюда загружена и сохранена', 'success');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки фото', 'error');
    } finally {
      setUploadingId(null);
    }
  };

  // Переключение видимости товара
  const handleToggleProductHidden = async (productId: string, curHidden?: boolean) => {
    const cur = productOverrides[productId] || { iiko_product_id: productId };
    const updated = { ...cur, is_hidden: !curHidden };
    try {
      await api.setProductOverride(productId, updated);
      setProductOverrides(prev => ({ ...prev, [productId]: updated }));
      toast(updated.is_hidden ? 'Блюдо скрыто из приложения' : 'Блюдо снова отображается', 'info');
    } catch (err) {
      toast('Ошибка сохранения настроек', 'error');
    }
  };

  // Переключение стоп-листа вручную
  const handleToggleStopList = async (productId: string, curStop?: boolean) => {
    const cur = productOverrides[productId] || { iiko_product_id: productId };
    const updated = { ...cur, is_stop_listed: !curStop };
    try {
      await api.setProductOverride(productId, updated);
      setProductOverrides(prev => ({ ...prev, [productId]: updated }));
      toast(updated.is_stop_listed ? 'Добавлено в стоп-лист' : 'Убрано из стоп-листа', 'info');
    } catch (err) {
      toast('Ошибка сохранения настроек', 'error');
    }
  };

  // Переключение видимости категории
  const handleToggleCategoryHidden = async (categoryId: string, curHidden?: boolean) => {
    const cur = categoryOverrides[categoryId] || { iiko_category_id: categoryId };
    const updated = { ...cur, is_hidden: !curHidden };
    try {
      await api.setCategoryOverride(categoryId, updated);
      setCategoryOverrides(prev => ({ ...prev, [categoryId]: updated }));
      toast(updated.is_hidden ? 'Категория скрыта' : 'Категория включена', 'info');
    } catch (err) {
      toast('Ошибка сохранения настроек', 'error');
    }
  };

  // Сохранение кастомного блюда
  const handleSaveCustom = async (e: FormEvent) => {
    e.preventDefault();
    if (!customForm.name || !customForm.price) return;
    setSubmitting(true);
    try {
      await api.upsertCustomProduct(customForm);
      toast('Блюдо успешно сохранено', 'success');
      setModalOpen(false);
      void fetchMenu();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка сохранения', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Открытие модалки редактирования товара iiko
  const openEditModal = (product: IikoProduct) => {
    const override = productOverrides[product.id];
    setEditingProduct(product);
    setEditForm({
      name: (override?.custom_name) || product.name || '',
      price: (override?.custom_price) || product.price || 0,
      description: (override?.custom_description) || product.description || '',
      imageUrl: (override?.custom_image_url) || '',
    });
    setEditModalOpen(true);
  };

  // Сохранение изменений товара iiko
  const handleSaveProductEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setEditSaving(true);
    try {
      const cur = productOverrides[editingProduct.id] || { iiko_product_id: editingProduct.id };
      const updated: ProductOverride = {
        ...cur,
        custom_name: editForm.name !== editingProduct.name ? editForm.name : undefined,
        custom_price: editForm.price !== (editingProduct.price || 0) ? editForm.price : undefined,
        custom_description: editForm.description !== (editingProduct.description || '') ? editForm.description : undefined,
        custom_image_url: editForm.imageUrl || cur.custom_image_url || undefined,
      };
      await api.setProductOverride(editingProduct.id, updated);
      setProductOverrides(prev => ({ ...prev, [editingProduct.id]: updated }));
      toast('Изменения сохранены', 'success');
      setEditModalOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка сохранения', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  // Удаление кастомного блюда
  const handleDeleteCustom = async (id: string) => {
    if (!await confirm({ title: 'Удалить блюдо?', body: 'Это блюдо исчезнет из мобильного приложения.', destructive: true })) return;
    try {
      await api.deleteCustomProduct(id);
      toast('Блюдо удалено', 'success');
      setCustomProducts(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      toast('Ошибка удаления', 'error');
    }
  };

  const filteredProducts = rawProducts.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = selectedCategory === 'all' || p.parentGroup === selectedCategory;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
            <UtensilsCrossed className="text-amber-500" size={26} />
            {t('page.menu.title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('page.menu.subtitle')}
          </p>
        </div>

        {/* Табы */}
        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('products')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'products'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
            }`}
          >
            Блюда iiko ({rawProducts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('categories')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'categories'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
            }`}
          >
            Категории ({rawGroups.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('custom')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'custom'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
            }`}
          >
            Свои блюда ({customProducts.length})
          </button>
        </div>
      </header>

      {loading ? (
        <PageState type="loading" />
      ) : error ? (
        <PageState type="error" description={error} onRetry={fetchMenu} />
      ) : activeTab === 'products' ? (
        <div className="space-y-4">
          {/* Фильтры */}
          <div className="flex flex-col sm:flex-row gap-4 bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700/60 shadow-sm">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Поиск блюда по названию..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              />
            </div>
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="px-4 py-2 bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="all">Все категории ({rawProducts.length})</option>
              {rawGroups.map(g => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Список товаров */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.map(p => {
              const override = productOverrides[p.id];
              const isHidden = Boolean(override?.is_hidden);
              const isStop = Boolean(override?.is_stop_listed);
              const imgUrl = override?.custom_image_url;

              return (
                <div
                  key={p.id}
                  className={`bg-white dark:bg-gray-800 rounded-2xl p-4 border transition flex flex-col justify-between ${
                    isHidden
                      ? 'opacity-60 border-dashed border-gray-300 dark:border-gray-700'
                      : 'border-gray-100 dark:border-gray-700/60 shadow-sm hover:shadow-md'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-gray-700 overflow-hidden flex items-center justify-center shrink-0 border border-gray-200/50">
                          {imgUrl ? (
                            <img src={imgUrl} alt={p.name} className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon className="text-gray-400" size={24} />
                          )}
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 dark:text-white text-sm line-clamp-1">
                            {p.name}
                          </h3>
                          <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                            {(p.price ?? 0) > 0 ? `${p.price} ₸` : 'Цена по размеру'}
                          </p>
                        </div>
                      </div>

                      {/* Загрузить фото кнопка */}
                      <label className="cursor-pointer shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-xl text-xs font-medium hover:bg-amber-100 transition">
                        {uploadingId === p.id ? (
                          <LoaderCircle className="spin" size={14} />
                        ) : (
                          <Upload size={14} />
                        )}
                        <span>{imgUrl ? 'Сменить фото' : 'Фото'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) void handleUploadPhoto(p.id, file);
                          }}
                        />
                      </label>

                      {/* Кнопка редактирования */}
                      <button
                        type="button"
                        onClick={() => openEditModal(p)}
                        className="shrink-0 p-1.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 rounded-lg hover:bg-gray-200 transition"
                        title="Редактировать"
                      >
                        <Pencil size={14} />
                      </button>
                    </div>

                    {p.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 line-clamp-2">
                        {p.description}
                      </p>
                    )}
                  </div>

                  {/* Действия (Переключатели) */}
                  <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50 flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={() => handleToggleProductHidden(p.id, isHidden)}
                      className={`inline-flex items-center gap-1.5 font-medium ${
                        isHidden ? 'text-gray-400' : 'text-green-600 dark:text-green-400'
                      }`}
                    >
                      {isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
                      <span>{isHidden ? 'Скрыт в приложении' : 'Виден клиентам'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleStopList(p.id, isStop)}
                      className={`px-2.5 py-1 rounded-lg font-medium transition ${
                        isStop
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {isStop ? 'В стоп-листе' : 'В продаже'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : activeTab === 'categories' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rawGroups.map(g => {
            const override = categoryOverrides[g.id];
            const isHidden = Boolean(override?.is_hidden);
            const count = rawProducts.filter(p => p.parentGroup === g.id).length;

            return (
              <div
                key={g.id}
                className={`bg-white dark:bg-gray-800 rounded-2xl p-4 border flex items-center justify-between ${
                  isHidden
                    ? 'opacity-60 border-dashed border-gray-300 dark:border-gray-700'
                    : 'border-gray-100 dark:border-gray-700/60 shadow-sm'
                }`}
              >
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white text-base">
                    {override?.custom_name || g.name}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">Товаров в категории: {count}</p>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggleCategoryHidden(g.id, isHidden)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition ${
                    isHidden
                      ? 'bg-gray-100 text-gray-500 dark:bg-gray-700'
                      : 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  }`}
                >
                  {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  <span>{isHidden ? 'Категория скрыта' : 'Включена'}</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        /* Вкладка: Свои блюда (кастомные) */
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setCustomForm({
                  name: '',
                  description: '',
                  price: 0,
                  category_name: 'Фирменное',
                  image_url: '',
                  is_available: true,
                });
                setModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium text-sm rounded-xl transition shadow-sm"
            >
              <Plus size={18} />
              <span>Добавить своё блюдо</span>
            </button>
          </div>

          {customProducts.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-12 text-center border border-gray-100 dark:border-gray-700/60">
              <UtensilsCrossed className="mx-auto text-gray-300 mb-3" size={40} />
              <p className="text-gray-500 text-sm">Вы ещё не добавили свои блюда вручную</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {customProducts.map(cp => (
                <div
                  key={cp.id}
                  className="bg-white dark:bg-gray-800 rounded-2xl p-4 border border-gray-100 dark:border-gray-700/60 shadow-sm flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-gray-700 overflow-hidden flex items-center justify-center shrink-0">
                          {cp.image_url ? (
                            <img src={cp.image_url} alt={cp.name} className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon className="text-gray-400" size={24} />
                          )}
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                            {cp.name}
                          </h3>
                          <p className="text-xs text-amber-600 font-medium mt-0.5">{cp.price} ₸</p>
                          <span className="inline-block mt-1 text-[10px] bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-md text-gray-600 dark:text-gray-300">
                            {cp.category_name}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => cp.id && handleDeleteCustom(cp.id)}
                        className="p-2 text-gray-400 hover:text-red-500 transition"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    {cp.description && (
                      <p className="text-xs text-gray-500 mt-3">{cp.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Модальное окно РЕДАКТИРОВАНИЯ товара iiko */}
      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={`Редактировать: ${editingProduct?.name || ''}`}
      >
        <form onSubmit={handleSaveProductEdit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Название (видно клиентам)
            </label>
            <input
              type="text"
              value={editForm.name}
              onChange={e => setEditForm({ ...editForm, name: e.target.value })}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded-xl border text-sm"
              placeholder="Оставьте как в iiko или введите своё"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Цена (₸)
              </label>
              <input
                type="number"
                value={editForm.price || ''}
                onChange={e => setEditForm({ ...editForm, price: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded-xl border text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Фото (URL)
              </label>
              <input
                type="url"
                value={editForm.imageUrl}
                onChange={e => setEditForm({ ...editForm, imageUrl: e.target.value })}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded-xl border text-sm"
                placeholder="https://..."
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Описание
            </label>
            <textarea
              rows={3}
              value={editForm.description}
              onChange={e => setEditForm({ ...editForm, description: e.target.value })}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded-xl border text-sm"
              placeholder="Описание блюда для клиентов"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditModalOpen(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={editSaving}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition"
            >
              {editSaving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Модальное окно добавления кастомного блюда */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Добавить своё блюдо"
      >
        <form onSubmit={handleSaveCustom} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Название блюда *
            </label>
            <input
              type="text"
              required
              value={customForm.name}
              onChange={e => setCustomForm({ ...customForm, name: e.target.value })}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded-xl border text-sm"
              placeholder="Например: Спец-комбо Bulka"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Цена (₸) *
              </label>
              <input
                type="number"
                required
                value={customForm.price || ''}
                onChange={e => setCustomForm({ ...customForm, price: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded-xl border text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Категория
              </label>
              <input
                type="text"
                value={customForm.category_name}
                onChange={e => setCustomForm({ ...customForm, category_name: e.target.value })}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded-xl border text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Ссылка на фото (URL)
            </label>
            <input
              type="url"
              value={customForm.image_url}
              onChange={e => setCustomForm({ ...customForm, image_url: e.target.value })}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded-xl border text-sm"
              placeholder="https://..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Описание
            </label>
            <textarea
              rows={3}
              value={customForm.description}
              onChange={e => setCustomForm({ ...customForm, description: e.target.value })}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded-xl border text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition"
            >
              Сохранить
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
