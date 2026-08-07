import { RotateCcw } from 'lucide-react';
import type {
  TaplinkButtonEffect,
  TaplinkButtonStyle,
  TaplinkDocument,
  TaplinkLinkAppearance,
  TaplinkLinkBlock,
} from '../../lib/api-types';
import { useI18n } from '../../lib/i18n';
import { ContrastStatus, ThemeColorField } from './TaplinkThemeEditor';

const BUTTON_STYLES: TaplinkButtonStyle[] = ['soft', 'outlined', 'solid'];
const BUTTON_EFFECTS: TaplinkButtonEffect[] = ['none', 'lift', 'glow', 'shine'];

const inheritedAppearance = (
  block: TaplinkLinkBlock,
  theme: TaplinkDocument['theme'],
): TaplinkLinkAppearance => ({
  buttonStyle: block.style === 'standard' ? theme.buttonStyle : 'soft',
  backgroundColor:
    block.style === 'primary' ? theme.primaryButtonBackgroundColor : theme.buttonBackgroundColor,
  textColor: block.style === 'primary' ? theme.primaryButtonTextColor : theme.buttonTextColor,
  radius: theme.radius,
  buttonEffect: theme.buttonEffect,
});

export default function TaplinkButtonAppearanceEditor({
  block,
  theme,
  update,
}: {
  block: TaplinkLinkBlock;
  theme: TaplinkDocument['theme'];
  update: (updater: (block: TaplinkLinkBlock) => TaplinkLinkBlock) => void;
}) {
  const { t } = useI18n();
  const inherited = inheritedAppearance(block, theme);
  const appearance = block.appearance;

  const setCustom = (enabled: boolean) =>
    update((current) => {
      if (enabled) {
        return {
          ...current,
          appearance: current.appearance ?? inheritedAppearance(current, theme),
        };
      }
      const { appearance: _appearance, ...rest } = current;
      return rest;
    });

  const updateAppearance = (patch: Partial<TaplinkLinkAppearance>) =>
    update((current) => ({
      ...current,
      appearance: {
        ...(current.appearance ?? inheritedAppearance(current, theme)),
        ...patch,
      },
    }));

  return (
    <section
      className="taplink-button-appearance"
      aria-labelledby="taplink-button-appearance-title"
      data-testid="taplink-button-appearance"
    >
      <div className="taplink-theme-section-heading">
        <div>
          <h3 id="taplink-button-appearance-title">{t('taplink.buttonAppearance')}</h3>
        </div>
      </div>

      <div
        className="taplink-appearance-modes"
        role="radiogroup"
        aria-label={t('taplink.buttonAppearance')}
      >
        <label className={`taplink-appearance-mode ${appearance ? '' : 'is-selected'}`}>
          <input
            type="radio"
            name="taplink-button-appearance-mode"
            checked={!appearance}
            onChange={() => setCustom(false)}
          />
          <span>
            <strong>{t('taplink.buttonAppearance.inherit')}</strong>
            <small>
              {t(`taplink.buttonStyle.${inherited.buttonStyle}`)} · {inherited.radius}px ·{' '}
              {t(`taplink.buttonEffect.${inherited.buttonEffect}`)}
            </small>
          </span>
        </label>
        <label className={`taplink-appearance-mode ${appearance ? 'is-selected' : ''}`}>
          <input
            type="radio"
            name="taplink-button-appearance-mode"
            checked={Boolean(appearance)}
            onChange={() => setCustom(true)}
          />
          <span>
            <strong>{t('taplink.buttonAppearance.custom')}</strong>
          </span>
        </label>
      </div>

      {appearance && (
        <div className="form-stack taplink-button-appearance-fields">
          <div className="form-grid form-grid-2">
            <ThemeColorField
              id="taplink-link-button-background-color"
              label={t('taplink.buttonBackgroundColor')}
              value={appearance.backgroundColor}
              onChange={(backgroundColor) => updateAppearance({ backgroundColor })}
            />
            <ThemeColorField
              id="taplink-link-button-text-color"
              label={t('taplink.buttonTextColor')}
              value={appearance.textColor}
              onChange={(textColor) => updateAppearance({ textColor })}
            />
          </div>

          <div className="form-grid form-grid-2">
            <div className="field-group">
              <label className="field-label" htmlFor="taplink-link-button-style">
                {t('taplink.buttonStyle')}
              </label>
              <select
                id="taplink-link-button-style"
                className="input-classic"
                value={appearance.buttonStyle}
                onChange={(event) =>
                  updateAppearance({ buttonStyle: event.target.value as TaplinkButtonStyle })
                }
              >
                {BUTTON_STYLES.map((buttonStyle) => (
                  <option key={buttonStyle} value={buttonStyle}>
                    {t(`taplink.buttonStyle.${buttonStyle}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="taplink-link-button-effect">
                {t('taplink.buttonEffect')}
              </label>
              <select
                id="taplink-link-button-effect"
                className="input-classic"
                value={appearance.buttonEffect}
                onChange={(event) =>
                  updateAppearance({ buttonEffect: event.target.value as TaplinkButtonEffect })
                }
              >
                {BUTTON_EFFECTS.map((effect) => (
                  <option key={effect} value={effect}>
                    {t(`taplink.buttonEffect.${effect}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="taplink-link-button-radius">
              {t('taplink.radius')} · {appearance.radius}px
            </label>
            <input
              id="taplink-link-button-radius"
              type="range"
              min="12"
              max="32"
              step="1"
              value={appearance.radius}
              onChange={(event) => updateAppearance({ radius: Number(event.target.value) })}
            />
          </div>

          <div
            className="taplink-contrast-status"
            data-testid="taplink-button-contrast"
            role="status"
            aria-live="polite"
          >
            <ContrastStatus
              label={t('taplink.buttonAppearance')}
              foreground={appearance.textColor}
              background={appearance.backgroundColor}
            />
          </div>

          <button
            type="button"
            className="btn-outline taplink-button-appearance-reset"
            onClick={() => setCustom(false)}
          >
            <RotateCcw aria-hidden="true" size={16} />
            {t('taplink.buttonAppearance.reset')}
          </button>
        </div>
      )}
    </section>
  );
}
