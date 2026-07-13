import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Clock, Image as ImageIcon, LoaderCircle, Pencil, Plus, Smartphone, Trash2, Upload } from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { contentLanguage, useI18n } from '../lib/i18n';

type ContentLanguage = 'ru' | 'kz' | 'en';
interface LocalizedStory { title: string; description: string; coverUrl: string; contentUrl: string }
interface StoryForm { groupId: string; duration: number; sortOrder: number }
const languages: ContentLanguage[] = ['ru', 'kz', 'en'];
const localeKey = (language: ContentLanguage) => language === 'kz' ? 'kk' : language;
const placeholders: Record<ContentLanguage, { title: string; description: string }> = {
  ru: { title: 'СЧАСТЛИВЫЕ ЧАСЫ', description: 'После 21:00 — 3 булочки по цене 2' },
  kz: { title: 'БАҚЫТТЫ САҒАТТАР', description: '21:00-ден кейін — 2 бағасына 3 бәліш' },
  en: { title: 'HAPPY HOURS', description: 'After 9 PM — get 3 pastries for the price of 2' },
};
const blankI18n = (): Record<ContentLanguage, LocalizedStory> => ({
  ru: { title: '', description: '', coverUrl: '', contentUrl: '' },
  kz: { title: '', description: '', coverUrl: '', contentUrl: '' },
  en: { title: '', description: '', coverUrl: '', contentUrl: '' },
});

