import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, LoaderCircle, Pencil, Plus } from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { faqApi, sortFaqItems, type FaqInput, type FaqItem } from '../lib/faq';
import { useI18n } from '../lib/i18n';
import '../styles/faq.css';

type ContentLanguage = 'ru' | 'kk';
type FaqDraft = Omit<FaqInput, 'sortOrder'> & { sortOrder: string };
type FieldErrors = Partial<Record<keyof FaqDraft, string>>;

const createDraft = (sortOrder: number): FaqDraft => ({
  questionRu: '',
  answerRu: '',
  questionKk: '',
  answerKk: '',
  sortOrder: String(sortOrder),
  isActive: true,
});

function validateDraft(draft: FaqDraft): FieldErrors {
  const errors: FieldErrors = {};
  for (const language of ['Ru', 'Kk'] as const) {
    const questionKey = `question${language}` as const;
    const answerKey = `answer${language}` as const;
    const question = draft[questionKey].trim();
    const answer = draft[answerKey].trim();
    if (language === 'Ru' && !question) errors[questionKey] = 'faq.requiredQuestion';
    else if (question.length > 240) errors[questionKey] = 'faq.questionTooLong';
    if (language === 'Ru' && !answer) errors[answerKey] = 'faq.requiredAnswer';
    else if (answer.length > 4000) errors[answerKey] = 'faq.answerTooLong';
    if (language === 'Kk' && Boolean(question) !== Boolean(answer)) {
      errors[question ? answerKey : questionKey] = 'faq.translationPair';
    }
  }
  const sortOrder = Number(draft.sortOrder);
  if (
    !draft.sortOrder.trim() ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > 2147483647
  )
    errors.sortOrder = 'faq.invalidOrder';
  return errors;
}

function draftInput(draft: FaqDraft): FaqInput {
  return {
    questionRu: draft.questionRu.trim(),
    answerRu: draft.answerRu.trim(),
    questionKk: draft.questionKk.trim(),
    answerKk: draft.answerKk.trim(),
    sortOrder: Number(draft.sortOrder),
    isActive: draft.isActive,
  };
}

