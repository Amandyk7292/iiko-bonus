import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  AtSign,
  Camera,
  ExternalLink,
  Globe2,
  Link2,
  LoaderCircle,
  Mail,
  MessageCircle,
  MessagesSquare,
  Pencil,
  Phone,
  Plus,
  Power,
  Send,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import {
  api,
  type ContactAction,
  type ContactActionInput,
  type ContactActionType,
  type ContactCard,
  type ContactCardInput,
  type LocalizedText,
} from '../lib/api';
import { useI18n, type Locale } from '../lib/i18n';

const languages: Locale[] = ['ru', 'kk', 'en'];
const emptyLocalized = (): LocalizedText => ({ ru: '', kk: '', en: '' });

const actionOptions: Array<{
  type: ContactActionType;
  iconKey: string;
  labelKey: string;
  icon: LucideIcon;
}> = [
  { type: 'phone', iconKey: 'phone', labelKey: 'contacts.type.phone', icon: Phone },
  {
    type: 'whatsapp',
    iconKey: 'whatsapp',
    labelKey: 'contacts.type.whatsapp',
    icon: MessageCircle,
  },
  { type: 'telegram', iconKey: 'telegram', labelKey: 'contacts.type.telegram', icon: Send },
  {
    type: 'instagram',
    iconKey: 'instagram',
    labelKey: 'contacts.type.instagram',
    icon: Camera,
  },
  { type: 'vk', iconKey: 'vk', labelKey: 'contacts.type.vk', icon: Users },
  { type: 'email', iconKey: 'email', labelKey: 'contacts.type.email', icon: Mail },
  { type: 'website', iconKey: 'website', labelKey: 'contacts.type.website', icon: Globe2 },
  {
    type: 'online_chat',
    iconKey: 'chat',
    labelKey: 'contacts.type.onlineChat',
    icon: MessagesSquare,
  },
  {
    type: 'custom_url',
    iconKey: 'link',
    labelKey: 'contacts.type.customUrl',
    icon: Link2,
  },
];

const actionIconByKey: Record<string, LucideIcon> = {
  phone: Phone,
  whatsapp: MessageCircle,
  telegram: Send,
  instagram: Camera,
  vk: Users,
  email: AtSign,
  website: Globe2,
  chat: MessagesSquare,
  link: ExternalLink,
};

function cardInput(card: ContactCard): ContactCardInput {
  return {
    displayMode: card.displayMode,
    titles: { ...card.titles },
    iconKey: card.iconKey,
    sortOrder: card.sortOrder,
    isActive: card.isActive,
  };
}

function actionInput(action: ContactAction): ContactActionInput {
  return {
    type: action.type,
    labels: { ...action.labels },
    target: action.target,
    iconKey: action.iconKey,
    sortOrder: action.sortOrder,
    isActive: action.isActive,
  };
}

function localizedValue(value: LocalizedText, locale: Locale) {
  return value[locale] || value.ru;
}

