import { useI18n } from '../lib/i18n';

export interface ReferralPolicy {
  enabled: boolean;
  inviter_bonus: number;
  friend_bonus: number;
  min_first_order: number;
  max_invites_per_day: number;
  max_rewards_per_month: number;
  max_reward_amount_per_month: number;
  review_same_device: boolean;
}

export default function ReferralSettings({
  value,
  onChange,
}: {
  value: ReferralPolicy;
  onChange: (value: ReferralPolicy) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <fieldset className="form-section">
      <legend>{t('bonus.referralTitle')}</legend>
      <label className="switch-row">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
        />
        <span className="switch-control" aria-hidden="true" />
        <span>{t('bonus.referralEnabled')}</span>
      </label>
      <div className="form-grid form-grid-2">
        {(['inviter_bonus', 'friend_bonus', 'min_first_order'] as const).map((key) => (
          <div className="field-group" key={key}>
            <label className="field-label" htmlFor={`referral-${key}`}>
              {t(`bonus.referral.${key}`)}
            </label>
            <input
              id={`referral-${key}`}
              className="input-classic"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              required
              value={value[key]}
              onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })}
            />
          </div>
        ))}
      </div>
      <details className="bonus-details">
        <summary>{locale === 'kk' ? 'Бағдарлама шарттары' : 'Условия программы'}</summary>
        <p className="field-hint">{t('bonus.referralHint')}</p>
        <p className="field-hint">{t('bonus.referralLimitsHint')}</p>
        <p className="field-hint">{t('bonus.referralDeviceReview')}</p>
      </details>
    </fieldset>
  );
}