export default function FaqPage() {
  const { locale, t } = useI18n();
  const { toast, confirm } = useFeedback();
  const [items, setItems] = useState<FaqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FaqDraft>(() => createDraft(0));
  const [activeLanguage, setActiveLanguage] = useState<ContentLanguage>('ru');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const mutationLock = useRef(false);
  const sortedItems = useMemo(() => sortFaqItems(items), [items]);

  const loadItems = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError('');
      try {
        const response = await faqApi.list(signal);
        if (!signal?.aborted) setItems(response);
      } catch (caught) {
        if (!signal?.aborted)
          setLoadError(caught instanceof Error ? caught.message : t('common.loadError'));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadItems(controller.signal);
    return () => controller.abort();
  }, [loadItems]);

  useEffect(() => {
    const firstError = Object.keys(fieldErrors)[0];
    if (!firstError) return;
    const timer = window.setTimeout(() => document.getElementById(`faq-${firstError}`)?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [fieldErrors]);

  const replaceItem = (item: FaqItem) =>
    setItems((current) => {
      const index = current.findIndex((candidate) => candidate.id === item.id);
      return index < 0
        ? [...current, item]
        : current.map((candidate) => (candidate.id === item.id ? item : candidate));
    });

  const openEditor = (item?: FaqItem) => {
    if (mutationLock.current) return;
    setEditingId(item?.id ?? null);
    setDraft(
      item
        ? {
            ...item,
            sortOrder: String(item.sortOrder),
          }
        : createDraft(
            Math.min(
              2147483647,
              sortedItems.length ? Math.max(...sortedItems.map((entry) => entry.sortOrder)) + 1 : 0,
            ),
          ),
    );
    setActiveLanguage(item && locale === 'kk' ? 'kk' : 'ru');
    setFieldErrors({});
    setFormError('');
    setModalOpen(true);
  };

  const closeEditor = () => {
    if (!mutationLock.current) setModalOpen(false);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (mutationLock.current) return;
    const errors = validateDraft(draft);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      const firstError = Object.keys(errors)[0];
      if (firstError.endsWith('Ru')) setActiveLanguage('ru');
      else if (firstError.endsWith('Kk')) setActiveLanguage('kk');
      return;
    }
    mutationLock.current = true;
    setSubmitting(true);
    setFormError('');
    try {
      const input = draftInput(draft);
      const item = editingId ? await faqApi.update(editingId, input) : await faqApi.create(input);
      replaceItem(item);
      setModalOpen(false);
      toast(t('faq.saved'));
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      mutationLock.current = false;
      setSubmitting(false);
    }
  };

  const toggleVisibility = async (item: FaqItem) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusyId(item.id);
    try {
      if (
        item.isActive &&
        !(await confirm({
          title: t('faq.hideTitle'),
          body: t('faq.hideBody', {
            question: locale === 'kk' && item.questionKk ? item.questionKk : item.questionRu,
          }),
          confirmLabel: t('faq.hide'),
        }))
      )
        return;
      const updated = item.isActive
        ? await faqApi.hide(item.id)
        : await faqApi.update(item.id, {
            questionRu: item.questionRu,
            answerRu: item.answerRu,
            questionKk: item.questionKk,
            answerKk: item.answerKk,
            sortOrder: item.sortOrder,
            isActive: true,
          });
      replaceItem(updated);
      toast(t('faq.saved'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      mutationLock.current = false;
      setBusyId(null);
    }
  };

  const languageSuffix = activeLanguage === 'ru' ? 'Ru' : 'Kk';
  const questionKey = `question${languageSuffix}` as const;
  const answerKey = `answer${languageSuffix}` as const;
  const languageLabel = t(`language.${activeLanguage}`);
  const disabled = loading || Boolean(busyId) || submitting;

  return (
    <section className="faq-page" aria-label={t('page.faq.title')}>
      <div className="page-actions-row faq-toolbar">
        <button
          type="button"
          className="btn-classic faq-action"
          onClick={() => openEditor()}
          disabled={disabled}
        >
          <Plus aria-hidden="true" size={18} /> {t('faq.add')}
        </button>
      </div>

      {loading ? (
        <PageState type="loading" />
      ) : loadError ? (
        <PageState type="error" description={loadError} onRetry={() => void loadItems()} />
      ) : !sortedItems.length ? (
        <PageState type="empty" title={t('faq.empty')} />
      ) : (
        <ol className="faq-list">
          {sortedItems.map((item, index) => {
            const question = locale === 'kk' && item.questionKk ? item.questionKk : item.questionRu;
            const answer = locale === 'kk' && item.answerKk ? item.answerKk : item.answerRu;
            return (
              <li key={item.id}>
                <article
                  className={`card faq-card ${item.isActive ? '' : 'faq-card-hidden'}`}
                  aria-labelledby={`faq-title-${item.id}`}
                >
                  <div className="faq-card-content">
                    <div className="faq-card-heading">
                      <span className="faq-rank" aria-hidden="true">
                        {index + 1}
                      </span>
                      <h2 id={`faq-title-${item.id}`}>{question}</h2>
                    </div>
                    <p className="faq-answer-preview">{answer}</p>
                    <span
                      className={`status-pill ${item.isActive ? 'status-active' : 'status-inactive'}`}
                    >
                      {item.isActive ? t('faq.visible') : t('faq.hidden')}
                    </span>
                  </div>
                  <div className="faq-card-actions">
                    <button
                      type="button"
                      className="btn-outline faq-action"
                      disabled={disabled}
                      onClick={() => openEditor(item)}
                      aria-label={`${t('common.edit')}: ${question}`}
                    >
                      <Pencil aria-hidden="true" size={17} /> {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      className="btn-outline faq-action"
                      disabled={disabled}
                      onClick={() => void toggleVisibility(item)}
                      aria-label={`${t(item.isActive ? 'faq.hide' : 'faq.show')}: ${question}`}
                    >
                      {busyId === item.id ? (
                        <LoaderCircle aria-hidden="true" className="spin" size={17} />
                      ) : item.isActive ? (
                        <EyeOff aria-hidden="true" size={17} />
                      ) : (
                        <Eye aria-hidden="true" size={17} />
                      )}
                      {t(item.isActive ? 'faq.hide' : 'faq.show')}
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}

      <Modal
        open={modalOpen}
        onClose={closeEditor}
        title={t(editingId ? 'faq.editTitle' : 'faq.createTitle')}
        size="lg"
        footer={
          <div className="modal-actions">
            <button
              type="button"
              className="btn-outline px-5"
              onClick={closeEditor}
              disabled={submitting}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="faq-editor-form"
              className="btn-classic faq-action"
              disabled={submitting}
            >
              {submitting && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
              {t(submitting ? 'common.saving' : 'common.save')}
            </button>
          </div>
        }
      >
        <form
          id="faq-editor-form"
          className="modal-body form-stack"
          onSubmit={save}
          noValidate
          aria-busy={submitting}
        >
          {formError && (
            <div className="inline-alert inline-alert-error" role="alert">
              {formError}
            </div>
          )}
          <fieldset className="faq-editor-fields form-stack" disabled={submitting}>
            <div
              className="segmented-control faq-language-control"
              role="group"
              aria-label={t('tiers.languages')}
            >
              {(['ru', 'kk'] as const).map((language) => (
                <button
                  key={language}
                  type="button"
                  aria-pressed={language === activeLanguage}
                  className={language === activeLanguage ? 'is-active' : ''}
                  onClick={() => setActiveLanguage(language)}
                >
                  {t(`language.${language}`)}
                </button>
              ))}
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor={`faq-${questionKey}`}>
                {t('faq.question')} · {languageLabel}
                {activeLanguage === 'ru' ? ' *' : ''}
              </label>
              <input
                id={`faq-${questionKey}`}
                className="input-classic"
                value={draft[questionKey]}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [questionKey]: event.target.value }))
                }
                maxLength={240}
                required={activeLanguage === 'ru'}
                aria-invalid={Boolean(fieldErrors[questionKey])}
                aria-describedby={fieldErrors[questionKey] ? `faq-error-${questionKey}` : undefined}
              />
              {fieldErrors[questionKey] && (
                <p id={`faq-error-${questionKey}`} className="field-error" role="alert">
                  {t(fieldErrors[questionKey])}
                </p>
              )}
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor={`faq-${answerKey}`}>
                {t('faq.answer')} · {languageLabel}
                {activeLanguage === 'ru' ? ' *' : ''}
              </label>
              <textarea
                id={`faq-${answerKey}`}
                className="input-classic faq-answer-input"
                rows={6}
                value={draft[answerKey]}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [answerKey]: event.target.value }))
                }
                maxLength={4000}
                required={activeLanguage === 'ru'}
                aria-invalid={Boolean(fieldErrors[answerKey])}
                aria-describedby={fieldErrors[answerKey] ? `faq-error-${answerKey}` : undefined}
              />
              {fieldErrors[answerKey] && (
                <p id={`faq-error-${answerKey}`} className="field-error" role="alert">
                  {t(fieldErrors[answerKey])}
                </p>
              )}
            </div>
            <div className="faq-editor-options">
              <div className="field-group">
                <label className="field-label" htmlFor="faq-sortOrder">
                  {t('faq.order')}
                </label>
                <input
                  id="faq-sortOrder"
                  className="input-classic"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={2147483647}
                  step={1}
                  value={draft.sortOrder}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                  required
                  aria-invalid={Boolean(fieldErrors.sortOrder)}
                  aria-describedby={fieldErrors.sortOrder ? 'faq-error-sortOrder' : undefined}
                />
                {fieldErrors.sortOrder && (
                  <p id="faq-error-sortOrder" className="field-error" role="alert">
                    {t(fieldErrors.sortOrder)}
                  </p>
                )}
              </div>
              <label className="switch-row faq-visibility-control">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, isActive: event.target.checked }))
                  }
                />
                <span className="switch-control" aria-hidden="true" />
                <span>{t('faq.showToCustomers')}</span>
              </label>
            </div>
          </fieldset>
        </form>
      </Modal>
    </section>
  );
}
