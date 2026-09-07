import { useState, type CSSProperties } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import './TierBackgroundEditor.css';

export const tierBackgroundUrl = (code: string, image?: string | null) =>
  image || `/assets/loyalty/${['silver', 'platinum'].includes(code) ? code : 'bronze'}-v1.webp`;

export const tierArtworkStyle = (code: string, image?: string | null): CSSProperties => ({
  backgroundImage: `linear-gradient(90deg,rgba(0,0,0,.2),transparent),linear-gradient(rgba(31,20,15,.45),rgba(31,20,15,.45)),url(${JSON.stringify(tierBackgroundUrl(code, image))})`,
});

export default function TierBackgroundEditor({
  code,
  image,
  disabled,
  onChange,
  onBusyChange,
}: {
  code: string;
  image?: string | null;
  disabled: boolean;
  onChange: (url: string | null) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const upload = async (file?: File) => {
    if (!file) return;
    setError('');
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError(t('tiers.backgroundFileHint'));
      return;
    }
    onBusyChange(true);
    try {
      const result = await api.uploadTierBackground(file);
      if (!result.success || !result.imageUrl) throw new Error(t('common.error'));
      onChange(result.imageUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      onBusyChange(false);
    }
  };
  return (
    <fieldset className="tier-background-editor" disabled={disabled}>
      <legend className="field-label">{t('tiers.background')}</legend>
      <div className="tier-background-options">
        {['bronze', 'silver', 'platinum'].map((preset) => {
          const url = tierBackgroundUrl(preset);
          return (
            <button
              type="button"
              key={preset}
              aria-pressed={tierBackgroundUrl(code, image) === url}
              onClick={() => onChange(url)}
              className="tier-background-option"
              style={tierArtworkStyle(preset)}
            >
              {t(`tiers.background.${preset}`)}
            </button>
          );
        })}
      </div>
      <label className="btn-outline tier-background-upload" htmlFor="tier-background-file">
        {t('tiers.backgroundUpload')}
        <input
          className="tier-background-file"
          id="tier-background-file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            void upload(event.currentTarget.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
      </label>
      <p className="field-hint">
        {t('tiers.backgroundFileHint')} {t('tiers.backgroundShade')}
      </p>
      <button type="button" className="btn-outline compact-button" onClick={() => onChange(null)}>
        {t('tiers.backgroundReset')}
      </button>
      {error && (
        <p role="alert" className="inline-alert inline-alert-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
