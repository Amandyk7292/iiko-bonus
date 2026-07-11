import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Image as ImageIcon, LoaderCircle, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface NewsItem { id: string; title?: string; description?: string; imageUrl?: string; imageurl?: string; created_at?: string }
const emptyForm = { title: '', imageUrl: '', description: '' };

export default function NewsPage() {
  const { t, formatDate } = useI18n();
  const { toast, confirm } = useFeedback();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<NewsItem | null>(null);
  const [form, setForm] = useState(emptyForm);
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
  useEffect(() => { void fetchNews(); }, [fetchNews]);

  const openModal = (item?: NewsItem) => {
    setEditing(item ?? null);
    setForm(item ? { title: item.title ?? '', imageUrl: item.imageUrl || item.imageurl || '', description: item.description ?? '' } : emptyForm);
    setFormError('');
    setModalOpen(true);
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
      setForm(current => ({ ...current, imageUrl: result.url ?? '' }));
      toast(t('common.uploadSuccess'));
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t('common.uploadError'));
    } finally {
      setUploading(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim() || !form.imageUrl) { setFormError(t('news.validation')); return; }
    setSubmitting(true);
    setFormError('');
    try {
      if (editing) await api.updateNews({ ...form, id: editing.id });
      else await api.addNews(form);
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
    if (!await confirm({ title: t('news.deleteTitle'), body: t('news.deleteBody'), confirmLabel: t('common.delete'), destructive: true })) return;
    setBusyId(item.id);
    try {
      await api.deleteNews(item.id);
      setNews(current => current.filter(newsItem => newsItem.id !== item.id));
      toast(t('common.deleted'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally { setBusyId(null); }
  };

  if (loading && news.length === 0) return <PageState type="loading" />;
  if (error && news.length === 0) return <PageState type="error" description={error} onRetry={fetchNews} />;

  return <div className="page-stack">
    <div className="page-actions-row justify-end"><button type="button" className="btn-classic px-5 inline-flex items-center gap-2" onClick={() => openModal()}><Plus aria-hidden="true" size={18} />{t('news.add')}</button></div>
    {error && <div className="inline-alert inline-alert-error" role="alert">{error}</div>}
    {news.length === 0 ? <PageState type="empty" title={t('news.empty')} description={t('news.emptyHint')} action={<button type="button" className="btn-classic px-5" onClick={() => openModal()}>{t('news.add')}</button>} /> : (
      <section className="card table-card"><div className="responsive-table-wrap"><table className="data-table news-table"><thead><tr><th>{t('news.photo')}</th><th>{t('news.title')}</th><th>{t('news.description')}</th><th>{t('common.date')}</th><th className="text-right">{t('common.actions')}</th></tr></thead><tbody>{news.map(item => {
        const imageUrl = item.imageUrl || item.imageurl || '';
        return <tr key={item.id}><td data-label={t('news.photo')}><div className="table-thumbnail">{imageUrl ? <img src={imageUrl} alt={item.title || t('news.photo')} width="88" height="52" loading="lazy" /> : <ImageIcon aria-hidden="true" size={22} />}</div></td><td data-label={t('news.title')}><strong>{item.title || '—'}</strong></td><td data-label={t('news.description')} className="table-description">{item.description || '—'}</td><td data-label={t('common.date')}>{item.created_at ? formatDate(item.created_at, { dateStyle: 'medium' }) : '—'}</td><td data-label={t('common.actions')}><div className="row-actions justify-end"><button type="button" className="icon-button" onClick={() => openModal(item)} aria-label={t('common.edit')}><Pencil aria-hidden="true" size={17} /></button><button type="button" className="icon-button icon-button-danger" onClick={() => remove(item)} disabled={Boolean(busyId)} aria-label={t('common.delete')}>{busyId === item.id ? <LoaderCircle className="spin" size={17} /> : <Trash2 aria-hidden="true" size={17} />}</button></div></td></tr>;
      })}</tbody></table></div></section>
    )}

    <Modal open={modalOpen} onClose={() => !submitting && !uploading && setModalOpen(false)} title={editing ? t('news.editTitle') : t('news.createTitle')} size="md">
      <form onSubmit={save} className="modal-body form-stack">
        {formError && <div className="inline-alert inline-alert-error" role="alert">{formError}</div>}
        <div className="field-group"><label className="field-label" htmlFor="news-title">{t('news.title')} *</label><input id="news-title" className="input-classic" value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} required maxLength={180} /></div>
        <div className="field-group"><span className="field-label">{t('news.banner')} *</span><div className="upload-row">{form.imageUrl && <img src={form.imageUrl} alt={t('common.preview')} className="upload-preview" width="120" height="72" />}<label className="btn-outline upload-button"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadFile} disabled={uploading} /><Upload aria-hidden="true" size={17} />{uploading ? t('common.uploading') : t('stories.chooseImage')}</label></div></div>
        <div className="field-group"><label className="field-label" htmlFor="news-description">{t('news.description')}</label><textarea id="news-description" className="input-classic" rows={5} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} maxLength={2000} /></div>
        <div className="modal-actions"><button type="button" className="btn-outline px-5" onClick={() => setModalOpen(false)} disabled={submitting || uploading}>{t('common.cancel')}</button><button type="submit" className="btn-classic px-5 inline-flex items-center gap-2" disabled={submitting || uploading}>{submitting && <LoaderCircle className="spin" size={17} />}{submitting ? t('common.saving') : t('common.save')}</button></div>
      </form>
    </Modal>
  </div>;
}
