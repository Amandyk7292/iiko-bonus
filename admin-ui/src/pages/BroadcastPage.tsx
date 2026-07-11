import { useState, type FormEvent } from 'react';
import { BellRing, LoaderCircle, Send } from 'lucide-react';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

export default function BroadcastPage() {
  const { t } = useI18n();
  const { toast, confirm } = useFeedback();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) {
      setError(t('broadcast.validation'));
      return;
    }
    const accepted = await confirm({ title: t('broadcast.confirmTitle'), body: t('broadcast.confirmBody'), confirmLabel: t('broadcast.send') });
    if (!accepted) return;

    setLoading(true);
    setError('');
    try {
      const response = await api.sendPushMass(title.trim(), body.trim());
      toast(t('broadcast.sent', { count: response.count ?? 0 }));
      setTitle('');
      setBody('');
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
        <div className="field-group">
          <label className="field-label" htmlFor="push-title">{t('broadcast.subject')} *</label>
          <input id="push-title" type="text" className="input-classic" value={title} onChange={event => setTitle(event.target.value)} placeholder={t('broadcast.subjectPlaceholder')} maxLength={120} required aria-invalid={Boolean(error && !title.trim())} />
          <span className="character-count" aria-live="polite">{title.length}/120</span>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="push-body">{t('broadcast.body')} *</label>
          <textarea id="push-body" className="input-classic" rows={6} value={body} onChange={event => setBody(event.target.value)} placeholder={t('broadcast.bodyPlaceholder')} maxLength={500} required aria-invalid={Boolean(error && !body.trim())} />
          <span className="character-count" aria-live="polite">{body.length}/500</span>
        </div>
        <button type="submit" disabled={loading} className="btn-classic broadcast-submit">
          {loading ? <LoaderCircle aria-hidden="true" className="spin" size={18} /> : <Send aria-hidden="true" size={18} />}
          {loading ? t('common.sending') : t('broadcast.send')}
        </button>
      </form>
    </div>
  );
}
