import SelectControl from './SelectControl';
import { useI18n } from '../lib/i18n';

export default function PromotionFields({
  draft,
  onChange,
}: {
  draft: Record<string, any>;
  onChange: (draft: Record<string, any>) => void;
}) {
  const { t } = useI18n();
  const freeDelivery = draft.discountType === 'free_delivery';
  const field = (
    key: string,
    label: string,
    type = 'text',
    options: { min?: number; max?: number; required?: boolean } = {},
  ) => (
    <label className="field-group">
      <span className="field-label">{label}</span>
      <input
        name={key}
        type={type}
        className="input-classic"
        autoComplete="off"
        value={draft[key] ?? ''}
        {...options}
        onChange={(event) =>
          onChange({
            ...draft,
            [key]: type === 'number' ? Number(event.target.value) : event.target.value,
          })
        }
      />
    </label>
  );
  const configured = Boolean(
    draft.title ||
    draft.customerIds ||
    draft.customerTags ||
    draft.usageLimit ||
    draft.startsAt ||
    draft.endsAt ||
    draft.maxDiscount ||
    draft.perCustomerLimit !== 1,
  );
  return (
    <>
      <div className="form-grid form-grid-2">
        <label className="field-group">
          <span className="field-label">{t('marketing.code')}</span>
          <input
            name="promotionCode"
            className="input-classic"
            autoComplete="off"
            required
            pattern="[A-Za-z0-9_-]{3,64}"
            maxLength={64}
            placeholder="BULKA2026"
            value={draft.code}
            onChange={(event) => onChange({ ...draft, code: event.target.value.toUpperCase() })}
          />
        </label>
        <label className="field-group">
          <span className="field-label">{t('marketing.promoType')}</span>
          <SelectControl
            name="discountType"
            value={draft.discountType}
            onChange={(discountType) =>
              onChange({
                ...draft,
                discountType,
                discountValue: discountType === 'free_delivery' ? 0 : draft.discountValue || 10,
              })
            }
            options={[
              { value: 'percent', label: t('marketing.percent') },
              { value: 'fixed', label: t('marketing.fixedAmount') },
              { value: 'free_delivery', label: t('marketing.freeDelivery') },
            ]}
          />
        </label>
        {!freeDelivery &&
          field(
            'discountValue',
            `${t('marketing.discount')} ${draft.discountType === 'percent' ? '(%)' : '(₸)'}`,
            'number',
            { min: 1, max: draft.discountType === 'percent' ? 100 : 10000000, required: true },
          )}
        {field('minOrder', `${t('marketing.minOrder')} (₸)`, 'number', { min: 0 })}
      </div>
      {freeDelivery && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm leading-relaxed" role="note">
          {t('marketing.freeDeliveryHint')}
        </p>
      )}
      <details className="rounded-xl border border-stone-200 p-4">
        <summary className="cursor-pointer py-1 font-medium">
          {t('marketing.additionalConditions')}
          {configured && (
            <span className="ml-2 text-sm font-normal">
              · {t('marketing.conditionsConfigured')}
            </span>
          )}
        </summary>
        <div className="form-grid form-grid-2 mt-4">
          {field('title', t('common.name'))}
          {!freeDelivery &&
            field('maxDiscount', `${t('marketing.maxDiscount')} (₸)`, 'number', { min: 0 })}
          {field('perCustomerLimit', t('marketing.perCustomerLimit'), 'number', {
            min: 1,
            max: 1000,
          })}
          {field('usageLimit', t('marketing.totalLimit'), 'number', { min: 0, max: 1000000 })}
          {field('startsAt', t('marketing.startsAt'), 'datetime-local')}
          {field('endsAt', t('marketing.endsAt'), 'datetime-local')}
          {field('customerTags', t('marketing.customerTags'))}
          {field('customerIds', t('marketing.customerIds'))}
        </div>
      </details>
      <label className="switch-row">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(event) => onChange({ ...draft, active: event.target.checked })}
        />
        <span className="switch-control" />
        <span>{t('common.active')}</span>
      </label>
    </>
  );
}
