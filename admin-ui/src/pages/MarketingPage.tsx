import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Gift, LoaderCircle, Plus, RefreshCw, Save, Sparkles, Zap } from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import SelectControl from '../components/SelectControl';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { contentLanguage, useI18n } from '../lib/i18n';
import { useSearchParams } from '../lib/router';

type Tab = 'promotions' | 'gift-cards' | 'automations';
const automationTriggerKeys: Record<string, string> = {
  abandoned_cart: 'marketing.trigger.abandoned_cart',
  birthday: 'marketing.trigger.birthday',
  inactive: 'marketing.trigger.inactive',
  bonus_awarded: 'marketing.trigger.bonus_awarded',
  bonus_expiring: 'marketing.trigger.bonus_expiring',
};
const emptyPromotion = {
  code: '',
  title: '',
  discountType: 'percent',
  discountValue: 10,
  minOrder: 0,
  maxDiscount: 0,
  customerIds: '',
  customerTags: '',
  usageLimit: 0,
  perCustomerLimit: 1,
  startsAt: '',
  endsAt: '',
  active: true,
};
const astanaDateTimeLocal = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 16);
};
const marketingTabs = new Set<Tab>(['promotions', 'gift-cards', 'automations']);

export default function MarketingPage() {
  const { formatDate, formatNumber, locale, t } = useI18n();
  const contentLocale = contentLanguage(locale);
  const { toast } = useFeedback();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab') as Tab | null;
  const tab: Tab = requestedTab && marketingTabs.has(requestedTab) ? requestedTab : 'promotions';
  const setTab = (value: Tab) => {
    const next = new URLSearchParams(params);
    if (value === 'promotions') next.delete('tab');
    else next.set('tab', value);
    setParams(next);
  };
  const [promotions, setPromotions] = useState<any[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [automations, setAutomations] = useState<any[]>([]);
  const [editingPromotion, setEditingPromotion] = useState<any | null>(null);
  const [promotionDraft, setPromotionDraft] = useState<any>(emptyPromotion);
  const [giftOpen, setGiftOpen] = useState(false);
  const [giftDraft, setGiftDraft] = useState({
    amount: 5000,
    recipientName: '',
    recipientCustomerId: '',
    message: '',
    expiresAt: '',
  });
  const [editingAutomation, setEditingAutomation] = useState<any | null>(null);
  const [automationDraft, setAutomationDraft] = useState({ title: '', body: '' });
  const [issuedCode, setIssuedCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [promotionResult, cardResult, automationResult] = await Promise.all([
        api.getPromotions(),
        api.getGiftCards(),
        api.getAutomations(),
      ]);
      setPromotions(promotionResult.promotions ?? []);
      setCards(cardResult.giftCards ?? []);
      setAutomations(automationResult.automations ?? []);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('marketing.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);

  const openPromotion = (promotion?: any) => {
    setEditingPromotion(promotion ?? 'new');
    setPromotionDraft(
      promotion
        ? {
            code: promotion.code || '',
            title: promotion.title || '',
            discountType: promotion.discount_type || 'percent',
            discountValue: Number(promotion.discount_value || 0),
            minOrder: Number(promotion.min_order || 0),
            maxDiscount: Number(promotion.max_discount || 0),
            customerIds: (promotion.customer_ids || []).join(', '),
            customerTags: (promotion.customer_tags || []).join(', '),
            usageLimit: Number(promotion.usage_limit || 0),
            perCustomerLimit: Number(promotion.per_customer_limit || 1),
            startsAt: astanaDateTimeLocal(promotion.starts_at),
            endsAt: astanaDateTimeLocal(promotion.ends_at),
            active: promotion.active !== false,
          }
        : emptyPromotion,
    );
  };
  const savePromotion = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const data = {
      ...promotionDraft,
      customerIds: promotionDraft.customerIds
        .split(',')
        .map((value: string) => value.trim())
        .filter(Boolean),
      customerTags: promotionDraft.customerTags
        .split(',')
        .map((value: string) => value.trim())
        .filter(Boolean),
      maxDiscount: Number(promotionDraft.maxDiscount) || null,
      usageLimit: Number(promotionDraft.usageLimit) || null,
      startsAt: promotionDraft.startsAt || null,
      endsAt: promotionDraft.endsAt || null,
    };
    try {
      if (editingPromotion === 'new') await api.createPromotion(data);
      else await api.updatePromotion(editingPromotion.id, data);
      setEditingPromotion(null);
      await load();
      toast(t('marketing.promoSaved'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('marketing.promoSaveError'), 'error');
    } finally {
      setSaving(false);
    }
  };
  const issueGift = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api.issueGiftCard({
        ...giftDraft,
        recipientCustomerId: giftDraft.recipientCustomerId || null,
        expiresAt: giftDraft.expiresAt || null,
      });
      setIssuedCode(result.giftCard.code || '');
      setGiftOpen(false);
      await load();
      toast(t('marketing.giftIssued'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('marketing.giftIssueError'), 'error');
    } finally {
      setSaving(false);
    }
  };
  const updateAutomation = async (automation: any, patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const data = {
        titleTranslations: automation.title_translations || {},
        bodyTranslations: automation.body_translations || {},
        config: automation.config || {},
        active: automation.active !== false,
        ...patch,
      };
      await api.updateAutomation(automation.id, data);
      await load();
      toast(t('marketing.automationSaved'));
      return true;
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('marketing.automationSaveError'), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };
  const openAutomationEditor = (automation: any) => {
    setEditingAutomation(automation);
    setAutomationDraft({
      title: automation.title_translations?.[contentLocale] || '',
      body: automation.body_translations?.[contentLocale] || '',
    });
  };
  const saveAutomationText = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingAutomation || saving) return;
    const saved = await updateAutomation(editingAutomation, {
      titleTranslations: {
        ...(editingAutomation.title_translations || {}),
        [contentLocale]: automationDraft.title.trim(),
      },
      bodyTranslations: {
        ...(editingAutomation.body_translations || {}),
        [contentLocale]: automationDraft.body.trim(),
      },
    });
    if (saved) setEditingAutomation(null);
  };

  if (loading && !promotions.length && !cards.length && !automations.length)
    return <PageState type="loading" />;
  if (error && !promotions.length && !cards.length && !automations.length)
    return <PageState type="error" description={error} onRetry={load} />;
  const tabs: Array<[Tab, string]> = [
    ['promotions', t('marketing.tabPromotions')],
    ['gift-cards', t('marketing.tabGiftCards')],
    ['automations', t('marketing.tabAutomations')],
  ];
  const triggerLabel = (trigger: string) =>
    t(automationTriggerKeys[trigger] ?? 'marketing.trigger.other');

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <div>
          <h2 className="content-heading">{t('marketing.heading')}</h2>
          <p className="page-help">{t('marketing.intro')}</p>
        </div>
        <button
          className="btn-outline px-5 inline-flex items-center gap-2"
          type="button"
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden="true" size={17} />
          {t('common.refresh')}
        </button>
      </div>
      <div className="segmented-control" role="tablist" aria-label={t('marketing.sectionsLabel')}>
        {tabs.map(([value, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'is-active' : ''}
            key={value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {issuedCode && (
        <div className="inline-alert inline-alert-success">
          <strong>{t('marketing.newCertificate')}</strong> <code>{issuedCode}</code>{' '}
          <button
            className="text-link"
            type="button"
            onClick={() => void navigator.clipboard.writeText(issuedCode)}
          >
            {t('marketing.copy')}
          </button>
        </div>
      )}

      {tab === 'promotions' && (
        <section className="card ops-panel">
          <div className="page-actions-row">
            <div className="section-heading">
              <h2>{t('marketing.personalPromos')}</h2>
              <p>{t('marketing.audienceHint')}</p>
            </div>
            <button
              className="btn-classic px-5 inline-flex items-center gap-2"
              type="button"
              onClick={() => openPromotion()}
            >
              <Plus aria-hidden="true" size={17} />
              {t('common.create')}
            </button>
          </div>
          {promotions.length === 0 ? (
            <PageState compact type="empty" title={t('marketing.noPromos')} />
          ) : (
            <div className="responsive-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('marketing.code')}</th>
                    <th>{t('marketing.discount')}</th>
                    <th>{t('marketing.audience')}</th>
                    <th>{t('marketing.usedCount')}</th>
                    <th>{t('marketing.validity')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {promotions.map((item) => (
                    <tr key={item.id}>
                      <td data-label={t('marketing.code')}>
                        <strong>{item.code}</strong>
                        <small className="table-secondary">{item.title}</small>
                      </td>
                      <td data-label={t('marketing.discount')}>
                        {formatNumber(item.discount_value)}
                        {item.discount_type === 'percent' ? '%' : ' ₸'}
                      </td>
                      <td data-label={t('marketing.audience')}>
                        {item.customer_ids?.length
                          ? t('marketing.customersCount', { count: item.customer_ids.length })
                          : item.customer_tags?.length
                            ? item.customer_tags.join(', ')
                            : t('marketing.allCustomers')}
                      </td>
                      <td data-label={t('marketing.usedCount')}>
                        {item.used_count || 0}
                        {item.usage_limit ? ` / ${item.usage_limit}` : ''}
                      </td>
                      <td data-label={t('marketing.validity')}>
                        {item.ends_at ? formatDate(item.ends_at) : t('marketing.indefinite')}
                      </td>
                      <td data-label={t('common.actions')} className="text-right">
                        <button
                          className="btn-outline compact-button"
                          type="button"
                          onClick={() => openPromotion(item)}
                        >
                          {t('common.edit')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'gift-cards' && (
        <section className="card ops-panel">
          <div className="page-actions-row">
            <div className="section-heading">
              <h2>{t('marketing.giftCards')}</h2>
              <p>{t('marketing.giftCodeHint')}</p>
            </div>
            <button
              className="btn-classic px-5 inline-flex items-center gap-2"
              type="button"
              onClick={() => {
                setGiftOpen(true);
                setIssuedCode('');
              }}
            >
              <Gift aria-hidden="true" size={17} />
              {t('marketing.issue')}
            </button>
          </div>
          {cards.length === 0 ? (
            <PageState compact type="empty" title={t('marketing.noGiftCards')} />
          ) : (
            <div className="responsive-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('marketing.code')}</th>
                    <th>{t('marketing.recipient')}</th>
                    <th>{t('marketing.faceValue')}</th>
                    <th>{t('marketing.balance')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('marketing.created')}</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((card) => (
                    <tr key={card.id}>
                      <td data-label={t('marketing.code')}>
                        <strong>•••• {card.code_last4}</strong>
                      </td>
                      <td data-label={t('marketing.recipient')}>{card.recipient_name || '—'}</td>
                      <td data-label={t('marketing.faceValue')}>
                        {formatNumber(card.initial_balance)} ₸
                      </td>
                      <td data-label={t('marketing.balance')}>{formatNumber(card.balance)} ₸</td>
                      <td data-label={t('common.status')}>
                        <span
                          className={`status-pill ${card.active && card.balance > 0 ? 'status-active' : 'status-inactive'}`}
                        >
                          {card.balance > 0 ? t('common.active') : t('marketing.redeemed')}
                        </span>
                      </td>
                      <td data-label={t('marketing.created')}>{formatDate(card.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'automations' &&
        (automations.length === 0 ? (
          <PageState type="empty" title={t('marketing.noAutomations')} />
        ) : (
          <section className="automation-grid">
            {automations.map((item) => (
              <article className="card automation-card" key={item.id}>
                <div className="automation-icon">
                  <Zap aria-hidden="true" size={20} />
                </div>
                <div>
                  <h3>
                    {item.title_translations?.[contentLocale] ||
                      item.title_translations?.ru ||
                      triggerLabel(item.trigger_type)}
                  </h3>
                  <p>
                    {item.body_translations?.[contentLocale] ||
                      item.body_translations?.ru ||
                      t('marketing.messageMissing')}
                  </p>
                  <small>
                    {t('marketing.trigger')} {triggerLabel(item.trigger_type)}
                  </small>
                </div>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={item.active !== false}
                    disabled={saving}
                    onChange={(event) =>
                      void updateAutomation(item, { active: event.target.checked })
                    }
                  />
                  <span className="switch-control" />
                  <span>{item.active !== false ? t('common.enabled') : t('common.disabled')}</span>
                </label>
                <button
                  className="btn-outline compact-button inline-flex items-center gap-2"
                  type="button"
                  onClick={() => openAutomationEditor(item)}
                >
                  <Save aria-hidden="true" size={15} />
                  {t('marketing.text')}
                </button>
              </article>
            ))}
          </section>
        ))}

      <Modal
        open={Boolean(editingAutomation)}
        onClose={() => !saving && setEditingAutomation(null)}
        title={t('marketing.text')}
        description={
          editingAutomation
            ? `${t('marketing.trigger')} ${triggerLabel(editingAutomation.trigger_type)}`
            : undefined
        }
        size="md"
      >
        <form
          className="modal-body form-stack"
          onSubmit={(event) => void saveAutomationText(event)}
        >
          <div className="field-group">
            <label className="field-label" htmlFor="automation-push-title">
              {t('marketing.pushTitlePrompt')}
            </label>
            <input
              id="automation-push-title"
              name="automationTitle"
              className="input-classic"
              value={automationDraft.title}
              onChange={(event) =>
                setAutomationDraft((current) => ({ ...current, title: event.target.value }))
              }
              maxLength={120}
              required
              autoFocus
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="automation-push-body">
              {t('marketing.pushBodyPrompt')}
            </label>
            <textarea
              id="automation-push-body"
              name="automationBody"
              className="input-classic"
              rows={5}
              value={automationDraft.body}
              onChange={(event) =>
                setAutomationDraft((current) => ({ ...current, body: event.target.value }))
              }
              maxLength={500}
              required
            />
          </div>
          <div className="modal-actions">
            <button
              className="btn-outline px-5"
              type="button"
              onClick={() => setEditingAutomation(null)}
              disabled={saving}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn-classic px-5 inline-flex items-center gap-2"
              type="submit"
              disabled={saving}
            >
              {saving && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
              {t('common.save')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(editingPromotion)}
        onClose={() => !saving && setEditingPromotion(null)}
        title={editingPromotion === 'new' ? t('marketing.newPromo') : t('marketing.editPromo')}
        size="lg"
      >
        <form className="modal-body form-stack" onSubmit={savePromotion}>
          <div className="form-grid form-grid-3">
            <label className="field-group">
              <span className="field-label">{t('marketing.code')}</span>
              <input
                name="promotionCode"
                autoComplete="off"
                className="input-classic"
                value={promotionDraft.code}
                onChange={(event) =>
                  setPromotionDraft((value: any) => ({
                    ...value,
                    code: event.target.value.toUpperCase(),
                  }))
                }
                required
              />
            </label>
            <label className="field-group">
              <span className="field-label">{t('common.name')}</span>
              <input
                name="promotionTitle"
                autoComplete="off"
                className="input-classic"
                value={promotionDraft.title}
                onChange={(event) =>
                  setPromotionDraft((value: any) => ({ ...value, title: event.target.value }))
                }
                required
              />
            </label>
            <label className="field-group">
              <span className="field-label">{t('marketing.discountType')}</span>
              <SelectControl
                name="discountType"
                value={promotionDraft.discountType}
                onChange={(discountType) =>
                  setPromotionDraft((value: any) => ({ ...value, discountType }))
                }
                options={[
                  { value: 'percent', label: t('marketing.percent') },
                  { value: 'fixed', label: t('marketing.fixedAmount') },
                ]}
              />
            </label>
            <label className="field-group">
              <span className="field-label">{t('marketing.discount')}</span>
              <input
                name="discountValue"
                type="number"
                min="1"
                max={promotionDraft.discountType === 'percent' ? 100 : 10000000}
                className="input-classic"
                value={promotionDraft.discountValue}
                onChange={(event) =>
                  setPromotionDraft((value: any) => ({
                    ...value,
                    discountValue: Number(event.target.value),
                  }))
                }
                required
              />
            </label>
            <label className="field-group">
              <span className="field-label">{t('marketing.minOrder')}</span>
              <input
                name="minOrder"
                type="number"
                min="0"
                className="input-classic"
                value={promotionDraft.minOrder}
                onChange={(event) =>
                  setPromotionDraft((value: any) => ({
                    ...value,
                    minOrder: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="field-group">
              <span className="field-label">{t('marketing.maxDiscount')}</span>
              <input
                name="maxDiscount"
                type="number"
                min="0"
                className="input-classic"
                value={promotionDraft.maxDiscount}
                onChange={(event) =>
                  setPromotionDraft((value: any) => ({
                    ...value,
                    maxDiscount: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="field-group">
              <span className="field-label">{t('marketing.customerIds')}</span>
              <input
                name="customerIds"
                autoComplete="off"
                className="input-classic"
                value={promotionDraft.customerIds}
                onChange={(event) =>
                  setPromotionDraft((value: any) => ({ ...value, customerIds: event.target.value }))
                }
              />
            </label>
            <label className="field-group">
              <span className="field-label">{t('marketing.customerTags')}</span>
              <input
                name="customerTags"
                autoComplete="off"
                className="input-classic"
                value={promotionDraft.customerTags}
                onChange={(event) =>
                  setPromotionDraft((value: any) => ({
                    ...value,
                    customerTags: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field-group">
              <span className="field-label">{t('marketing.perCustomerLimit')}</span>
              <input
                name="perCustomerLimit"
                type="number"
                min="1"
                max="1000"
                step="1"
                className="input-classic"
                value={promotionDraft.perCustomerLimit}
                onChange={(event) =>
                  setPromotionDraft((value: any) => ({
                    ...value,
                    perCustomerLimit: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="field-group">
              <span className="field-label">{t('marketing.totalLimit')}</span>
              <input
                name="usageLimit"
                type="number"
                min="0"
                max="1000000"
                step="1"
                className="input-classic"
                value={promotionDraft.usageLimit}
                onChange={(event) =>
                  setPromotionDraft((value: any) => ({
                    ...value,
                    usageLimit: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="field-group">
              <span className="field-label">{t('marketing.startsAt')}</span>
              <input
                name="startsAt"
                type="datetime-local"
                className="input-classic"
                value={promotionDraft.startsAt}
                onChange={(event) =>
                  setPromotionDraft((value: any) => ({ ...value, startsAt: event.target.value }))
                }
              />
            </label>
            <label className="field-group">
              <span className="field-label">{t('marketing.endsAt')}</span>
              <input
                name="endsAt"
                type="datetime-local"
                className="input-classic"
                value={promotionDraft.endsAt}
                onChange={(event) =>
                  setPromotionDraft((value: any) => ({ ...value, endsAt: event.target.value }))
                }
              />
            </label>
          </div>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={promotionDraft.active}
              onChange={(event) =>
                setPromotionDraft((value: any) => ({ ...value, active: event.target.checked }))
              }
            />
            <span className="switch-control" />
            <span>{t('common.active')}</span>
          </label>
          <div className="modal-actions">
            <button
              className="btn-outline px-5"
              type="button"
              onClick={() => setEditingPromotion(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn-classic px-5 inline-flex items-center gap-2"
              type="submit"
              disabled={saving}
            >
              {saving ? (
                <LoaderCircle aria-hidden="true" className="spin" size={17} />
              ) : (
                <Sparkles aria-hidden="true" size={17} />
              )}
              {t('common.save')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={giftOpen}
        onClose={() => !saving && setGiftOpen(false)}
        title={t('marketing.newGift')}
      >
        <form className="modal-body form-stack" onSubmit={issueGift}>
          <label className="field-group">
            <span className="field-label">{t('marketing.amount')}</span>
            <input
              name="giftAmount"
              type="number"
              min="500"
              max="1000000"
              step="100"
              className="input-classic"
              value={giftDraft.amount}
              onChange={(event) =>
                setGiftDraft((value) => ({ ...value, amount: Number(event.target.value) }))
              }
              required
            />
          </label>
          <label className="field-group">
            <span className="field-label">{t('marketing.recipientName')}</span>
            <input
              name="recipientName"
              autoComplete="off"
              className="input-classic"
              value={giftDraft.recipientName}
              onChange={(event) =>
                setGiftDraft((value) => ({ ...value, recipientName: event.target.value }))
              }
            />
          </label>
          <label className="field-group">
            <span className="field-label">{t('marketing.recipientCustomerId')}</span>
            <input
              name="recipientCustomerId"
              autoComplete="off"
              className="input-classic"
              value={giftDraft.recipientCustomerId}
              onChange={(event) =>
                setGiftDraft((value) => ({ ...value, recipientCustomerId: event.target.value }))
              }
            />
          </label>
          <label className="field-group">
            <span className="field-label">{t('marketing.message')}</span>
            <textarea
              name="giftMessage"
              autoComplete="off"
              className="input-classic"
              value={giftDraft.message}
              onChange={(event) =>
                setGiftDraft((value) => ({ ...value, message: event.target.value }))
              }
            />
          </label>
          <label className="field-group">
            <span className="field-label">{t('marketing.expiresAt')}</span>
            <input
              name="giftExpiresAt"
              type="datetime-local"
              className="input-classic"
              value={giftDraft.expiresAt}
              onChange={(event) =>
                setGiftDraft((value) => ({ ...value, expiresAt: event.target.value }))
              }
            />
          </label>
          <div className="modal-actions">
            <button className="btn-outline px-5" type="button" onClick={() => setGiftOpen(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn-classic px-5" type="submit" disabled={saving}>
              {t('marketing.issue')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