export default function StoriesPage() {
  const { locale, t } = useI18n();
  const { toast, confirm } = useFeedback();
  const [stories, setStories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [activeLanguage, setActiveLanguage] = useState<ContentLanguage>('ru');
  const [form, setForm] = useState<StoryForm>({ groupId: '', duration: 15, sortOrder: 0 });
  const [i18n, setI18n] = useState<Record<ContentLanguage, LocalizedStory>>(blankI18n);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchStories = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await api.getStories(); setStories(data.stories ?? []); }
    catch (caught) { setError(caught instanceof Error ? caught.message : t('common.loadError')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void fetchStories(); }, [fetchStories]);

  const openModal = (story?: any) => {
    setEditing(story ?? null); setActiveLanguage('ru'); setFormError('');
    if (!story) {
      const nextOrder = stories.length ? Math.max(...stories.map(item => Number(item.sortOrder) || 0)) + 1 : 0;
      setI18n(blankI18n()); setForm({ groupId: '', duration: 15, sortOrder: nextOrder });
    } else {
      const data = story.i18n ?? {};
      const ru = { title: story.title ?? '', description: story.description ?? '', coverUrl: story.coverUrl || story.groupCoverUrl || '', contentUrl: story.contentUrl || '' };
      setI18n({
        ru: { ...ru, ...(data.ru ?? {}) },
        kz: { title: data.kz?.title ?? '', description: data.kz?.description ?? '', coverUrl: data.kz?.coverUrl ?? '', contentUrl: data.kz?.contentUrl ?? '' },
        en: { title: data.en?.title ?? '', description: data.en?.description ?? '', coverUrl: data.en?.coverUrl ?? '', contentUrl: data.en?.contentUrl ?? '' },
      });
      setForm({ groupId: story.groupId ?? '', duration: Number(story.duration) || 15, sortOrder: Number(story.sortOrder) || 0 });
    }
    setModalOpen(true);
  };

  const updateField = (language: ContentLanguage, field: keyof LocalizedStory, value: string) => setI18n(current => ({ ...current, [language]: { ...current[language], [field]: value } }));

  const uploadFile = async (event: ChangeEvent<HTMLInputElement>, field: 'coverUrl' | 'contentUrl') => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1_500_000) { setFormError(t('common.uploadError')); return; }
    const key = `${activeLanguage}-${field}`; setUploadingField(key); setFormError('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
      const result = await api.uploadPhoto(base64, file.name);
      if (!result.url) throw new Error(t('common.uploadError'));
      updateField(activeLanguage, field, result.url);
      toast(t('common.uploadSuccess'));
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : t('common.uploadError')); }
    finally { setUploadingField(null); }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (languages.some(language => !i18n[language].title.trim()) || !i18n.ru.coverUrl) { setFormError(t('stories.validation')); return; }
    setSubmitting(true); setFormError('');
    const payload = {
      title: i18n.ru.title.trim(), groupTitle: i18n.ru.title.trim(), description: i18n.ru.description.trim(),
      coverUrl: i18n.ru.coverUrl, contentUrl: i18n.ru.contentUrl || i18n.ru.coverUrl,
      groupId: form.groupId.trim() || i18n.ru.title.trim().toLocaleLowerCase().replace(/\s+/g, '-'),
      duration: Math.min(120, Math.max(3, Number(form.duration) || 15)), sortOrder: Math.max(0, Number(form.sortOrder) || 0), i18n,
    };
    try {
      if (editing) await api.updateStory({ ...payload, id: editing.id }); else await api.addStory(payload);
      setModalOpen(false); toast(t('stories.saved')); await fetchStories();
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : t('common.error')); }
    finally { setSubmitting(false); }
  };

  const remove = async (story: any) => {
    if (!await confirm({ title: t('stories.deleteTitle'), body: t('stories.deleteBody'), confirmLabel: t('common.delete'), destructive: true })) return;
    setBusyId(String(story.id));
    try { await api.deleteStory(String(story.id)); setStories(current => current.filter(item => item.id !== story.id)); toast(t('common.deleted')); }
    catch (caught) { toast(caught instanceof Error ? caught.message : t('common.error'), 'error'); }
    finally { setBusyId(null); }
  };

  const displayLanguage = contentLanguage(locale);
  const current = i18n[activeLanguage];
  const effectiveCover = current.coverUrl || (activeLanguage !== 'ru' ? i18n.ru.coverUrl : '');
  const effectiveContent = current.contentUrl || (activeLanguage !== 'ru' ? i18n.ru.contentUrl || i18n.ru.coverUrl : '');

  if (loading && stories.length === 0) return <PageState type="loading" />;
  if (error && stories.length === 0) return <PageState type="error" description={error} onRetry={fetchStories} />;

  return <div className="page-stack">
    <div className="page-actions-row"><div><h2 className="content-heading">{t('stories.heading')}</h2><p className="page-help">{t('stories.intro')}</p></div><button type="button" className="btn-classic px-5 inline-flex items-center gap-2" onClick={() => openModal()}><Plus aria-hidden="true" size={18} />{t('stories.add')}</button></div>
    {error && <div className="inline-alert inline-alert-error" role="alert">{error}</div>}
    {stories.length === 0 ? <PageState type="empty" title={t('stories.empty')} description={t('stories.emptyHint')} action={<button type="button" className="btn-classic px-5" onClick={() => openModal()}>{t('stories.add')}</button>} /> : (
      <section className="card table-card"><div className="responsive-table-wrap"><table className="data-table stories-table"><thead><tr><th scope="col">{t('stories.illustration')}</th><th scope="col">{t('stories.copy')}</th><th scope="col">{t('stories.languages')}</th><th scope="col" className="text-center">{t('common.order')}</th><th scope="col" className="text-right">{t('common.actions')}</th></tr></thead><tbody>{stories.map(story => {
        const data = story.i18n ?? {}; const localized = data[displayLanguage] ?? data.ru ?? {};
        const image = localized.coverUrl || data.ru?.coverUrl || story.groupCoverUrl || story.coverUrl;
        return <tr key={story.id}><td data-label={t('stories.illustration')}><div className="story-thumbnail">{image ? <img src={image} alt={localized.title || story.title || t('stories.illustration')} width="112" height="60" loading="lazy" /> : <ImageIcon size={24} />}</div></td><td data-label={t('stories.copy')}><strong>{localized.title || story.groupTitle || story.title}</strong><p className="table-description">{localized.description || story.description || '—'}</p></td><td data-label={t('stories.languages')}><div className="language-badges">{languages.map(language => <span key={language} className={data[language]?.title ? 'language-badge language-badge-complete' : 'language-badge'}>{t(`content.${localeKey(language)}`)}</span>)}</div></td><td data-label={t('common.order')} className="text-center tabular">{Number(story.sortOrder) || 0}</td><td data-label={t('common.actions')}><div className="row-actions justify-end"><button type="button" className="icon-button" onClick={() => openModal(story)} aria-label={t('common.edit')}><Pencil size={17} /></button><button type="button" className="icon-button icon-button-danger" onClick={() => remove(story)} disabled={Boolean(busyId)} aria-label={t('common.delete')}>{busyId === String(story.id) ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}</button></div></td></tr>;
      })}</tbody></table></div></section>
    )}

    <Modal open={modalOpen} onClose={() => !submitting && !uploadingField && setModalOpen(false)} title={editing ? t('stories.editTitle') : t('stories.createTitle')} description={t('stories.formHint')} size="xl">
      <form className="modal-body form-stack" onSubmit={save}>{formError && <div className="inline-alert inline-alert-error" role="alert">{formError}</div>}
        <div className="language-tabs" role="tablist" aria-label={t('stories.languages')}>{languages.map(language => <button key={language} type="button" role="tab" aria-selected={activeLanguage === language} className={activeLanguage === language ? 'language-tab language-tab-active' : 'language-tab'} onClick={() => setActiveLanguage(language)}>{t(`language.${localeKey(language)}`)}{i18n[language].title.trim() && <span className="tab-complete" aria-hidden="true" />}</button>)}</div>
        <div className="form-grid form-grid-2"><div className="field-group"><label className="field-label" htmlFor={`story-title-${activeLanguage}`}>{t('stories.promoTitle')} ({t(`content.${localeKey(activeLanguage)}`)}) *</label><input id={`story-title-${activeLanguage}`} className="input-classic" value={current.title} onChange={event => updateField(activeLanguage, 'title', event.target.value)} placeholder={placeholders[activeLanguage].title} required maxLength={160} /></div><div className="field-group"><label className="field-label" htmlFor={`story-description-${activeLanguage}`}>{t('stories.promoDescription')} ({t(`content.${localeKey(activeLanguage)}`)})</label><input id={`story-description-${activeLanguage}`} className="input-classic" value={current.description} onChange={event => updateField(activeLanguage, 'description', event.target.value)} placeholder={placeholders[activeLanguage].description} maxLength={300} /></div></div>
        <div className="story-upload-grid">
          <ImageUpload title={t('stories.horizontal')} required={activeLanguage === 'ru'} image={effectiveCover} fallback={activeLanguage !== 'ru' && !current.coverUrl} loading={uploadingField === `${activeLanguage}-coverUrl`} onFile={event => uploadFile(event, 'coverUrl')} onReset={current.coverUrl && activeLanguage !== 'ru' ? () => updateField(activeLanguage, 'coverUrl', '') : undefined} />
          <ImageUpload title={t('stories.vertical')} image={effectiveContent} fallback={activeLanguage !== 'ru' && !current.contentUrl} loading={uploadingField === `${activeLanguage}-contentUrl`} onFile={event => uploadFile(event, 'contentUrl')} onReset={current.contentUrl && activeLanguage !== 'ru' ? () => updateField(activeLanguage, 'contentUrl', '') : undefined} vertical />
        </div>
        <div className="form-grid form-grid-2"><div className="field-group"><label className="field-label icon-label" htmlFor="story-duration"><Clock size={15} />{t('stories.duration')}</label><input id="story-duration" type="number" min="3" max="120" className="input-classic" value={form.duration} onChange={event => setForm(currentForm => ({ ...currentForm, duration: Number(event.target.value) }))} required /></div><div className="field-group"><label className="field-label" htmlFor="story-order">{t('stories.sortOrder')}</label><input id="story-order" type="number" min="0" className="input-classic" value={form.sortOrder} onChange={event => setForm(currentForm => ({ ...currentForm, sortOrder: Number(event.target.value) }))} /></div></div>
        <div className="modal-actions"><button type="button" className="btn-outline px-5" onClick={() => setModalOpen(false)} disabled={submitting || Boolean(uploadingField)}>{t('common.cancel')}</button><button type="submit" className="btn-classic px-5 inline-flex items-center gap-2" disabled={submitting || Boolean(uploadingField)}>{submitting && <LoaderCircle className="spin" size={17} />}{submitting ? t('common.saving') : t('common.save')}</button></div>
      </form>
    </Modal>
  </div>;

  function ImageUpload({ title, required, image, fallback, loading: isUploading, onFile, onReset, vertical }: { title: string; required?: boolean; image: string; fallback: boolean; loading: boolean; onFile: (event: ChangeEvent<HTMLInputElement>) => void; onReset?: () => void; vertical?: boolean }) {
    return <div className="field-group"><div className="upload-label-row"><span className="field-label icon-label">{vertical ? <Smartphone size={15} /> : <ImageIcon size={15} />}{title}</span><small>{required ? t('common.required') : t('common.optional')}</small></div><label className={`story-upload ${image ? 'story-upload-filled' : ''}`}>
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} disabled={isUploading} />
      {isUploading ? <div className="upload-placeholder"><LoaderCircle className="spin" aria-hidden="true" size={24} /><span>{t('common.uploading')}</span></div> : image ? <><img src={image} alt={t('common.preview')} width="640" height="360" /><span className="upload-overlay"><Upload aria-hidden="true" size={20} />{t('stories.replaceImage')}</span>{fallback && <small className="fallback-chip">{t('stories.fallbackImage')}</small>}</> : <div className="upload-placeholder"><Upload aria-hidden="true" size={22} /><span>{t('stories.chooseImage')}</span></div>}
    </label>{onReset && <button type="button" className="text-button-danger" onClick={onReset}><Trash2 size={14} />{t('stories.resetImage')}</button>}</div>;
  }
}
