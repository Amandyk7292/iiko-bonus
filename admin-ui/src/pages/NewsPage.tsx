import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Image as ImageIcon, LoaderCircle, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { contentLanguage, useI18n } from '../lib/i18n';

type ContentLanguage = 'ru' | 'kz' | 'en';
interface LocalizedNews {
  title: string;
  description: string;
  imageUrl: string;
}
interface NewsItem {
  id: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  imageurl?: string;
  created_at?: string;
  i18n?: Partial<Record<ContentLanguage, Partial<LocalizedNews>>>;
}
const languages: ContentLanguage[] = ['ru', 'kz', 'en'];
const localeKey = (language: ContentLanguage) => (language === 'kz' ? 'kk' : language);
const blankI18n = (): Record<ContentLanguage, LocalizedNews> => ({
  ru: { title: '', imageUrl: '', description: '' },
  kz: { title: '', imageUrl: '', description: '' },
  en: { title: '', imageUrl: '', description: '' },
});

export default function NewsPage() {
  const { locale, t, formatDate } = useI18n();
  const { toast, confirm } = useFeedback();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<NewsItem | null>(null);
  const [activeLanguage, setActiveLanguage] = useState<ContentLanguage>('ru');
  const [i18n, setI18n] = useState<Record<ContentLanguage, LocalizedNews>>(blankI18n);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getNews();
      setNews(data.news ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    void fetchNews();
  }, [fetchNews]);

  const openModal = (item?: NewsItem) => {
    setEditing(item ?? null);
    setActiveLanguage('ru');
    const data = item?.i18n ?? {};
    setI18n(
      item
        ? {
            ru: {
              title: data.ru?.title ?? item.title ?? '',
              imageUrl: data.ru?.imageUrl ?? item.imageUrl ?? item.imageurl ?? '',
              description: data.ru?.description ?? item.description ?? '',
            },
            kz: {
              title: data.kz?.title ?? '',
              imageUrl: data.kz?.imageUrl ?? '',
              description: data.kz?.description ?? '',
            },
            en: {
              title: data.en?.title ?? '',
              imageUrl: data.en?.imageUrl ?? '',
              description: data.en?.description ?? '',
            },
          }
        : blankI18n(),
    );
    setFormError('');
    setModalOpen(true);
  };

  const updateField = (language: ContentLanguage, field: keyof LocalizedNews, value: string) => {
    setI18n((current) => ({
      ...current,
      [language]: { ...current[language], [field]: value },
    }));
    setFormError('');
  };

  const uploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1_500_000) {
      setFormError(t('common.uploadError'));
      return;
    }
    setUploading(true);
    setFormError('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const result = await api.uploadPhoto(base64, file.name);
      if (!result.url) throw new Error(t('common.uploadError'));
      updateField(activeLanguage, 'imageUrl', result.url ?? '');
      toast(t('common.uploadSuccess'));
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t('common.uploadError'));
    } finally {
      setUploading(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!i18n.ru.title.trim() || !i18n.ru.imageUrl) {
      setActiveLanguage('ru');
      setFormError(t('news.validation'));
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const payload = {
        title: i18n.ru.title.trim(),
        imageUrl: i18n.ru.imageUrl,
        description: i18n.ru.description.trim(),
        i18n,
      };
      if (editing) await api.updateNews({ ...payload, id: editing.id });
      else await api.addNews(payload);
      setModalOpen(false);
      toast(t('news.saved'));
      await fetchNews();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (item: NewsItem) => {
    if (
      !(await confirm({
        title: t('news.deleteTitle'),
        body: t('news.deleteBody'),
        confirmLabel: t('common.delete'),
        destructive: true,
      }))
    )
      return;
    setBusyId(item.id);
    try {
      await api.deleteNews(item.id);
      setNews((current) => current.filter((newsItem) => newsItem.id !== item.id));
      toast(t('common.deleted'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && news.length === 0) return <PageState type="loading" />;
  if (error && news.length === 0)
    return <PageState type="error" description={error} onRetry={fetchNews} />;

  return (
    <div className="page-stack">
      <div className="page-actions-row justify-end">
        <button
          type="button"
          className="btn-classic px-5 inline-flex items-center gap-2"
          onClick={() => openModal()}
        >
          <Plus aria-hidden="true" size={18} />
          {t('news.add')}
        </button>
      </div>
      {error && (
        <div className="inline-alert inline-alert-error" role="alert">
          {error}
        </div>
      )}
      {news.length === 0 ? (
        <PageState
          type="empty"
          title={t('news.empty')}
          description={t('news.emptyHint')}
          action={
            <button type="button" className="btn-classic px-5" onClick={() => openModal()}>
              {t('news.add')}
            </button>
          }
        />
      ) : (
        <section className="card table-card">
          <div className="responsive-table-wrap">
            <table className="data-table news-table">
              <thead>
                <tr>
                  <th>{t('news.photo')}</th>
                  <th>{t('news.title')}</th>
                  <th>{t('news.description')}</th>
                  <th>{t('common.date')}</th>
                  <th className="text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {news.map((item) => {
                  const displayLanguage = contentLanguage(locale);
                  const localized = item.i18n?.[displayLanguage] ?? item.i18n?.ru ?? {};
                  const title = localized.title || item.title || '';
                  const description = localized.description || item.description || '';
                  const imageUrl = localized.imageUrl || item.imageUrl || item.imageurl || '';
                  return (
                    <tr key={item.id}>
                      <td data-label={t('news.photo')}>
                        <div className="table-thumbnail">
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={title || t('news.photo')}
                              width="88"
                              height="52"
                              loading="lazy"
                            />
                          ) : (
                            <ImageIcon aria-hidden="true" size={22} />
                          )}
                        </div>
                      </td>
                      <td data-label={t('news.title')}>
                        <strong>{title || '—'}</strong>
                      </td>
                      <td data-label={t('news.description')} className="table-description">
                        {description || '—'}
                      </td>
                      <td data-label={t('common.date')}>
                        {item.created_at
                          ? formatDate(item.created_at, { dateStyle: 'medium' })
                          : '—'}
                      </td>
                      <td data-label={t('common.actions')}>
                        <div className="row-actions justify-end">
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => openModal(item)}
                            aria-label={t('common.edit')}
                            title={t('common.edit')}
                          >
                            <Pencil aria-hidden="true" size={17} />
                          </button>
                          <button
                            type="button"
                            className="icon-button icon-button-danger"
                            onClick={() => remove(item)}
                            disabled={Boolean(busyId)}
                            aria-label={t('common.delete')}
                            title={t('common.delete')}
                          >
                            {busyId === item.id ? (
                              <LoaderCircle aria-hidden="true" className="spin" size={17} />
                            ) : (
                              <Trash2 aria-hidden="true" size={17} />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal
        open={modalOpen}
        onClose={() => !submitting && !uploading && setModalOpen(false)}
        title={editing ? t('news.editTitle') : t('news.createTitle')}
        size="md"
      >
        <form onSubmit={save} className="modal-body form-stack">
          {formError && (
            <div className="inline-alert inline-alert-error" role="alert">
              {formError}
            </div>
          )}
          <div className="language-tabs" role="tablist" aria-label={t('stories.languages')}>
            {languages.map((language) => (
              <button
                key={language}
                type="button"
                role="tab"
                aria-selected={activeLanguage === language}
                className={
                  activeLanguage === language ? 'language-tab language-tab-active' : 'language-tab'
                }
                onClick={() => setActiveLanguage(language)}
              >
                {t(`language.${localeKey(language)}`)}
                {i18n[language].title.trim() && (
                  <span className="tab-complete" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor={`news-title-${activeLanguage}`}>
              {t('news.title')} ({t(`content.${localeKey(activeLanguage)}`)})
              {activeLanguage === 'ru' ? ' *' : ''}
            </label>
            <input
              id={`news-title-${activeLanguage}`}
              className="input-classic"
              value={i18n[activeLanguage].title}
              onChange={(event) => updateField(activeLanguage, 'title', event.target.value)}
              required={activeLanguage === 'ru'}
              maxLength={180}
            />
          </div>
          <div className="field-group">
            <span className="field-label">
              {t('news.banner')} ({t(`content.${localeKey(activeLanguage)}`)})
              {activeLanguage === 'ru' ? ' *' : ''}
            </span>
            <div className="upload-row">
              {(i18n[activeLanguage].imageUrl || i18n.ru.imageUrl) && (
                <img
                  src={i18n[activeLanguage].imageUrl || i18n.ru.imageUrl}
                  alt={t('common.preview')}
                  className="upload-preview"
                  width="120"
                  height="72"
                />
              )}
              <label className="btn-outline upload-button">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={uploadFile}
                  disabled={uploading}
                />
                <Upload aria-hidden="true" size={17} />
                {uploading ? t('common.uploading') : t('stories.chooseImage')}
              </label>
            </div>
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor={`news-description-${activeLanguage}`}>
              {t('news.description')} ({t(`content.${localeKey(activeLanguage)}`)})
            </label>
            <textarea
              id={`news-description-${activeLanguage}`}
              className="input-classic"
              rows={5}
              value={i18n[activeLanguage].description}
              onChange={(event) => updateField(activeLanguage, 'description', event.target.value)}
              maxLength={2000}
            />
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-outline px-5"
              onClick={() => setModalOpen(false)}
              disabled={submitting || uploading}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-classic px-5 inline-flex items-center gap-2"
              disabled={submitting || uploading}
            >
              {submitting && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
              {submitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
