import { useState, type FormEvent } from 'react';
import { BellRing, LoaderCircle, Send } from 'lucide-react';
import { useFeedback } from '../components/Feedback';
import { api, type LocalizedText } from '../lib/api';
import { useI18n, type Locale } from '../lib/i18n';

const languages: Locale[] = ['ru', 'kk', 'en'];
const emptyLocalized = (): LocalizedText => ({ ru: '', kk: '', en: '' });

export default function BroadcastPage() {
  const { t } = useI18n();
  const { toast, confirm } = useFeedback();
  const [titles, setTitles] = useState<LocalizedText>(emptyLocalized);
  const [bodies, setBodies] = useState<LocalizedText>(emptyLocalized);
  const [activeLanguage, setActiveLanguage] = useState<Locale>('ru');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (languages.some(language => !titles[language].trim() || !bodies[language].trim())) {
      setError(t('broadcast.validation'));
      return;
    }
    const accepted = await confirm({ title: t('broadcast.confirmTitle'), body: t('broadcast.confirmBody'), confirmLabel: t('broadcast.send') });
    if (!accepted) return;

    setLoading(true);
    setError('');
    try {
      const response = await api.sendPushMass(
        { ru: titles.ru.trim(), kk: titles.kk.trim(), en: titles.en.trim() },
        { ru: bodies.ru.trim(), kk: bodies.kk.trim(), en: bodies.en.trim() },
      );
      toast(t('broadcast.sent', { count: response.count ?? 0 }));
      setTitles(emptyLocalized());
      setBodies(emptyLocalized());
      setActiveLanguage('ru');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t('common.error');
      setError(message);
      toast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-stack page-narrow">
      <form className="card broadcast-card" onSubmit={handleSend} noValidate>
        <div className="broadcast-heading">
          <span className="broadcast-icon"><BellRing aria-hidden="true" size={24} /></span>
          <div><h2>{t('broadcast.title')}</h2><p>{t('broadcast.subtitle')}</p></div>
        </div>
        {error && <div className="inline-alert inline-alert-error" role="alert">{error}</div>}
        <div className="language-tabs" role="tablist" aria-label={t('broadcast.languages')}>
          {languages.map(language => (
            <button
              key={language}
              type="button"
              role="tab"
              aria-selected={activeLanguage === language}
              className={activeLanguage === language ? 'language-tab language-tab-active' : 'language-tab'}
              onClick={() => setActiveLanguage(language)}
            >
              {t(`language.${language}`)}
              {titles[language].trim() && bodies[language].trim() && <span className="tab-complete" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor={`push-title-${activeLanguage}`}>{t('broadcast.subject')} ({t(`language.${activeLanguage}`)}) *</label>
          <input id={`push-title-${activeLanguage}`} type="text" className="input-classic" value={titles[activeLanguage]} onChange={event => setTitles(current => ({ ...current, [activeLanguage]: event.target.value }))} placeholder={t('broadcast.subjectPlaceholder')} maxLength={120} required aria-invalid={Boolean(error && !titles[activeLanguage].trim())} />
          <span className="character-count" aria-live="polite">{titles[activeLanguage].length}/120</span>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor={`push-body-${activeLanguage}`}>{t('broadcast.body')} ({t(`language.${activeLanguage}`)}) *</label>
          <textarea id={`push-body-${activeLanguage}`} className="input-classic" rows={6} value={bodies[activeLanguage]} onChange={event => setBodies(current => ({ ...current, [activeLanguage]: event.target.value }))} placeholder={t('broadcast.bodyPlaceholder')} maxLength={500} required aria-invalid={Boolean(error && !bodies[activeLanguage].trim())} />
          <span className="character-count" aria-live="polite">{bodies[activeLanguage].length}/500</span>
        </div>
        <button type="submit" disabled={loading} className="btn-classic broadcast-submit">
          {loading ? <LoaderCircle aria-hidden="true" className="spin" size={18} /> : <Send aria-hidden="true" size={18} />}
          {loading ? t('common.sending') : t('broadcast.send')}
        </button>
      </form>
    </div>
  );
}
