import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, CircleDollarSign, LoaderCircle, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api, type LocalizedText, type LoyaltyTier, type LoyaltyTierInput } from '../lib/api';
import { useI18n, type Locale } from '../lib/i18n';

const emptyLocalized = (): LocalizedText => ({ ru: '', kk: '', en: '' });
const contentLocales: Locale[] = ['ru', 'kk', 'en'];

function createDraft(sortOrder: number): LoyaltyTierInput {
  return {
    code: '',
    names: emptyLocalized(),
    descriptions: emptyLocalized(),
    minSpend: 0,
    cashbackPercent: 0,
    sortOrder,
    isActive: true,
  };
}

export default function LoyaltyTiersPage() {
  const { locale, t, formatNumber } = useI18n();
  const { toast, confirm } = useFeedback();
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LoyaltyTierInput>(() => createDraft(0));
  const [activeLanguage, setActiveLanguage] = useState<Locale>('ru');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  const sortedTiers = useMemo(
    () => [...tiers].sort((a, b) => a.sortOrder - b.sortOrder || a.minSpend - b.minSpend),
    [tiers],
  );

  const loadTiers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setTiers(await api.getLoyaltyTiers());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void loadTiers(); }, [loadTiers]);

  const openCreate = () => {
    const nextOrder = sortedTiers.length ? Math.max(...sortedTiers.map(tier => tier.sortOrder)) + 1 : 0;
    setEditingId(null);
    setDraft(createDraft(nextOrder));
    setActiveLanguage('ru');
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (tier: LoyaltyTier) => {
    setEditingId(tier.id);
    setDraft({
      code: tier.code,
      names: { ...emptyLocalized(), ...tier.names },
      descriptions: { ...emptyLocalized(), ...tier.descriptions },
      minSpend: Number(tier.minSpend),
      cashbackPercent: Number(tier.cashbackPercent),
      sortOrder: Number(tier.sortOrder),
      isActive: Boolean(tier.isActive),
    });
    setActiveLanguage(locale);
    setFormError('');
    setModalOpen(true);
  };

  const validate = () => {
    if (!draft.code.trim() || !/^[a-z0-9_-]+$/i.test(draft.code.trim())) return t('tiers.validationCode');
    if (contentLocales.some(language => !draft.names[language].trim())) return t('tiers.validationNames');
    if (draft.minSpend < 0 || draft.cashbackPercent < 0 || draft.cashbackPercent > 100) return t('tiers.validationNumbers');
    return '';
  };

  const saveTier = async (event: FormEvent) => {
    event.preventDefault();
    const validation = validate();
    if (validation) {
      setFormError(validation);
      return;
    }
    setSubmitting(true);
    setFormError('');
    const payload: LoyaltyTierInput = {
      ...draft,
      code: draft.code.trim().toLowerCase(),
      names: Object.fromEntries(contentLocales.map(language => [language, draft.names[language].trim()])) as unknown as LocalizedText,
      descriptions: Object.fromEntries(contentLocales.map(language => [language, (draft.descriptions[language] || draft.names[language]).trim()])) as unknown as LocalizedText,
      minSpend: Number(draft.minSpend),
      cashbackPercent: Number(draft.cashbackPercent),
      sortOrder: Number(draft.sortOrder),
    };
    try {
      if (editingId) await api.updateLoyaltyTier(editingId, payload);
      else await api.createLoyaltyTier(payload);
      setModalOpen(false);
      toast(t('tiers.saved'));
      await loadTiers();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const removeTier = async (tier: LoyaltyTier) => {
    const accepted = await confirm({
      title: t('tiers.deleteTitle'),
      body: t('tiers.deleteBody', { name: tier.names[locale] || tier.names.ru }),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!accepted) return;
    setBusyId(tier.id);
    try {
      await api.deleteLoyaltyTier(tier.id);
      setTiers(current => current.filter(item => item.id !== tier.id));
      toast(t('tiers.deleted'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const toggleTier = async (tier: LoyaltyTier) => {
    setBusyId(tier.id);
    try {
      await api.setLoyaltyTierActive(tier.id, !tier.isActive);
      setTiers(current => current.map(item => item.id === tier.id ? { ...item, isActive: !item.isActive } : item));
      toast(t('common.saved'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const moveTier = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sortedTiers.length) return;
    const reordered = [...sortedTiers];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const normalized = reordered.map((tier, sortOrder) => ({ ...tier, sortOrder }));
    const previous = tiers;
    setBusyId(sortedTiers[index].id);
    setTiers(normalized);
    try {
      await api.reorderLoyaltyTiers(normalized.map(tier => tier.id));
      toast(t('tiers.reordered'));
    } catch (caught) {
      setTiers(previous);
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <p className="page-help">{t('tiers.baselineHint')}</p>
        <button type="button" onClick={openCreate} className="btn-classic px-5 inline-flex items-center gap-2">
          <Plus aria-hidden="true" size={18} /> {t('tiers.add')}
        </button>
      </div>

      {loading ? <PageState type="loading" title={t('tiers.load')} /> : error ? (
        <PageState type="error" description={error} onRetry={loadTiers} />
      ) : sortedTiers.length === 0 ? (
        <PageState
          type="empty"
          title={t('tiers.empty')}
          description={t('tiers.emptyHint')}
          action={<button type="button" onClick={openCreate} className="btn-classic px-5">{t('tiers.add')}</button>}
        />
      ) : (
        <div className="tiers-layout">
          <section className="card table-card" aria-label={t('page.tiers.title')}>
            <div className="responsive-table-wrap">
              <table className="data-table tiers-table">
                <thead>
                  <tr>
                    <th scope="col">{t('tiers.name')}</th>
                    <th scope="col">{t('tiers.minSpend')}</th>
                    <th scope="col">{t('tiers.cashback')}</th>
                    <th scope="col">{t('common.status')}</th>
                    <th scope="col" className="text-right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTiers.map((tier, index) => (
                    <tr key={tier.id} className={!tier.isActive ? 'row-muted' : undefined}>
                      <td data-label={t('tiers.name')}>
                        <div className="tier-name-cell">
                          <span className="tier-rank">{index + 1}</span>
                          <div><strong>{tier.names[locale] || tier.names.ru}</strong><small>{tier.code}</small></div>
                        </div>
                      </td>
                      <td data-label={t('tiers.minSpend')} className="tabular">{formatNumber(tier.minSpend)} ₸</td>
                      <td data-label={t('tiers.cashback')}><strong className="cashback-value">{formatNumber(tier.cashbackPercent, { maximumFractionDigits: 2 })}%</strong></td>
                      <td data-label={t('common.status')}><span className={`status-pill ${tier.isActive ? 'status-active' : 'status-inactive'}`}>{tier.isActive ? t('common.active') : t('common.inactive')}</span></td>
                      <td data-label={t('common.actions')}>
                        <div className="row-actions justify-end">
                          <button type="button" className="icon-button" onClick={() => moveTier(index, -1)} disabled={index === 0 || Boolean(busyId)} aria-label={t('tiers.moveUp')} title={t('tiers.moveUp')}><ArrowUp aria-hidden="true" size={17} /></button>
                          <button type="button" className="icon-button" onClick={() => moveTier(index, 1)} disabled={index === sortedTiers.length - 1 || Boolean(busyId)} aria-label={t('tiers.moveDown')} title={t('tiers.moveDown')}><ArrowDown aria-hidden="true" size={17} /></button>
                          <button type="button" className="icon-button" onClick={() => toggleTier(tier)} disabled={Boolean(busyId)} aria-label={tier.isActive ? t('tiers.deactivate') : t('tiers.activate')} title={tier.isActive ? t('tiers.deactivate') : t('tiers.activate')}>
                            {busyId === tier.id ? <LoaderCircle className="spin" size={17} /> : <Power aria-hidden="true" size={17} />}
                          </button>
                          <button type="button" className="icon-button" onClick={() => openEdit(tier)} aria-label={t('common.edit')} title={t('common.edit')}><Pencil aria-hidden="true" size={17} /></button>
                          <button type="button" className="icon-button icon-button-danger" onClick={() => removeTier(tier)} disabled={Boolean(busyId)} aria-label={t('common.delete')} title={t('common.delete')}><Trash2 aria-hidden="true" size={17} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="tier-preview-column" aria-label={t('common.preview')}>
            <p className="section-eyebrow">{t('common.preview')}</p>
            {sortedTiers.filter(tier => tier.isActive).map((tier, index) => (
              <article key={tier.id} className="tier-preview-card" style={{ '--tier-index': index } as React.CSSProperties}>
                <div className="tier-preview-icon"><CircleDollarSign aria-hidden="true" size={22} /></div>
                <div>
                  <h3>{tier.names[locale] || tier.names.ru}</h3>
                  <p>{tier.descriptions[locale] || tier.descriptions.ru}</p>
                  <div className="tier-preview-meta">
                    <span>{t('tiers.previewSpend', { amount: formatNumber(tier.minSpend) })}</span>
                    <strong>{t('tiers.previewCashback', { percent: formatNumber(tier.cashbackPercent, { maximumFractionDigits: 2 }) })}</strong>
                  </div>
                </div>
              </article>
            ))}
          </aside>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => !submitting && setModalOpen(false)} title={editingId ? t('tiers.editTitle') : t('tiers.createTitle')} size="lg">
        <form onSubmit={saveTier} className="modal-body form-stack" noValidate>
          {formError && <div className="inline-alert inline-alert-error" role="alert">{formError}</div>}

          <div className="form-grid form-grid-2">
            <div className="field-group">
              <label className="field-label" htmlFor="tier-code">{t('tiers.code')} *</label>
              <input id="tier-code" className="input-classic" value={draft.code} onChange={event => setDraft(current => ({ ...current, code: event.target.value }))} pattern="[A-Za-z0-9_-]+" required autoComplete="off" />
              <p className="field-hint">{t('tiers.codeHint')}</p>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="tier-order">{t('common.order')}</label>
              <input id="tier-order" type="number" min="0" className="input-classic" value={draft.sortOrder} onChange={event => setDraft(current => ({ ...current, sortOrder: Number(event.target.value) }))} />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="tier-spend">{t('tiers.minSpend')} *</label>
              <input id="tier-spend" type="number" min="0" step="1" className="input-classic" value={draft.minSpend} onChange={event => setDraft(current => ({ ...current, minSpend: Number(event.target.value) }))} required />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="tier-cashback">{t('tiers.cashback')} *</label>
              <input id="tier-cashback" type="number" min="0" max="100" step="0.01" className="input-classic" value={draft.cashbackPercent} onChange={event => setDraft(current => ({ ...current, cashbackPercent: Number(event.target.value) }))} required />
            </div>
          </div>

          <label className="switch-row">
            <input type="checkbox" checked={draft.isActive} onChange={event => setDraft(current => ({ ...current, isActive: event.target.checked }))} />
            <span className="switch-control" aria-hidden="true" />
            <span>{draft.isActive ? t('common.active') : t('common.inactive')}</span>
          </label>

          <div className="language-tabs" role="tablist" aria-label={t('tiers.languages')}>
            {contentLocales.map(language => (
              <button key={language} type="button" role="tab" aria-selected={activeLanguage === language} className={activeLanguage === language ? 'language-tab language-tab-active' : 'language-tab'} onClick={() => setActiveLanguage(language)}>
                {t(`language.${language}`)}
                {draft.names[language].trim() && <span className="tab-complete" aria-hidden="true" />}
              </button>
            ))}
          </div>

          <div className="form-grid form-grid-2">
            <div className="field-group">
              <label className="field-label" htmlFor={`tier-name-${activeLanguage}`}>{t('tiers.name')} ({t(`content.${activeLanguage}`)}) *</label>
              <input id={`tier-name-${activeLanguage}`} className="input-classic" value={draft.names[activeLanguage]} onChange={event => setDraft(current => ({ ...current, names: { ...current.names, [activeLanguage]: event.target.value } }))} required />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor={`tier-description-${activeLanguage}`}>{t('tiers.conditions')} ({t(`content.${activeLanguage}`)})</label>
              <textarea id={`tier-description-${activeLanguage}`} className="input-classic" rows={3} value={draft.descriptions[activeLanguage]} onChange={event => setDraft(current => ({ ...current, descriptions: { ...current.descriptions, [activeLanguage]: event.target.value } }))} />
              <p className="field-hint">{t('tiers.conditionsHint')}</p>
            </div>
          </div>

          <div className="tier-form-preview">
            <span className="section-eyebrow">{t('common.preview')}</span>
            <strong>{draft.names[activeLanguage] || t('tiers.name')}</strong>
            <span>{t('tiers.previewSpend', { amount: formatNumber(draft.minSpend) })} · {t('tiers.previewCashback', { percent: formatNumber(draft.cashbackPercent, { maximumFractionDigits: 2 }) })}</span>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-outline px-5" onClick={() => setModalOpen(false)} disabled={submitting}>{t('common.cancel')}</button>
            <button type="submit" className="btn-classic px-5 inline-flex items-center gap-2" disabled={submitting}>
              {submitting && <LoaderCircle className="spin" aria-hidden="true" size={18} />}
              {submitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
