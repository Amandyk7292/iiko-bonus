import { useI18n } from '../lib/i18n';

export interface ReferralPolicy {
  enabled: boolean;
  inviter_bonus: number;
  friend_bonus: number;
  min_first_order: number;
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
    </fieldset>
  );
}