export default function ContactCenterPage() {
  const { locale, t } = useI18n();
  const { toast, confirm } = useFeedback();
  const [cards, setCards] = useState<ContactCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cardModalOpen, setCardModalOpen] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [actionCardId, setActionCardId] = useState<string | null>(null);
  const [cardDraft, setCardDraft] = useState<ContactCardInput | null>(null);
  const [actionDraft, setActionDraft] = useState<ContactActionInput | null>(null);
  const [activeLanguage, setActiveLanguage] = useState<Locale>('ru');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const sortedCards = useMemo(
    () => [...cards].sort((a, b) => a.sortOrder - b.sortOrder),
    [cards],
  );

  const loadCards = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCards(await api.getContactCards());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  const openCreateCard = () => {
    const nextOrder = sortedCards.length
      ? Math.max(...sortedCards.map((card) => card.sortOrder)) + 1
      : 0;
    setEditingCardId(null);
    setCardDraft({
      displayMode: 'standard',
      titles: emptyLocalized(),
      iconKey: 'bulka',
      sortOrder: nextOrder,
      isActive: false,
    });
    setActiveLanguage('ru');
    setFormError('');
    setCardModalOpen(true);
  };

  const openEditCard = (card: ContactCard) => {
    setEditingCardId(card.id);
    setCardDraft(cardInput(card));
    setActiveLanguage(locale);
    setFormError('');
    setCardModalOpen(true);
  };

  const openCreateAction = (card: ContactCard) => {
    const sortedActions = [...card.actions].sort((a, b) => a.sortOrder - b.sortOrder);
    const nextOrder = sortedActions.length
      ? Math.max(...sortedActions.map((action) => action.sortOrder)) + 1
      : 0;
    setEditingActionId(null);
    setActionCardId(card.id);
    setActionDraft({
      type: 'phone',
      labels: emptyLocalized(),
      target: '',
      iconKey: 'phone',
      sortOrder: nextOrder,
      isActive: true,
    });
    setActiveLanguage('ru');
    setFormError('');
    setActionModalOpen(true);
  };

  const openEditAction = (action: ContactAction) => {
    setEditingActionId(action.id);
    setActionCardId(action.cardId);
    setActionDraft(actionInput(action));
    setActiveLanguage(locale);
    setFormError('');
    setActionModalOpen(true);
  };

  const saveCard = async (event: FormEvent) => {
    event.preventDefault();
    if (!cardDraft) return;
    if (languages.some((language) => !cardDraft.titles[language].trim())) {
      setFormError(t('contacts.validationLanguages'));
      return;
    }
    const editingCard = cards.find((card) => card.id === editingCardId);
    const activeActions = editingCard?.actions.filter((action) => action.isActive).length ?? 0;
    if (cardDraft.isActive && cardDraft.displayMode === 'compact' && activeActions < 1) {
      setFormError(t('contacts.validationCompact'));
      return;
    }

    setSubmitting(true);
    setFormError('');
    const payload: ContactCardInput = {
      ...cardDraft,
      titles: Object.fromEntries(
        languages.map((language) => [language, cardDraft.titles[language].trim()]),
      ) as unknown as LocalizedText,
    };
    try {
      if (editingCardId) await api.updateContactCard(editingCardId, payload);
      else await api.createContactCard(payload);
      setCardModalOpen(false);
      toast(t('contacts.cardSaved'));
      await loadCards();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const saveAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!actionDraft || !actionCardId) return;
    if (languages.some((language) => !actionDraft.labels[language].trim())) {
      setFormError(t('contacts.validationLanguages'));
      return;
    }
    if (!actionDraft.target.trim()) {
      setFormError(t('contacts.validationTarget'));
      return;
    }

    setSubmitting(true);
    setFormError('');
    const payload: ContactActionInput = {
      ...actionDraft,
      labels: Object.fromEntries(
        languages.map((language) => [language, actionDraft.labels[language].trim()]),
      ) as unknown as LocalizedText,
      target: actionDraft.target.trim(),
    };
    try {
      if (editingActionId) await api.updateContactAction(editingActionId, payload);
      else await api.createContactAction(actionCardId, payload);
      setActionModalOpen(false);
      toast(t('contacts.actionSaved'));
      await loadCards();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const removeCard = async (card: ContactCard) => {
    const accepted = await confirm({
      title: t('contacts.deleteCardTitle'),
      body: t('contacts.deleteCardBody', { name: localizedValue(card.titles, locale) }),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!accepted) return;
    setBusyId(card.id);
    try {
      await api.deleteContactCard(card.id);
      setCards((current) => current.filter((item) => item.id !== card.id));
      toast(t('contacts.cardDeleted'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const removeAction = async (action: ContactAction) => {
    const accepted = await confirm({
      title: t('contacts.deleteActionTitle'),
      body: t('contacts.deleteActionBody', { name: localizedValue(action.labels, locale) }),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!accepted) return;
    setBusyId(action.id);
    try {
      await api.deleteContactAction(action.id);
      setCards((current) =>
        current.map((card) => ({
          ...card,
          actions: card.actions.filter((item) => item.id !== action.id),
        })),
      );
      toast(t('contacts.actionDeleted'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const toggleCard = async (card: ContactCard) => {
    const nextActive = !card.isActive;
    if (
      nextActive &&
      card.displayMode === 'compact' &&
      card.actions.filter((action) => action.isActive).length < 1
    ) {
      toast(t('contacts.validationCompact'), 'error');
      return;
    }
    setBusyId(card.id);
    try {
      const updated = await api.updateContactCard(card.id, {
        ...cardInput(card),
        isActive: nextActive,
      });
      setCards((current) => current.map((item) => (item.id === card.id ? updated : item)));
      toast(t('common.saved'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const toggleAction = async (action: ContactAction) => {
    const card = cards.find((item) => item.id === action.cardId);
    if (
      action.isActive &&
      card?.isActive &&
      card.displayMode === 'compact' &&
      card.actions.filter((item) => item.isActive).length <= 1
    ) {
      toast(t('contacts.validationCompact'), 'error');
      return;
    }
    setBusyId(action.id);
    try {
      await api.updateContactAction(action.id, {
        ...actionInput(action),
        isActive: !action.isActive,
      });
      await loadCards();
      toast(t('common.saved'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const moveCard = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sortedCards.length) return;
    const reordered = [...sortedCards];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const normalized = reordered.map((card, sortOrder) => ({ ...card, sortOrder }));
    const previous = cards;
    setCards(normalized);
    setBusyId(sortedCards[index].id);
    try {
      await api.reorderContactCards(normalized.map((card) => card.id));
      toast(t('contacts.reordered'));
    } catch (caught) {
      setCards(previous);
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const moveAction = async (card: ContactCard, index: number, direction: -1 | 1) => {
    const sortedActions = [...card.actions].sort((a, b) => a.sortOrder - b.sortOrder);
    const target = index + direction;
    if (target < 0 || target >= sortedActions.length) return;
    [sortedActions[index], sortedActions[target]] = [sortedActions[target], sortedActions[index]];
    const normalized = sortedActions.map((action, sortOrder) => ({ ...action, sortOrder }));
    const previous = cards;
    setCards((current) =>
      current.map((item) => (item.id === card.id ? { ...item, actions: normalized } : item)),
    );
    setBusyId(sortedActions[target].id);
    try {
      await api.reorderContactActions(card.id, normalized.map((action) => action.id));
      toast(t('contacts.reordered'));
    } catch (caught) {
      setCards(previous);
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page-stack contact-admin-page">
      <div className="page-actions-row contact-admin-intro">
        <div>
          <p className="page-help">{t('contacts.intro')}</p>
          <p className="field-hint">{t('contacts.publicHint')}</p>
        </div>
        <button
          type="button"
          onClick={openCreateCard}
          className="btn-classic px-5 inline-flex items-center gap-2"
        >
          <Plus aria-hidden="true" size={18} /> {t('contacts.addCard')}
        </button>
      </div>

      {loading ? (
        <PageState type="loading" title={t('contacts.loading')} />
      ) : error ? (
        <PageState type="error" description={error} onRetry={loadCards} />
      ) : sortedCards.length === 0 ? (
        <PageState
          type="empty"
          title={t('contacts.empty')}
          description={t('contacts.emptyHint')}
          action={
            <button type="button" onClick={openCreateCard} className="btn-classic px-5">
              {t('contacts.addCard')}
            </button>
          }
        />
      ) : (
        <div className="contact-admin-list">
          {sortedCards.map((card, cardIndex) => {
            const sortedActions = [...card.actions].sort((a, b) => a.sortOrder - b.sortOrder);
            return (
              <article
                key={card.id}
                className={`card contact-admin-card ${!card.isActive ? 'contact-admin-muted' : ''}`}
              >
                <header className="contact-admin-card-header">
                  <div className="contact-admin-brand" aria-hidden="true">
                    <img src="/admin/bulka_logo.png" alt="" width="62" height="34" />
                  </div>
                  <div className="contact-admin-card-title">
                    <div className="contact-admin-title-line">
                      <h2>{localizedValue(card.titles, locale)}</h2>
                      <span className={`status-pill ${card.isActive ? 'status-active' : 'status-inactive'}`}>
                        {card.isActive ? t('common.active') : t('common.inactive')}
                      </span>
                    </div>
                    <p>
                      {card.displayMode === 'compact'
                        ? t('contacts.modeCompact')
                        : t('contacts.modeStandard')}
                      {' · '}
                      {t('contacts.actionCount', { count: card.actions.length })}
                    </p>
                  </div>
                  <div className="row-actions contact-admin-card-controls">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => moveCard(cardIndex, -1)}
                      disabled={cardIndex === 0 || Boolean(busyId)}
                      aria-label={t('contacts.moveCardUp')}
                      title={t('contacts.moveCardUp')}
                    >
                      <ArrowUp aria-hidden="true" size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => moveCard(cardIndex, 1)}
                      disabled={cardIndex === sortedCards.length - 1 || Boolean(busyId)}
                      aria-label={t('contacts.moveCardDown')}
                      title={t('contacts.moveCardDown')}
                    >
                      <ArrowDown aria-hidden="true" size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => toggleCard(card)}
                      disabled={Boolean(busyId)}
                      aria-label={card.isActive ? t('contacts.hideCard') : t('contacts.showCard')}
                      title={card.isActive ? t('contacts.hideCard') : t('contacts.showCard')}
                    >
                      {busyId === card.id ? (
                        <LoaderCircle className="spin" aria-hidden="true" size={17} />
                      ) : (
                        <Power aria-hidden="true" size={17} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => openEditCard(card)}
                      aria-label={t('common.edit')}
                      title={t('common.edit')}
                    >
                      <Pencil aria-hidden="true" size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-button icon-button-danger"
                      onClick={() => removeCard(card)}
                      disabled={Boolean(busyId)}
                      aria-label={t('common.delete')}
                      title={t('common.delete')}
                    >
                      <Trash2 aria-hidden="true" size={17} />
                    </button>
                  </div>
                </header>

                <div className="contact-admin-actions">
                  {sortedActions.length === 0 ? (
                    <p className="contact-admin-no-actions">{t('contacts.noActions')}</p>
                  ) : (
                    sortedActions.map((action, actionIndex) => {
                      const ActionIcon = actionIconByKey[action.iconKey] ?? ExternalLink;
                      return (
                        <div
                          key={action.id}
                          className={`contact-admin-action ${!action.isActive ? 'contact-admin-action-muted' : ''}`}
                        >
                          <div className="contact-admin-action-icon" aria-hidden="true">
                            <ActionIcon size={20} />
                          </div>
                          <div className="contact-admin-action-copy">
                            <strong>{localizedValue(action.labels, locale)}</strong>
                            <span>{action.target}</span>
                          </div>
                          <span className="contact-admin-action-type">{t(
                            actionOptions.find((option) => option.type === action.type)?.labelKey ??
                              'contacts.type.customUrl',
                          )}</span>
                          <div className="row-actions contact-admin-action-controls">
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => moveAction(card, actionIndex, -1)}
                              disabled={actionIndex === 0 || Boolean(busyId)}
                              aria-label={t('contacts.moveActionUp')}
                              title={t('contacts.moveActionUp')}
                            >
                              <ArrowUp aria-hidden="true" size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => moveAction(card, actionIndex, 1)}
                              disabled={actionIndex === sortedActions.length - 1 || Boolean(busyId)}
                              aria-label={t('contacts.moveActionDown')}
                              title={t('contacts.moveActionDown')}
                            >
                              <ArrowDown aria-hidden="true" size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => toggleAction(action)}
                              disabled={Boolean(busyId)}
                              aria-label={action.isActive ? t('contacts.hideAction') : t('contacts.showAction')}
                              title={action.isActive ? t('contacts.hideAction') : t('contacts.showAction')}
                            >
                              {busyId === action.id ? (
                                <LoaderCircle className="spin" aria-hidden="true" size={16} />
                              ) : (
                                <Power aria-hidden="true" size={16} />
                              )}
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => openEditAction(action)}
                              aria-label={t('common.edit')}
                              title={t('common.edit')}
                            >
                              <Pencil aria-hidden="true" size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-button icon-button-danger"
                              onClick={() => removeAction(action)}
                              disabled={Boolean(busyId)}
                              aria-label={t('common.delete')}
                              title={t('common.delete')}
                            >
                              <Trash2 aria-hidden="true" size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <button
                    type="button"
                    className="contact-admin-add-action"
                    onClick={() => openCreateAction(card)}
                  >
                    <Plus aria-hidden="true" size={17} /> {t('contacts.addAction')}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        open={cardModalOpen}
        onClose={() => !submitting && setCardModalOpen(false)}
        title={editingCardId ? t('contacts.editCard') : t('contacts.createCard')}
        size="lg"
      >
        {cardDraft && (
          <form onSubmit={saveCard} className="modal-body form-stack" noValidate>
            {formError && <div className="inline-alert inline-alert-error" role="alert">{formError}</div>}
            <div className="form-grid form-grid-2">
              <div className="field-group">
                <label className="field-label" htmlFor="contact-display-mode">
                  {t('contacts.displayMode')}
                </label>
                <select
                  id="contact-display-mode"
                  className="input-classic"
                  value={cardDraft.displayMode}
                  onChange={(event) =>
                    setCardDraft((current) =>
                      current
                        ? {
                            ...current,
                            displayMode: event.target.value as ContactCardInput['displayMode'],
                          }
                        : current,
                    )
                  }
                >
                  <option value="standard">{t('contacts.modeStandard')}</option>
                  <option value="compact">{t('contacts.modeCompact')}</option>
                </select>
                <p className="field-hint">
                  {cardDraft.displayMode === 'compact'
                    ? t('contacts.compactHint')
                    : t('contacts.standardHint')}
                </p>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="contact-sort-order">
                  {t('common.order')}
                </label>
                <input
                  id="contact-sort-order"
                  type="number"
                  min="0"
                  className="input-classic"
                  value={cardDraft.sortOrder}
                  onChange={(event) =>
                    setCardDraft((current) =>
                      current ? { ...current, sortOrder: event.target.valueAsNumber || 0 } : current,
                    )
                  }
                />
              </div>
            </div>

            <label className="switch-row">
              <input
                type="checkbox"
                checked={cardDraft.isActive}
                onChange={(event) =>
                  setCardDraft((current) =>
                    current ? { ...current, isActive: event.target.checked } : current,
                  )
                }
              />
              <span className="switch-control" aria-hidden="true" />
              <span>{cardDraft.isActive ? t('contacts.published') : t('contacts.hidden')}</span>
            </label>

            <div className="language-tabs" role="tablist" aria-label={t('contacts.languages')}>
              {languages.map((language) => (
                <button
                  key={language}
                  type="button"
                  role="tab"
                  aria-selected={activeLanguage === language}
                  className={
                    activeLanguage === language
                      ? 'language-tab language-tab-active'
                      : 'language-tab'
                  }
                  onClick={() => setActiveLanguage(language)}
                >
                  {t(`language.${language}`)}
                  {cardDraft.titles[language].trim() && (
                    <span className="tab-complete" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor={`contact-title-${activeLanguage}`}>
                {t('contacts.cardTitle')} ({t(`language.${activeLanguage}`)}) *
              </label>
              <input
                id={`contact-title-${activeLanguage}`}
                className="input-classic"
                maxLength={120}
                value={cardDraft.titles[activeLanguage]}
                onChange={(event) =>
                  setCardDraft((current) =>
                    current
                      ? {
                          ...current,
                          titles: { ...current.titles, [activeLanguage]: event.target.value },
                        }
                      : current,
                  )
                }
                required
              />
            </div>

            <div className="contact-admin-form-preview">
              <img src="/admin/bulka_logo.png" alt="" width="64" height="36" />
              <div>
                <span className="section-eyebrow">{t('common.preview')}</span>
                <strong>{cardDraft.titles[activeLanguage] || t('contacts.cardTitle')}</strong>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-outline px-5"
                onClick={() => setCardModalOpen(false)}
                disabled={submitting}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="btn-classic px-5 inline-flex items-center gap-2"
                disabled={submitting}
              >
                {submitting && <LoaderCircle className="spin" aria-hidden="true" size={18} />}
                {submitting ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={actionModalOpen}
        onClose={() => !submitting && setActionModalOpen(false)}
        title={editingActionId ? t('contacts.editAction') : t('contacts.createAction')}
        size="lg"
      >
        {actionDraft && (
          <form onSubmit={saveAction} className="modal-body form-stack" noValidate>
            {formError && <div className="inline-alert inline-alert-error" role="alert">{formError}</div>}
            <div className="form-grid form-grid-2">
              <div className="field-group">
                <label className="field-label" htmlFor="contact-action-type">
                  {t('contacts.actionType')}
                </label>
                <select
                  id="contact-action-type"
                  className="input-classic"
                  value={actionDraft.type}
                  onChange={(event) => {
                    const option = actionOptions.find((item) => item.type === event.target.value);
                    if (!option) return;
                    setActionDraft((current) =>
                      current
                        ? { ...current, type: option.type, iconKey: option.iconKey, target: '' }
                        : current,
                    );
                  }}
                >
                  {actionOptions.map((option) => (
                    <option key={option.type} value={option.type}>{t(option.labelKey)}</option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="contact-action-target">
                  {t('contacts.target')} *
                </label>
                <input
                  id="contact-action-target"
                  className="input-classic"
                  type={actionDraft.type === 'email' ? 'email' : actionDraft.type === 'phone' ? 'tel' : 'url'}
                  inputMode={actionDraft.type === 'phone' ? 'tel' : undefined}
                  placeholder={
                    actionDraft.type === 'phone'
                      ? '+7 700 000 00 00'
                      : actionDraft.type === 'email'
                        ? 'hello@bulka.kz'
                        : 'https://example.com'
                  }
                  value={actionDraft.target}
                  onChange={(event) =>
                    setActionDraft((current) =>
                      current ? { ...current, target: event.target.value } : current,
                    )
                  }
                  required
                />
                <p className="field-hint">
                  {actionDraft.type === 'phone' || actionDraft.type === 'email'
                    ? t('contacts.directTargetHint')
                    : t('contacts.httpsHint')}
                </p>
              </div>
            </div>

            <label className="switch-row">
              <input
                type="checkbox"
                checked={actionDraft.isActive}
                onChange={(event) =>
                  setActionDraft((current) =>
                    current ? { ...current, isActive: event.target.checked } : current,
                  )
                }
              />
              <span className="switch-control" aria-hidden="true" />
              <span>{actionDraft.isActive ? t('contacts.actionVisible') : t('contacts.actionHidden')}</span>
            </label>

            <div className="language-tabs" role="tablist" aria-label={t('contacts.languages')}>
              {languages.map((language) => (
                <button
                  key={language}
                  type="button"
                  role="tab"
                  aria-selected={activeLanguage === language}
                  className={
                    activeLanguage === language
                      ? 'language-tab language-tab-active'
                      : 'language-tab'
                  }
                  onClick={() => setActiveLanguage(language)}
                >
                  {t(`language.${language}`)}
                  {actionDraft.labels[language].trim() && (
                    <span className="tab-complete" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor={`contact-action-label-${activeLanguage}`}>
                {t('contacts.actionLabel')} ({t(`language.${activeLanguage}`)}) *
              </label>
              <input
                id={`contact-action-label-${activeLanguage}`}
                className="input-classic"
                maxLength={80}
                value={actionDraft.labels[activeLanguage]}
                onChange={(event) =>
                  setActionDraft((current) =>
                    current
                      ? {
                          ...current,
                          labels: { ...current.labels, [activeLanguage]: event.target.value },
                        }
                      : current,
                  )
                }
                required
              />
            </div>

            <div className="contact-admin-form-preview contact-admin-action-preview">
              {(() => {
                const PreviewIcon = actionIconByKey[actionDraft.iconKey] ?? ExternalLink;
                return <PreviewIcon aria-hidden="true" size={22} />;
              })()}
              <div>
                <span className="section-eyebrow">{t('common.preview')}</span>
                <strong>{actionDraft.labels[activeLanguage] || t('contacts.actionLabel')}</strong>
                <small>{actionDraft.target || t('contacts.target')}</small>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-outline px-5"
                onClick={() => setActionModalOpen(false)}
                disabled={submitting}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="btn-classic px-5 inline-flex items-center gap-2"
                disabled={submitting}
              >
                {submitting && <LoaderCircle className="spin" aria-hidden="true" size={18} />}
                {submitting ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
