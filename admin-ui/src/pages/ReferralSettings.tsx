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
  const { t } = useI18n();
  return (
    <fieldset className="form-section">
      <legend>{t('bonus.referralTitle')}</legend>
      <p className="field-hint">{t('bonus.referralHint')}</p>
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
      <p className="field-hint">{t('bonus.referralLimitsHint')}</p>
      <div className="form-grid form-grid-2">
        {(
          ['max_invites_per_day', 'max_rewards_per_month', 'max_reward_amount_per_month'] as const
        ).map((key) => (
          <label className="field-group" key={key}>
            <span className="field-label">{t(`bonus.referral.${key}`)}</span>
            <input
              className="input-classic"
              type="number"
              min={key === 'max_reward_amount_per_month' ? 0 : 1}
              max={key === 'max_reward_amount_per_month' ? 10000000 : 10000}
              step={key === 'max_reward_amount_per_month' ? 0.01 : 1}
              required
              value={value[key]}
              onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })}
            />
          </label>
        ))}
      </div>
      <label className="switch-row">
        <input
          type="checkbox"
          checked={value.review_same_device}
          onChange={(event) => onChange({ ...value, review_same_device: event.target.checked })}
        />
        <span className="switch-control" aria-hidden="true" />
        <span>{t('bonus.referralDeviceReview')}</span>
      </label>
    </fieldset>
  );
}
